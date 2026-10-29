import test from 'node:test';
import assert from 'node:assert/strict';
import {matchBallotCandidate} from '../../scripts/results/candidate-roster.mjs';
import {parseNbcResults} from '../../scripts/results/nbc-provider.mjs';
const roster=[{name:'John A. Smith Jr.',party:'D'},{name:'Robert "Bob" Jones',party:'R'},{name:'Anne-Marie O\'Neil',party:'I',aliases:['A. M. O\'Neil']}];
const candidate=(name,party='D')=>({name,party,partyCode:party,id:'source-id',votes:55});
test('Reviewed ballot names reconcile middle initials, absent suffixes, quoted nicknames, punctuation and explicit aliases',()=>{
 for(const [name,party,expected] of [['John Smith','D',roster[0].name],['John A Smith Jr','D',roster[0].name],['Robert Jones','R',roster[1].name],['Bob Jones','R',roster[1].name],["Anne Marie ONeil",'I',roster[2].name],["A. M. ONeil",'I',roster[2].name]]){
  const row=matchBallotCandidate(candidate(name,party),roster);assert.equal(row.name,expected);assert.equal(row.votes,55);assert.equal(row.id,'source-id');
 }
});
test('Candidate reconciliation refuses ambiguous names, conflicting suffixes, unknown people and party mismatches',()=>{
 assert.throws(()=>matchBallotCandidate(candidate('John Smith'),[...roster,{name:'John B Smith Sr.',party:'D'}]),/Ambiguous/);
 assert.throws(()=>matchBallotCandidate(candidate('John Smith Sr.'),roster),/Unknown/);
 assert.throws(()=>matchBallotCandidate(candidate('Jane Smith'),roster),/Unknown/);
 assert.throws(()=>matchBallotCandidate(candidate('John Smith','R'),roster),/party mismatch/);
 const twins=[{name:'John Smith Sr.',party:'D'},{name:'John Smith Jr.',party:'R'}];
 assert.equal(matchBallotCandidate(candidate('John Smith Jr.','R'),twins).name,twins[1].name);
});
test('Provider uses canonical reviewed identities for votes, counties and explicit calls; missing candidates are quarantined',()=>{
 const local={id:'senate-OH',type:'senate',state:'OH',rosterReviewed:true,candidates:roster.slice(0,2)};
 const source={projection:{verified:true,candidateFlag:'isWinner'},races:[{feaRaceId:local.id,providerRaceId:'1'}]};
 const raw={stateAbbr:'OH',electionDate:'2026-11-03',races:[{summary:{raceId:'1',officeName:'US Senate',candidates:[{name:'John Smith',party:'DEM',votes:55,isWinner:true},{name:'Bob Jones',party:'GOP',votes:45,isWinner:false}]},areas:[{fips:'39001',name:'Adams',candidates:[{name:'John Smith',party:'DEM',votes:5}]}]}]};
 const r=parseNbcResults(raw,source,[local])[0];assert.equal(r.providerCall.candidate,roster[0].name);assert.equal(r.candidates[0].name,roster[0].name);assert.equal(r.counties[0].candidates[0].name,roster[0].name);
 raw.races[0].summary.candidates.pop();assert.throws(()=>parseNbcResults(raw,source,[local]),/roster incomplete/);
 const issues=[];assert.equal(parseNbcResults({...raw,races:[...raw.races,{summary:{raceId:'2',officeName:'US Senate',candidates:[{name:'Sam Proper',party:'DEM',votes:2,isWinner:false}]}}]}, {...source,races:[...source.races,{feaRaceId:'senate-PA',providerRaceId:'2'}]},[local,{id:'senate-PA',state:'OH',type:'senate',candidates:[{name:'Sam Proper',party:'D'}]}],{onInvalid:i=>issues.push(i)}).length,1);
 assert.match(issues[0].reason,/roster incomplete/);
});
import {NbcProvider} from '../../scripts/results/nbc-provider.mjs';
import {readiness,validatePollSchedule} from '../../scripts/results/readiness.mjs';
import {readFile,mkdtemp,cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),D=require('../../assets/results-desk.js'),N=require('../../assets/night-awareness.js');
test('A failed state endpoint is quarantined while healthy states advance; invalid source configuration still fails closed',async()=>{
 const roster=[{id:'senate-OH',state:'OH',type:'senate',candidates:[{name:'Proper Person',party:'D'}]},{id:'senate-PA',state:'PA',type:'senate',candidates:[{name:'Other Person',party:'R'}]}];
 const sources=roster.map(r=>({url:'https://www.nbcnews.com/firecracker/test/'+r.state,status:'CONFIRMED',election:'2026-general',races:[{feaRaceId:r.id,providerRaceId:r.id}]}));
 const p=new NbcProvider({sources,fetchImpl:async url=>String(url).endsWith('/OH')?new Response('down',{status:500}):new Response(JSON.stringify({stateAbbr:'PA',electionDate:'2026-11-03',races:[{summary:{raceId:'senate-PA',officeName:'US Senate',candidates:[{name:'Other Person',party:'GOP',votes:100}]}}]}))});
 assert.equal((await p.fetchResults(roster))[0].id,'senate-PA');assert.equal(p.quarantined[0].race,'senate-OH');assert.match(p.quarantined[0].reason,/500/);
 p.sources[0].status='UNVERIFIED';await assert.rejects(p.fetchResults(roster),/verified public NBC/);
});
test('Observed vote drops use raw totals for 55/45 and multi-candidate batches, including margin movement',()=>{
 const row=values=>({id:'test',candidates:values.map((votes,i)=>({name:'Person '+i,party:['D','R','I'][i],votes})),calls:[]});
 const before=row([60,40]),after=row([115,85]),m=D.metrics(after,before);
 assert.equal(m.delta,100);assert.ok(Math.abs(m.batchShares[0].share-55)<1e-10);assert.equal(m.batchShares[1].share,45);assert.equal(m.margin,15);assert.equal(D.metrics(before).margin,20);
 const b=row([100,90,10]),a=row([150,130,20]),multi=D.metrics(a,b);assert.equal(multi.delta,100);assert.deepEqual(multi.batchShares.map(c=>c.share),[50,40,10]);assert.equal(multi.rawMargin,20);
 const activity=new N.Activity();activity.observe(before,after,1000);assert.equal(activity.drops(1000)[0].votes,100);
 const corrected=row([114,86]);assert.equal(D.metrics(corrected,after).delta,0);assert.deepEqual(D.metrics(corrected,after).batchShares,[]);
});
test('Readiness validates schedule content, referenced demographics/geometry and OBS dependencies; never certifies a local disk as Render verified',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fea-selftest-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'data'),{recursive:true});await mkdir(join(root,'assets'));
 for(const file of ['data/results','data/election-night-races.json','data/live-results.json','data/live-results-races','call-overlay.html'])await cp(file,join(root,file),{recursive:true});
 for(const file of ['desk-theme.js','night-awareness.js','night-awareness-board.js','results-desk-board.js','results-desk.js','results-ui.js','desk-appearance.js','projection-card.js','projection-card.css','overlay-model.js','call-overlay.js','call-overlay.css'])await cp('assets/'+file,join(root,'assets',file));
 const catalogue=JSON.parse(await readFile('data/election-night-races.json','utf8')).races;
 const control={storage:{directory:join(root,'disk'),durable:true},health:()=>({stale:false,status:'CONNECTED'}),results:()=>({groups:[{races:catalogue}]}),visible:{runtime:{races:{'senate-OH':{}}}},adminSnapshot:()=>({rosterAudit:{reviewed:0,total:0,placeholders:0,issues:[]}})};
 const check=async name=>(await readiness(control,root)).checks.find(c=>c.name===name);
 const healthy=await readiness(control,root);assert.equal(healthy.status,'WARNING');assert.equal(healthy.checks.find(c=>c.name==='Production persistence').status,'WARNING');
 for(const name of ['Candidate audit','Poll-close schedule','Geometry manifest','Demographics manifest','Storage writable'])assert.equal(healthy.checks.find(c=>c.name===name).status,'PASS',name);
 const schedulePath=join(root,'data/results/poll-closes.json'),original=await readFile(schedulePath);await writeFile(schedulePath,'{}');assert.equal((await check('Poll-close schedule')).status,'FAIL');await writeFile(schedulePath,original);
 const schedule=JSON.parse(original);schedule.events[0].states.push('GA');assert.throws(()=>validatePollSchedule(schedule),/Duplicate/);
 const demo=join(root,'data/results/demographics.json'),saved=await readFile(demo);await writeFile(demo,JSON.stringify({status:'available',file:'data/results/missing.json'}));assert.equal((await check('Demographics manifest')).status,'FAIL');await writeFile(demo,saved);
 await rm(join(root,'assets/projection-card.js'));assert.equal((await check('assets/projection-card.js')).status,'FAIL');
 await mkdir(join(root,'disk/result-calls.json'));assert.equal((await check('Storage writable')).status,'FAIL');await rm(join(root,'disk/result-calls.json'),{recursive:true});
 control.storage.directory=join(root,'storage-is-file');await writeFile(control.storage.directory,'not a directory');assert.equal((await check('Storage writable')).status,'FAIL');
});
import vm from 'node:vm';
test('A new public correction removes a visible older winner notice and its dismissal timer',async()=>{
 const cleared=[],oldCard={dataset:{raceId:'senate-OH'},_timer:42,remove(){this.removed=true;}},announcer={};
 const scope={window:{},FEAResultsUI:require('../../assets/results-ui.js'),STATE_NAMES:{OH:'Ohio'},document:{getElementById:id=>id==='projection-alerts'?{children:[oldCard]}:announcer},clearTimeout:id=>cleared.push(id)};
 vm.createContext(scope);vm.runInContext(await readFile('assets/results-desk-board.js','utf8'),scope);class Page{};scope.window.FEAEnhanceBoard(Page);
 const p=new Page(),r={id:'senate-OH',type:'senate',state:'OH'},other={race:{id:'senate-NC'},key:'keep'};p.alertQueue=[{race:r,key:'old'},other];let renders=0;p.renderProjectionQueue=()=>renders++;
 p.queueProjection({race:r,key:'retraction',correction:true,call:null});assert.equal(oldCard.removed,true);assert.deepEqual(cleared,[42]);assert.equal(p.alertQueue.length,2);assert.equal(p.alertQueue[0].key,'keep');assert.equal(p.alertQueue[1].key,'retraction');assert.equal(renders,1);assert.match(announcer.textContent,/Projection update/);
});
test('Open public calls content refreshes current calls and retains bounded recent correction indications',async()=>{
 const content={innerHTML:'',scrollTop:42,insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelectorAll(){return[];}};
 const scope={window:{FEANight:N},FEANight:N,STATE_NAMES:{OH:'Ohio',NC:'North Carolina'},FEAResultsUI:require('../../assets/results-ui.js'),document:{activeElement:null},console};
 vm.createContext(scope);vm.runInContext(await readFile('assets/night-awareness-board.js','utf8'),scope);class Page{};scope.window.FEANightAwareness(Page);
 const p=new Page(),oh={id:'senate-OH',type:'senate',state:'OH',calls:[{candidate:'First Person',provider:'NBC'}]},nc={id:'senate-NC',type:'senate',state:'NC',calls:[{candidate:'Second Person',provider:'FEA'}]};
 p.callsDialog={open:true,querySelector:()=>content};p.dataByMode={senate:[oh]};p.activity={items:[]};p.findDeskRace=id=>p.dataByMode.senate.find(r=>r.id===id);
 p.renderPublishedCalls();assert.match(content.innerHTML,/First Person/);p.dataByMode.senate.push(nc);p.renderPublishedCalls();assert.match(content.innerHTML,/Second Person/);assert.equal(content.scrollTop,42);
 oh.calls=[];p.activity.items=[{id:1,kind:'correction',race:oh.id,retracted:true}];p.renderPublishedCalls();assert.doesNotMatch(content.innerHTML,/First Person/);assert.match(content.innerHTML,/Projection withdrawn/);assert.match(content.innerHTML,/this session/);
});
test('Public refresh aborts a stalled heartbeat, releases its busy state, and retries a later heartbeat',async()=>{
 const timers=new Map();let id=0,delayed=0,requests=0;
 const scope={window:{},AbortController,setTimeout:(fn,ms)=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key),fetch:async(_,options)=>{requests++;if(requests===1)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout'))));return {status:304};}};
 vm.createContext(scope);vm.runInContext(await readFile('assets/results-desk-board.js','utf8'),scope);class Page{};scope.window.FEAEnhanceBoard(Page);const p=new Page();p.renderProviderStatus=()=>delayed++;p.retrySelectedDetail=async()=>{};
 const first=p.refreshResults();assert.equal(p.refreshBusy,true);[...timers.values()][0]();await first;assert.equal(p.refreshBusy,false);assert.equal(delayed,1);await p.refreshResults();assert.equal(requests,2);assert.equal(p.refreshBusy,false);assert.equal(timers.size,0);
});
test('A pre-election lab opened against a called public feed establishes a simulated baseline without phantom corrections',async()=>{
 const real={id:'senate-OH',type:'senate',state:'OH',candidates:[{name:'Proper Person',party:'D',votes:100}],calls:[{candidate:'Proper Person',provider:'NBC'}]};
 const scope={window:{},FEADesk:D,FEAResultsUI:require('../../assets/results-ui.js'),normalizeElectionRace:r=>structuredClone(r)};vm.createContext(scope);vm.runInContext(await readFile('assets/results-desk-board.js','utf8'),scope);class Page{};scope.window.FEAEnhanceBoard(Page);
 const p=new Page();Object.assign(p,{isLabPage:true,query:new URLSearchParams(),dataByMode:{},callTracker:new D.CallTracker(),safeJson:async url=>url==='/api/live-results'?{version:'test',groups:[{races:[real]}]}:null,normalizeComparisonModeForCurrentMap(){},applyLabMode(){for(const r of Object.values(this.dataByMode).flat()){r.calls=[];r.candidates.forEach(c=>c.votes=0);}},renderProviderStatus(){}});
 await p.loadData();assert.equal(p.callTracker.observe(Object.values(p.dataByMode).flat()).length,0);assert.equal(real.calls.length,1);
});
test('Lab history does not place old synthetic points after a newly observed batch',async()=>{
 const scope={window:{}};vm.createContext(scope);vm.runInContext(await readFile('assets/results-desk-board.js','utf8'),scope);class Page{};scope.window.FEAEnhanceBoard(Page);const p=new Page(),row={candidates:[{name:'Named Person',party:'D',votes:100},{name:'Other Person',party:'R',votes:90}]};
 const history=p.labHistory(row),at=new Date().toISOString();assert.ok(history.every(point=>Date.parse(point.at)<=Date.parse(at)));const added={at,candidates:[{name:'Named Person',party:'D',votes:155},{name:'Other Person',party:'R',votes:135}]};assert.equal(D.trendPoints([...history,added]).at(-1).candidates[0].votes,155);
});
test('NBC fetches state feeds with bounded concurrency, deterministic ordering and no requests for duplicate mappings',async()=>{
 const catalogue=Array.from({length:12},(_,i)=>({id:'senate-fixture-'+i,type:'senate',state:'OH',candidates:[{name:'Person '+i,party:'D'}]})),sources=catalogue.map((r,i)=>({status:'CONFIRMED',election:'2026-general',url:'https://www.nbcnews.com/firecracker/test/'+i,races:[{feaRaceId:r.id,providerRaceId:String(i)}]}));
 let active=0,peak=0,started=0;const releases=[];
 const provider=new NbcProvider({sources,fetchImpl:async url=>{const i=Number(String(url).split('/').at(-1));active++;started++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;return new Response(JSON.stringify({stateAbbr:'OH',electionDate:'2026-11-03',races:[{summary:{raceId:String(i),officeName:'US Senate',candidates:[{name:'Person '+i,party:'DEM',votes:10}]}}]}));}});
 const pending=provider.fetchResults(catalogue);await new Promise(resolve=>setImmediate(resolve));assert.equal(started,8);releases.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));assert.equal(started,12);releases.splice(0).forEach(resolve=>resolve());const rows=await pending;assert.equal(peak,8);assert.deepEqual(rows.map(r=>r.id),catalogue.map(r=>r.id));
 sources[1].races[0].feaRaceId=sources[0].races[0].feaRaceId;await assert.rejects(provider.fetchResults(catalogue),/Duplicate source mappings/);assert.equal(started,12);
});
import {ResultsControl} from '../../scripts/results/control.mjs';
test('Malformed provider configuration cannot blank recovered votes/calls or crash the public health response',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fea-config-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));await mkdir(join(root,'.runtime'));
 const race={id:'senate-OH',type:'senate',state:'OH',candidates:[{name:'Named Person',party:'D',votes:100},{name:'Other Person',party:'R',votes:80}]},calls={races:{'senate-OH':{manualOverride:true,callState:'MANUAL_FEA_CALL',calls:[{candidate:'Named Person',status:'projected',source:'fea-manual'}]}}};
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:[race]}));await writeFile(join(root,'data/result-calls.json'),JSON.stringify(calls));await writeFile(join(root,'.runtime/results-state.json'),JSON.stringify({races:{[race.id]:race},health:{},audit:[],committedCalls:calls}));
 for(const config of ['{invalid',JSON.stringify({sources:'not an array'}),JSON.stringify({sources:[null]})]){
  await writeFile(join(root,'data/results-provider.json'),config);const c=await new ResultsControl({root}).init();await c.poll();const row=c.results().groups.flatMap(g=>g.races)[0];assert.equal(row.candidates[0].votes,100);assert.equal(row.calls[0].candidate,'Named Person');assert.ok(c.health().stale);assert.ok(c.adminSnapshot().health.configurationError);assert.equal(c.health().sources.length,0);
 }
});
test('A 506-race burst highlights every changed race and retains the largest raw vote drop beyond the 200-item feed',()=>{
 const a=new N.Activity(),row=(id,votes,version)=>({id,version,expectedVotePercent:votes?10:0,candidates:[{name:'Named Person',party:'D',votes}],calls:[]});
 for(let i=0;i<506;i++)a.observe(row('race-'+i,0,'before'),row('race-'+i,i===0?100000:100,'after'),1000);
 assert.equal(a.items.length,200);assert.equal(a.changed(1000).length,506);assert.ok(a.changed(1000).includes('race-0'));assert.deepEqual(a.drops(1000)[0],{race:'race-0',votes:100000});
 a.observe(row('race-0',100000,'after'),row('race-0',99900,'correction'),1001);assert.equal(a.drops(1001)[0].votes,99900);
 a.observe(row('details-only',0,'old'),row('details-only',0,'new'),1002);assert.ok(a.changed(1002).includes('details-only'));
 assert.equal(a.changed(61003).length,0);assert.equal(a.drops(301003).length,0);
});
test('Recent correction indications survive noisy vote updates and all auxiliary activity data remains bounded',()=>{
 const a=new N.Activity();a.add({kind:'correction',race:'important',retracted:true},1000);
 for(let i=0;i<15000;i++)a.add({kind:'votes',race:'race-'+i,votes:1},1000);
 assert.equal(a.items.length,200);assert.ok(a.recentChanges.size<=1000);assert.equal(a.voteBatches.length,12000);assert.equal(a.corrections.length,1);assert.equal(a.corrections[0].race,'important');
 a.prune(1801001);assert.equal(a.items.length,0);assert.equal(a.voteBatches.length,0);assert.equal(a.recentChanges.size,0);assert.equal(a.corrections.length,0);
});
test('What Changed retains every updated county even when local activity overflows the drawer',()=>{
 const a=new N.Activity();for(let i=0;i<254;i++){a.add({kind:'votes',race:'senate-TX',county:String(i),votes:100},1000);a.add({kind:'reporting',race:'senate-TX',county:String(i),reporting:50},1000);}
 assert.equal(a.items.length,200);assert.equal(a.changedCounties(1000).length,254);assert.equal(a.changed(1000).length,1);assert.equal(a.drops(1000).length,0);assert.equal(a.changedCounties(61001).length,0);
});

