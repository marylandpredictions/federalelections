import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parseNbcNational,NbcProvider} from '../../scripts/results/nbc-provider.mjs';import {ResultsControl} from '../../scripts/results/control.mjs';
import {ResultsChangeFeed,publicProvider,publicRace} from '../../scripts/results/change-feed.mjs';
import {normalizeProbabilitySnapshot} from '../../scripts/results/probability-inputs.mjs';
const fixtures=JSON.parse(readFileSync('tests/fixtures/nbc-national-2026.json')).offices;
const catalogue=JSON.parse(readFileSync('data/election-night-races.json')).races;
const config=JSON.parse(readFileSync('data/results-provider.json'));
const sources=config.sources.filter(s=>s.format==='nbc-national-v2').map(s=>({...s,projection:{verified:false},races:s.races.filter(m=>Object.hasOwn(fixtures[s.office].mapData,m.providerRaceId))}));
const clone=x=>structuredClone(x),source=office=>sources.find(s=>s.office===office);
function batch(data,key,votes=[100,50]){const t=data.mapData[key].tooltip;t.candidates.forEach((c,i)=>c.votes=votes[i]||0);t.totalVote=t.candidates.reduce((n,c)=>n+c.votes,0);return data;}

function maineBallots(){
 const mapping=clone(config.sources.find(s=>s.office==='house'&&s.format==='nbc-national-v2').races.find(r=>r.feaRaceId==='house-ME-2'));
 const s={...source('house'),races:[mapping]},d=clone(fixtures.house);
 d.mapData={'2302':{stateCode:'ME',href:'/politics/2026-elections/maine-house-results',tooltip:{officeCode:'H',electionTypeCode:'G',totalVote:341256,percentIn:97.8,callStatusCode:'C',candidates:[
  {name:'Paul LePage',party:'GOP',code:1,votes:170265,percentVote:49.9,isWinner:false},
  {name:'Matthew Dunlap',party:'DEM',code:2,votes:164845,percentVote:48.3,isWinner:false},
  {name:'Gregory Ward',party:'OTH',code:3,votes:125,percentVote:0,isWinner:false},
 ]}}};return {s,d};
}
test('Verified Maine ranked ballots preserve NBC denominator without inventing candidate votes or a majority',()=>{
 const {s,d}=maineBallots(),r=parseNbcNational(d,s,catalogue)[0];
 assert.equal(r.candidates.reduce((n,c)=>n+c.votes,0),335235);
 assert.equal(r.providerBallotAccounting.reportedBallots,341256);
 assert.equal(r.providerBallotAccounting.ballotsOutsideCandidateTotals,6021);
 assert.ok(r.candidates[0].percent<50);
 assert.equal(r.candidates[0].percent,170265/341256*100);
 assert.equal(r.providerCall,null);assert.ok(r.candidates.every(c=>!c.isWinner));
 assert.deepEqual(publicRace(r).providerBallotAccounting,r.providerBallotAccounting);
 assert.throws(()=>normalizeProbabilitySnapshot({...r,counties:[{}]},r.candidates,
  {at:r.lastUpdated,source:'NBC captured fixture'}),/ballot-aware probability model/);
});
test('Maine ballot exception rejects unverified rules, conflicting percentages and totals below named votes',()=>{
 for(const mutate of [x=>delete x.s.races[0].ballotAccounting,x=>x.s.races[0].ballotAccountingSource='https://example.com',
  x=>x.d.mapData['2302'].tooltip.totalVote=300000,x=>x.d.mapData['2302'].tooltip.candidates[0].percentVote=50.8,
  x=>x.d.mapData['2302'].tooltip.candidates.forEach(c=>delete c.percentVote)]){
  const x=maineBallots();mutate(x);assert.throws(()=>parseNbcNational(x.d,x.s,catalogue));
 }
});
test('Maine ballot accounting survives public transport and a restart during provider outage',async t=>{
 const {s,d}=maineBallots(),root=await mkdtemp(join(tmpdir(),'fea-maine-ballots-'));
 t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));await mkdir(join(root,'disk'));
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:catalogue.filter(r=>r.id==='house-ME-2')}));
 await writeFile(join(root,'data/results-provider.json'),JSON.stringify({...config,sources:[s]}));
 await writeFile(join(root,'data/result-calls.json'),JSON.stringify({races:{}}));
 let offline=false;
 const provider=new NbcProvider({sources:[s],fetchImpl:async()=>{if(offline)throw Error('offline');return new Response(JSON.stringify(d));}});
 const options={root,storageDir:join(root,'disk'),provider,now:()=>Date.parse(d.currentTime)+1000};
 const control=await new ResultsControl(options).init();await control.poll();
 const race=c=>c.results().groups.flatMap(g=>g.races)[0];
 assert.equal(race(control).provider,'NBC');
 assert.equal(race(control).providerBallotAccounting.ballotsOutsideCandidateTotals,6021);
 offline=true;const restarted=await new ResultsControl(options).init();await restarted.poll();
 assert.equal(race(restarted).provider,'NBC');
 assert.deepEqual(publicRace(race(restarted)).providerBallotAccounting,publicRace(race(control)).providerBallotAccounting);
 assert.ok(race(restarted).candidates[0].percent<50);
 assert.equal(restarted.probabilityResult('house-ME-2').providerBallotAccounting.reportedBallots,341256);
});
test('Observed NBC 2026 national samples map House at-large, House districts, Senate specials and governors without projections',()=>{
 for(const s of sources){const rows=parseNbcNational(fixtures[s.office],s,catalogue);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.candidates.length&&r.candidates.every(c=>c.votes===0)&&r.providerCall===null&&r.providerCallVerified===false));}
 assert.equal(parseNbcNational(fixtures.house,source('house'),catalogue)[0].id,'house-DE-AL');
 assert.ok(parseNbcNational(fixtures.senate,source('senate'),catalogue).some(r=>r.id==='senate-OH'));
 const d=clone(fixtures.senate);d.mapData.OH.tooltip.candidates[0].isWinner=true;d.mapData.OH.tooltip.callStatusCode='W';assert.equal(parseNbcNational(d,source('senate'),catalogue).find(r=>r.id==='senate-OH').providerCall,null);
});
test('NBC candidate codes preserve identity across a verified ballot-name variation',()=>{
 const s=source('house'),d=clone(fixtures.house),key=s.races[0].providerRaceId;
 d.mapData[key].tooltip.candidates[0].code=123456;
 const parse=()=>parseNbcNational(d,s,catalogue).find(r=>r.id===s.races[0].feaRaceId).candidates[0];
 const original=parse();
 assert.equal(original.id,'123456');
 d.mapData[key].tooltip.candidates[0].name=original.name.replace(/\s+/g,'  ');
 assert.equal(parse().id,original.id);
 assert.equal(parse().name,original.name);
});
test('NBC keeps publishing vote totals and explicit projections after votingToday clears overnight',()=>{
 for(const s of sources){
  const d=clone(fixtures[s.office]),key=s.races[0].providerRaceId;
  d.currentTime='2026-11-04T05:35:34Z';
  for(const m of s.races)d.mapData[m.providerRaceId].votingToday=false;
  batch(d,key,[120,80]);
  const t=d.mapData[key].tooltip;t.callStatusCode='P';t.candidates.forEach((c,i)=>c.isWinner=i===0);
  const rows=parseNbcNational(d,{...s,projection:{verified:true,contract:'nbc-firecracker-call-status-v1'}},catalogue);
  const r=rows.find(r=>r.id===s.races[0].feaRaceId);
  assert.equal(rows.length,s.races.length);
  assert.equal(r.candidates.reduce((n,c)=>n+c.votes,0),200);
  assert.equal(r.providerCall.candidate,r.candidates[0].name);
 }
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
async function runtime(t,verified=false){
 const activeSources=verified?sources.map(s=>({...s,projection:{verified:true,contract:'nbc-firecracker-call-status-v1'}})):sources;
 const root=await mkdtemp(join(tmpdir(),'fea-national-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));await mkdir(join(root,'disk'));
 const ids=new Set(sources.flatMap(s=>s.races.map(m=>m.feaRaceId))),local=catalogue.filter(r=>ids.has(r.id));
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:local}));await writeFile(join(root,'data/results-provider.json'),JSON.stringify({...config,sources:activeSources}));await writeFile(join(root,'data/result-calls.json'),JSON.stringify({races:{}}));
 let clock=Math.max(...Object.values(fixtures).map(d=>Date.parse(d.currentTime))),outage=false,reads=0;const data=clone(fixtures);
 const provider=new NbcProvider({sources:activeSources,fetchImpl:async url=>{reads++;if(outage)throw Error('upstream offline');const office=String(url).match(/(house|senate|governor)-results$/)[1];return new Response(JSON.stringify(data[office]));}});
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


test('An advancing NBC ballot can clear its anonymous write-in total while named resets are quarantined', async t => {
 const x = await runtime(t);
 const tooltip = x.data.house.mapData['1001'].tooltip;
 tooltip.candidates.push({name:'Total Write-ins',party:'OTH',votes:501});
 batch(x.data.house,'1001',[1000,900,501]);
 await x.control.poll();
 const current = () => x.control.probabilityResult('house-DE-AL').candidates.map(candidate => candidate.votes);
 assert.deepEqual(current(),[1000,900,501]);
 x.advance();
 batch(x.data.house,'1001',[1000,900,0]);
 await x.control.poll();
 assert.deepEqual(current(),[1000,900,501]);
 x.advance();
 batch(x.data.house,'1001',[1300,1200,0]);
 await x.control.poll();
 assert.deepEqual(current(),[1300,1200,0]);
 x.advance();
 batch(x.data.house,'1001',[2200,0,0]);
 await x.control.poll();
 assert.deepEqual(current(),[1300,1200,0]);
 assert.ok(x.control.health().quarantined.some(row => /Candidate vote reset/.test(row.reason)));
});

test('Public transport carries only safe NBC page links and unchanged races need no repeat national download',async t=>{
 const x=await runtime(t);await x.control.poll();const feed=new ResultsChangeFeed();const a=feed.update(x.control.results());
 x.advance();await x.control.poll();feed.update(x.control.results());assert.equal(feed.changes(a.version).races.length,0);
 const metadata=publicProvider({publicResultsPages:{house:config.publicResultsPages.house,senate:'javascript:bad',private:'secret'},publicResultsUrl:'https://evil.example',adminToken:'secret'});
 assert.deepEqual(metadata.publicResultsPages,{house:config.publicResultsPages.house});assert.equal(metadata.adminToken,undefined);assert.equal(metadata.publicResultsUrl,undefined);
});


test('National NBC projection passes through pending, public publish, withdrawal hold and explicit retraction without leaking pending calls',async t=>{
 const x=await runtime(t,true),raceId='house-DE-AL',tooltip=x.data.house.mapData['1001'].tooltip;
 tooltip.callStatusCode='P';tooltip.candidates.forEach((c,i)=>c.isWinner=i===0);
 await x.control.poll();
 const visible=()=>x.control.results().groups.flatMap(g=>g.races).find(r=>r.id===raceId);
 assert.equal(visible().calls.length,0);assert.equal(x.control.state(raceId).callState,'NBC_PENDING');
 await x.control.action({action:'publish',raceId});assert.equal(visible().calls.length,1);assert.equal(visible().calls[0].provider,'NBC');
 x.advance();tooltip.callStatusCode='C';tooltip.candidates.forEach(c=>c.isWinner=false);await x.control.poll();
 assert.equal(x.control.state(raceId).callState,'NBC_HELD');assert.equal(visible().calls.length,1);
 await x.control.action({action:'manual',raceId,calls:[]});assert.equal(visible().calls.length,0);
});
