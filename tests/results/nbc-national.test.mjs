import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseNbcNational,NbcProvider} from '../../scripts/results/nbc-provider.mjs';import {ResultsControl} from '../../scripts/results/control.mjs';
import {ResultsChangeFeed,publicProvider} from '../../scripts/results/change-feed.mjs';
const fixtures=JSON.parse(readFileSync('tests/fixtures/nbc-national-2026.json')).offices;
const catalogue=JSON.parse(readFileSync('data/election-night-races.json')).races;
const config=JSON.parse(readFileSync('data/results-provider.json'));
const sources=config.sources.filter(s=>s.format==='nbc-national-v2').map(s=>({...s,races:s.races.filter(m=>Object.hasOwn(fixtures[s.office].mapData,m.providerRaceId))}));
const clone=x=>structuredClone(x),source=office=>sources.find(s=>s.office===office);
function batch(data,key,votes=[100,50]){const t=data.mapData[key].tooltip;t.candidates.forEach((c,i)=>c.votes=votes[i]||0);t.totalVote=t.candidates.reduce((n,c)=>n+c.votes,0);return data;}
test('Observed NBC 2026 national samples map House at-large, House districts, Senate specials and governors without projections',()=>{
 for(const s of sources){const rows=parseNbcNational(fixtures[s.office],s,catalogue);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.candidates.length&&r.candidates.every(c=>c.votes===0)&&r.providerCall===null&&r.providerCallVerified===false));}
 assert.equal(parseNbcNational(fixtures.house,source('house'),catalogue)[0].id,'house-DE-AL');
 assert.ok(parseNbcNational(fixtures.senate,source('senate'),catalogue).some(r=>r.id==='senate-OH'));
 const d=clone(fixtures.senate);d.mapData.OH.tooltip.candidates[0].isWinner=true;d.mapData.OH.tooltip.callStatusCode='W';assert.equal(parseNbcNational(d,source('senate'),catalogue).find(r=>r.id==='senate-OH').providerCall,null);
});
test('National identity/schema, geography, raw totals, candidate duplicates, malformed votes and special-election scope fail closed',()=>{
 const s=source('house');for(const mutate of [d=>d.electionDate='2024-11-05',d=>d.electionType='primary',d=>d.office='senate',d=>d.brand='other',d=>d.enableLivePreview=true,d=>d.mapData={},d=>d.currentTime='bad',d=>d.mapData['1001'].stateCode='TX',d=>d.mapData['1001'].tooltip.totalVote=2,d=>d.mapData['1001'].tooltip.percentIn=101,d=>d.mapData['1001'].tooltip.candidates[0].votes=-1,d=>delete d.mapData['1001'].tooltip.candidates[0].votes,d=>d.mapData['1001'].tooltip.candidates[0].votes=true,d=>d.mapData['1001'].tooltip.candidates[0].votes=[],d=>d.mapData['1001'].tooltip.candidates[0].name='Republican',d=>d.mapData['1001'].tooltip.candidates.push(clone(d.mapData['1001'].tooltip.candidates[0]))]){const d=clone(fixtures.house);mutate(d);assert.throws(()=>parseNbcNational(d,s,catalogue));}
 const wrong=clone(s);wrong.races[0].feaRaceId='house-DE-AL';wrong.races[0].providerRaceId='4804';assert.throws(()=>parseNbcNational(fixtures.house,wrong,catalogue));
 const special=clone(source('senate'));special.races.find(m=>m.feaRaceId==='senate-OH').specialElection=false;assert.throws(()=>parseNbcNational(fixtures.senate,special,catalogue));
});
test('One malformed/missing national race is quarantined while healthy races continue',()=>{
 const d=clone(fixtures.house);delete d.mapData['1001'];const bad=[];const rows=parseNbcNational(d,source('house'),catalogue,{onInvalid:e=>bad.push(e)});assert.equal(rows.length,1);assert.equal(bad[0].race,'house-DE-AL');
});
test('National provider isolates invalid JSON/500/timeout/empty office payloads and safely uses conditional 304 responses',async()=>{
 for(const failure of ['json','500','timeout','empty']){
 const provider=new NbcProvider({sources,fetchImpl:async url=>{const office=String(url).match(/(house|senate|governor)-results$/)[1];if(office==='house'){if(failure==='timeout')throw Error('timeout');return new Response(failure==='json'?'not json':failure==='empty'?'{}':'error',{status:failure==='500'?500:200});}return new Response(JSON.stringify(fixtures[office]));}});
 assert.equal((await provider.fetchResults(catalogue)).length,4);assert.equal(provider.quarantined.length,2);
 }
 let calls=0;const provider=new NbcProvider({sources:[source('house')],fetchImpl:async(url,options)=>{if(calls++){assert.equal(options.headers['If-None-Match'],'sample');return new Response(null,{status:304});}return new Response(JSON.stringify(fixtures.house),{headers:{etag:'sample'}});}});
 assert.deepEqual(await provider.fetchResults(catalogue),await provider.fetchResults(catalogue));
});
async function runtime(t){
 const root=await mkdtemp(join(tmpdir(),'fea-national-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));await mkdir(join(root,'disk'));
 const ids=new Set(sources.flatMap(s=>s.races.map(m=>m.feaRaceId))),local=catalogue.filter(r=>ids.has(r.id));
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:local}));await writeFile(join(root,'data/results-provider.json'),JSON.stringify({...config,sources}));await writeFile(join(root,'data/result-calls.json'),JSON.stringify({races:{}}));
 let clock=Math.max(...Object.values(fixtures).map(d=>Date.parse(d.currentTime))),outage=false,reads=0;const data=clone(fixtures);
 const provider=new NbcProvider({sources,fetchImpl:async url=>{reads++;if(outage)throw Error('upstream offline');const office=String(url).match(/(house|senate|governor)-results$/)[1];return new Response(JSON.stringify(data[office]));}});
 const options={root,storageDir:join(root,'disk'),provider,now:()=>clock};const control=await new ResultsControl(options).init();
 return {control,options,data,advance(){clock+=61000;for(const d of Object.values(data))d.currentTime=new Date(clock).toISOString();},outage(){outage=true;},recover(){outage=false;},get reads(){return reads;}};
}
test('Actual control refreshes at 15 seconds, publishes the zero-vote NBC roster, retains last-good data across resets/outage/restart and recovers',async t=>{
 const x=await runtime(t);await x.control.poll();assert.equal(x.control.pollSeconds,15);const firstReads=x.reads;await x.control.poll();assert.equal(x.reads,firstReads);
 const race=()=>x.control.results().groups.flatMap(g=>g.races).find(r=>r.id==='house-DE-AL');assert.deepEqual(race().candidates.map(c=>c.providerName),fixtures.house.mapData['1001'].tooltip.candidates.map(c=>c.name));assert.equal(x.control.health().connection,'connected');
 const total=()=>race().candidates.reduce((n,c)=>n+c.votes,0);x.advance();batch(x.data.house,'1001');await x.control.poll();assert.equal(total(),150);
 x.advance();batch(x.data.house,'1001',[0,0]);await x.control.poll();assert.equal(total(),150);assert.ok(x.control.health().quarantined.some(r=>/zero-vote reset/.test(r.reason)));
 x.advance();batch(x.data.house,'1001',[10,5]);await x.control.poll();assert.equal(total(),150);assert.ok(x.control.health().quarantined.some(r=>/partial vote reset/.test(r.reason)));
 x.advance();batch(x.data.house,'1001',[0,150]);await x.control.poll();assert.equal(total(),150);assert.ok(x.control.health().quarantined.some(r=>/Candidate vote reset/.test(r.reason)));
 x.advance();batch(x.data.house,'1001',[99,50]);await x.control.poll();assert.equal(total(),149);
 x.advance();x.data.house.currentTime='2026-11-03T00:00:00Z';await x.control.poll();assert.equal(total(),149);assert.ok(x.control.health().quarantined.some(r=>/Regressed provider timestamp/.test(r.reason)));
 await x.control.action({action:'manual',raceId:'house-DE-AL',calls:[{candidate:race().candidates[0].name,status:'projected'}]});
 x.advance();x.outage();await x.control.poll();assert.equal(total(),149);assert.equal(race().calls.length,1);
 const restarted=await new ResultsControl(x.options).init();await restarted.poll();const recovered=restarted.results().groups.flatMap(g=>g.races).find(r=>r.id==='house-DE-AL');assert.equal(recovered.candidates.reduce((n,c)=>n+c.votes,0),149);assert.equal(recovered.calls.length,1);
 x.recover();x.advance();batch(x.data.house,'1001',[200,100]);await restarted.poll();assert.equal(restarted.health().connection,'connected');assert.equal(restarted.results().groups.flatMap(g=>g.races).find(r=>r.id==='house-DE-AL').candidates[0].votes,200);
});


test('Public transport carries only safe NBC page links and unchanged races need no repeat national download',async t=>{
 const x=await runtime(t);await x.control.poll();const feed=new ResultsChangeFeed();const a=feed.update(x.control.results());
 x.advance();await x.control.poll();feed.update(x.control.results());assert.equal(feed.changes(a.version).races.length,0);
 const metadata=publicProvider({publicResultsPages:{house:config.publicResultsPages.house,senate:'javascript:bad',private:'secret'},publicResultsUrl:'https://evil.example',adminToken:'secret'});
 assert.deepEqual(metadata.publicResultsPages,{house:config.publicResultsPages.house});assert.equal(metadata.adminToken,undefined);assert.equal(metadata.publicResultsUrl,undefined);
});