test('County history retries failed loads and an older request cannot evict a newer version',async()=>{
 const scope={window:{}};vm.createContext(scope);vm.runInContext(await readFile('assets/results-desk-board.js','utf8'),scope);class Page{};scope.window.FEAEnhanceBoard(Page);const p=new Page(),race={id:'senate-NH',version:'v1'};let current=race,resolveOld;
 p.panelData=()=>current;p.safeJson=async()=>null;
 assert.equal((await p.loadCountyHistory(race,'town')).length,0);assert.equal(p.countyHistories.size,0);assert.equal(p.countyHistoryRetry,'senate-NH:town');
 p.safeJson=()=>new Promise(resolve=>resolveOld=resolve);const older=p.loadCountyHistory(race,'town');current={...race,version:'v2'};p.liveRaceIndex=[current];p.safeJson=async()=>({voteHistory:[{at:'new'}]});await p.loadCountyHistory(current,'town');resolveOld({voteHistory:[{at:'old'}]});await older;
 assert.equal(p.countyHistories.get('senate-NH:town:v2')[0].at,'new');assert.equal(p.countyHistories.get('senate-NH:town')[0].at,'new');assert.equal(p.countyHistories.has('senate-NH:town:v1'),false);
});

test('Asynchronous Trends restores scroll after drawing, without overriding newer views or user input',async()=>{
 let finish;const content={scrollTop:0},scope={window:{},FEADeskTheme:{},document:{getElementById:()=>content,querySelectorAll:()=>[]}};vm.createContext(scope);vm.runInContext(await readFile('assets/desk-experience.js','utf8'),scope);
 class Page{async renderTrendChart(){this.trendRenderRevision=(this.trendRenderRevision||0)+1;await new Promise(resolve=>finish=resolve);}}scope.window.FEACompleteBoard(Page);const p=new Page();p.currentRace={id:'senate-NH'};p.focusedPanelTab='trends';p.lockedCounty='town';p.trendScrollRestore={key:'senate-NH:trends:town',top:227};
 const first=p.renderTrendChart();assert.equal(content.scrollTop,0);finish();await first;assert.equal(content.scrollTop,227);
 content.scrollTop=30;const second=p.renderTrendChart();p.trendScrollInteraction=1;content.scrollTop=42;finish();await second;assert.equal(content.scrollTop,42);
 const third=p.renderTrendChart();p.currentRace={id:'senate-ME'};content.scrollTop=0;finish();await third;assert.equal(content.scrollTop,0);
});
