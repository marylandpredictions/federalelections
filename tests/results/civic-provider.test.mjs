import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseCivicRace,ResultsProvider} from '../../scripts/results/civic-provider.mjs';import {ResultsControl} from '../../scripts/results/control.mjs';
const fixture=JSON.parse(readFileSync('tests/fixtures/civic-general-2026.json','utf8'));
const mapping={feaRaceId:'senate-CO',civicRaceId:87022,electionName:'Colorado US Senate'};
const local={id:'senate-CO',type:'senate',state:'CO',candidates:fixture.candidates.map(c=>({id:String(c.candidate_id),name:c.name,party:c.party==='Democratic'?'D':c.party==='Republican'?'R':'O',votes:0}))};
const fallback={enabled:true,provider:'CivicAPI',races:[mapping]},config={sources:[],fallback};
test('Observed CivicAPI general-election schema preserves names and raw votes but never publishes winner flags or expected-vote estimates',()=>{
 const raw=structuredClone(fixture);raw.candidates[0].winner=true;raw.candidates[0].votes=55;raw.candidates[1].votes=45;raw.last_updated=new Date().toISOString();
 const result=parseCivicRace(raw,mapping,local);assert.equal(result.candidates.reduce((n,c)=>n+c.votes,0),100);assert.equal(result.providerCallVerified,false);assert.equal(result.providerCall,null);assert.equal(result.expectedVotePercent,null);assert.equal(result.percentReporting,null);assert.equal(result.civicReportingPercent,0);assert.ok(result.candidates.every(c=>!c.winner&&!c.isWinner));
 for(const patch of [{country:'CA'},{province:'OH'},{election_date:'2026-05-05'},{election_type:'State Senate'},{election_scope:'Primary'},{test_data:true},{is_disputed:true},{district:'CO-01'},{last_updated:'bad'}])assert.throws(()=>parseCivicRace({...raw,...patch},mapping,local));
 for(const edit of [r=>r.candidates[0].votes=-1,r=>r.candidates[0].name='Republican',r=>r.candidates.push(r.candidates[0]),r=>r.candidates.pop(),r=>r.last_updated='2026-11-01T00:00:00Z']){const copy=structuredClone(raw);edit(copy);assert.throws(()=>parseCivicRace(copy,mapping,local));}
});
test('Secondary source is idle while NBC is healthy, bounded/cacheable on outage and bypassed immediately when NBC recovers',async()=>{
 let outage=false,requests=0,clock=Date.parse('2026-11-03T18:00:00Z');
 const primary={quarantined:[],async fetchResults(){if(outage)throw Error('NBC offline');return [{...local,provider:'NBC'}];}};
 const provider=new ResultsProvider(config,{primary,now:()=>clock,fetchImpl:async()=>{requests++;return new Response(JSON.stringify(fixture));}});
 assert.equal((await provider.fetchResults([local]))[0].provider,'NBC');assert.equal(requests,0);
 outage=true;assert.equal((await provider.fetchResults([local]))[0].provider,'CivicAPI');assert.equal(requests,1);
 clock+=15000;await provider.fetchResults([local]);assert.equal(requests,1);
 outage=false;assert.equal((await provider.fetchResults([local]))[0].provider,'NBC');assert.equal(requests,1);
});
test('CivicAPI outage requests are capped at 24 per poll and never fan out for every race at once',async()=>{
 const races=Array.from({length:50},(_,i)=>({...local,id:`senate-test-${i}`})),maps=races.map((r,i)=>({...mapping,feaRaceId:r.id,civicRaceId:87022+i}));let count=0;
 const provider=new ResultsProvider({fallback:{...fallback,races:maps}},{primary:{async fetchResults(){throw Error('NBC offline');}},fetchImpl:async()=>{count++;return new Response(JSON.stringify(fixture));}});
 assert.equal((await provider.fetchResults(races)).length,24);assert.equal(count,24);
 await provider.fetchResults(races);assert.equal(count,48);assert.ok(provider.cache.size<=50);
});
test('Secondary source respects Retry-After and does not continue requests during a host cooldown',async()=>{
 let clock=Date.parse('2026-11-03T18:00:00Z'),requests=0;
 const provider=new ResultsProvider(config,{now:()=>clock,primary:{async fetchResults(){throw Error('NBC offline');}},fetchImpl:async()=>{requests++;return requests===1?new Response('rate limited',{status:429,headers:{'Retry-After':'120'}}):new Response(JSON.stringify(fixture));}});
 await assert.rejects(()=>provider.fetchResults([local]));assert.equal(requests,1);
 clock+=61000;await assert.rejects(()=>provider.fetchResults([local]));assert.equal(requests,1);
 clock+=61000;assert.equal((await provider.fetchResults([local]))[0].provider,'CivicAPI');assert.equal(requests,2);
});
test('CivicAPI cannot release pending NBC calls; last-good fallback votes and published calls recover after restart',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fea-civic-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:[local]}));await writeFile(join(root,'data/results-provider.json'),JSON.stringify(config));await writeFile(join(root,'data/result-calls.json'),'{"races":{}}');
 let clock=Date.parse('2026-11-03T18:00:00Z'),outage=false,civicOffline=false,caughtUp=false,recovering=false;
 const primary={async fetchResults(){if(outage)throw Error('NBC offline');return [{...local,candidates:local.candidates.map((c,i)=>({...c,votes:caughtUp?(i===0?55:i===1?50:0):recovering?(i===0?54:i===1?51:0):0})),provider:'NBC',providerRaceId:'CO',providerCallVerified:true,providerCall:{candidate:local.candidates[0].name,status:'projected'},lastUpdated:new Date(clock).toISOString()}];}};
 const provider=new ResultsProvider(config,{primary,now:()=>clock,fetchImpl:async()=>{if(civicOffline)throw Error('Civic offline');const raw=structuredClone(fixture);raw.last_updated=new Date(clock).toISOString();raw.candidates[0].votes=55;raw.candidates[1].votes=45;raw.candidates.push({candidate_id:987654,name:"Write-in",party:"Write-In",votes:3});return new Response(JSON.stringify(raw));}});
 const options={root,storageDir:join(root,'disk'),provider,now:()=>clock,graceSeconds:30,pollSeconds:15};const control=await new ResultsControl(options).init();await control.poll();
 const race=c=>c.results().groups.flatMap(g=>g.races)[0];assert.equal(control.state(local.id).callState,'NBC_PENDING');assert.equal(race(control).calls.length,0);
 outage=true;clock+=61000;await control.poll();await control.tick();assert.equal(race(control).provider,'CivicAPI');assert.equal(race(control).calls.length,0);assert.deepEqual(control.health().lastHealthyRaceIds,[]);
 await control.action({action:'publish',raceId:local.id});assert.equal(race(control).calls[0].provider,'NBC');
 const restarted=await new ResultsControl(options).init();assert.equal(race(restarted).candidates.reduce((n,c)=>n+c.votes,0),103);assert.equal(race(restarted).calls[0].provider,'NBC');
 civicOffline=true;provider.cache.clear();clock+=61000;await restarted.poll();assert.equal(race(restarted).candidates.reduce((n,c)=>n+c.votes,0),103);assert.equal(race(restarted).calls.length,1);
 outage=false;recovering=true;clock+=61000;await restarted.poll();assert.equal(race(restarted).provider,'CivicAPI');assert.equal(race(restarted).candidates.reduce((n,c)=>n+c.votes,0),103);assert.ok(restarted.health().quarantined.some(r=>/Source switch is behind/.test(r.reason)));
 caughtUp=true;clock+=61000;await restarted.poll();assert.equal(race(restarted).provider,'NBC');assert.equal(race(restarted).candidates.reduce((n,c)=>n+c.votes,0),105);assert.equal(restarted.health().fallbackRaceCount,0);
});


test('Production secondary-source manifest has exactly one unique dated mapping for every public race',()=>{
 const config=JSON.parse(readFileSync('data/results-provider.json','utf8')),catalogue=JSON.parse(readFileSync('data/election-night-races.json','utf8')).races;
 assert.equal(config.fallback.races.length,506);assert.equal(new Set(config.fallback.races.map(r=>r.civicRaceId)).size,506);
 assert.deepEqual(config.fallback.races.map(r=>r.feaRaceId).sort(),catalogue.map(r=>r.id).sort());assert.ok(config.fallback.races.every(r=>Number.isSafeInteger(r.civicRaceId)&&r.electionName&&Number.isFinite(r.priority)));
});
