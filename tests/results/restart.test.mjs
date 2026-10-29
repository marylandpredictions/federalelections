import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {ResultsControl} from '../../scripts/results/control.mjs';
import {backupRuntime,restoreRuntime} from '../../scripts/results/runtime-backup.mjs';
import {storageConfiguration} from '../../scripts/results/storage.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'fea-cert-restart-'));t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const app=join(root,'checkout-a'),disk=join(root,'disk');await mkdir(join(app,'data'),{recursive:true});await mkdir(join(app,'scripts'));await mkdir(disk);
 for(const f of ['server.mjs','scripts/generate-live-results.mjs','scripts/results'])await cp(f,join(app,f),{recursive:true});
 const catalogue=JSON.parse(await readFile('data/election-night-races.json','utf8')).races.filter(r=>r.id==='senate-OH');
 await writeFile(join(app,'data/election-night-races.json'),JSON.stringify({races:catalogue}));await writeFile(join(app,'data/result-calls.json'),JSON.stringify({races:{}}));await writeFile(join(app,'data/results-provider.json'),JSON.stringify({sources:[]}));
 const raw={...catalogue[0],candidates:catalogue[0].candidates.map((c,i)=>({...c,votes:i?80:100})),lastUpdated:new Date().toISOString(),provider:'NBC',providerRaceId:'fixture',providerCall:null,counties:[]};
 const control=await new ResultsControl({root:app,storageDir:disk,provider:{fetchResults:async()=>[raw]}}).init();await control.poll();await control.action({action:'manual',raceId:raw.id,calls:[{candidate:raw.candidates[0].name,status:'projected'}]});
 await mkdir(join(disk,'race-details'));await writeFile(join(disk,'race-details',raw.id+'.json'),JSON.stringify({...raw,voteHistory:[{at:new Date().toISOString(),candidates:raw.candidates}]}));await mkdir(join(disk,'county-history',raw.id),{recursive:true});await writeFile(join(disk,'county-history',raw.id,'39001.ndjson'),JSON.stringify({fips:'39001',at:new Date().toISOString(),candidates:raw.candidates})+'\n');
 return {root,app,disk,raw,control};
}
async function start(t,app,disk){
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',RESULTS_STORAGE_DIR:disk,RESULTS_REQUIRE_PERSISTENCE:'0',RESULTS_EXPECTED_STORAGE_ROOT:'',NODE_ENV:'test',RENDER:'false',ADMIN_SECRET:'isolated-restart-test',GH_TOKEN:'',GITHUB_TOKEN:'',GITHUB_REPOSITORY:'',RESULTS_MODE:''},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b);const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}};t.after(stop);
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Server start timeout: '+errors));},15000);child.stdout.on('data',b=>{if(String(b).includes('server running')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Server failed '+code+': '+errors));});});return {url:'http://127.0.0.1:'+port,stop};
}
async function verify(server,raw){
 const full=await(await fetch(server.url+'/api/live-results')).json(),race=full.groups.flatMap(g=>g.races).find(r=>r.id===raw.id);assert.equal(race.candidates[0].votes,100);assert.equal(race.calls[0].candidate,raw.candidates[0].name);assert.equal(full.provider.stale,true);
 const admin=await(await fetch(server.url+'/api/admin/results-control',{headers:{'x-admin-secret':'isolated-restart-test'}})).json();assert.ok(admin.states[raw.id].manualOverride);assert.ok(admin.audit.length);assert.ok((await(await fetch(server.url+'/api/live-results/race?id='+raw.id)).json()).voteHistory.length);assert.ok((await(await fetch(server.url+'/api/live-results/race?id='+raw.id+'&county=39001')).json()).voteHistory.length);
 const heartbeat=await fetch(server.url+'/api/results-version',{headers:{'If-None-Match':'"'+full.version+'"'}});assert.equal(heartbeat.status,304);
}
test('Operational restart/redeploy: separate storage retains calls, override, audit, history and last-good votes with provider unavailable',async t=>{
 const f=await fixture(t);let server=await start(t,f.app,f.disk);await verify(server,f.raw);await server.stop();server=await start(t,f.app,f.disk);await verify(server,f.raw);await server.stop();const second=join(f.root,'checkout-b');await cp(f.app,second,{recursive:true});server=await start(t,second,f.disk);await verify(server,f.raw);await server.stop();
});
test('Runtime corruption: committed envelope recovers corrupt/missing calls; invalid/truncated runtime and malformed calls without envelope fail clearly',async t=>{
 const f=await fixture(t),state=join(f.disk,'results-state.json'),calls=join(f.disk,'result-calls.json'),goodState=await readFile(state),goodCalls=await readFile(calls);
 for(const bad of ['{truncated','null','{"races":[]}']){await writeFile(calls,bad);const c=await new ResultsControl({root:f.app,storageDir:f.disk}).init();assert.equal(c.results().groups[1].races[0].calls[0].candidate,f.raw.candidates[0].name);assert.ok(c.health().recoveryWarning);assert.equal(c.health().status,'STORAGE ERROR');assert.equal(c.health().stale,true);}
 await rm(calls);assert.equal((await new ResultsControl({root:f.app,storageDir:f.disk}).init()).results().groups[1].races[0].calls.length,1);await writeFile(calls,goodCalls);
 for(const bad of ['{truncated','null','{}','{"races":[]}','{"schemaVersion":99}','{"races":{"senate-OH":{"id":"senate-OH","candidates":[{"name":"Invalid","votes":-1}]}}}']){await writeFile(state,bad);await assert.rejects(new ResultsControl({root:f.app,storageDir:f.disk}).init(),/recover election state|Invalid saved/);}
 await writeFile(state,'{partial write');await assert.rejects(start(t,f.app,f.disk),/Cannot recover election state/);
 const ghost=JSON.parse(goodState);ghost.committedCalls.races[f.raw.id].calls[0].candidate='Unknown Winner';await writeFile(state,JSON.stringify(ghost));await assert.rejects(new ResultsControl({root:f.app,storageDir:f.disk}).init(),/Invalid saved call/);
 await writeFile(state,JSON.stringify({races:{},audit:[]}));assert.equal((await new ResultsControl({root:f.app,storageDir:f.disk}).init()).results().groups[1].races[0].calls.length,1);await rm(state);await assert.rejects(new ResultsControl({root:f.app,storageDir:f.disk}).init(),/Runtime envelope missing/);await writeFile(calls,'{broken');await assert.rejects(new ResultsControl({root:f.app,storageDir:f.disk}).init(),/recover election state/);await writeFile(state,goodState);
});
test('Private offline backup restores calls/audit/history byte-for-byte, rejects corrupt archives, and retains prior directory',async t=>{
 const f=await fixture(t),archive=join(f.disk,'.backups','private-backup.json.gz'),state=join(f.disk,'results-state.json'),original=await readFile(state);await writeFile(join(f.disk,'operator-marker'),'preserve unrelated root file');const b=await backupRuntime(f.disk,archive);assert.equal(b.files,4);await writeFile(state,'{broken');const restored=await restoreRuntime(archive,f.disk);assert.ok(restored.previousDirectory);assert.deepEqual(await readFile(state),original);assert.equal(await readFile(join(f.disk,'operator-marker'),'utf8'),'preserve unrelated root file');assert.ok((await readFile(join(f.disk,'county-history',f.raw.id,'39001.ndjson'),'utf8')).includes('39001'));
 const server=await start(t,f.app,f.disk);await verify(server,f.raw);await server.stop();await writeFile(archive,'not gzip');await assert.rejects(restoreRuntime(archive,f.disk));assert.ok((await readFile(state,'utf8')).includes('committedCalls'));
});
test('Production path checks reject defaults, checkout, temporary and mismatched mount roots without claiming a disk is durable',()=>{
 const root=resolve('/app/fea'),env={RESULTS_REQUIRE_PERSISTENCE:'1',RESULTS_EXPECTED_STORAGE_ROOT:resolve('/var/data/fea')};for(const path of [undefined,join(root,'.runtime'),join(tmpdir(),'fea-disk'),resolve('/other/mount')])assert.ok(storageConfiguration(root,path,env).issues.length);const valid=storageConfiguration(root,join(env.RESULTS_EXPECTED_STORAGE_ROOT,'results'),env);assert.deepEqual(valid.issues,[]);assert.equal(valid.hostPersistenceVerified,false);
 const nested=join(root,'mounted-storage');assert.deepEqual(storageConfiguration(root,nested,{RESULTS_REQUIRE_PERSISTENCE:'1',RESULTS_EXPECTED_STORAGE_ROOT:nested}).issues,[]);
});
test('Actual server startup refuses an explicitly required ephemeral runtime path before serving election data',async t=>{
 const f=await fixture(t);let error;try{execFileSync(process.execPath,['server.mjs'],{cwd:f.app,timeout:10000,stdio:'pipe',env:{...process.env,NODE_ENV:'test',RENDER:'false',RESULTS_STORAGE_DIR:join(f.app,'.runtime'),RESULTS_REQUIRE_PERSISTENCE:'1',RESULTS_EXPECTED_STORAGE_ROOT:'',GITHUB_TOKEN:'',GH_TOKEN:'',GITHUB_REPOSITORY:''}});}catch(e){error=e;}
 assert.equal(error?.status,1);assert.match(String(error.stderr),/Unsafe election persistence configuration/);assert.doesNotMatch(String(error.stdout),/server running/);
});
