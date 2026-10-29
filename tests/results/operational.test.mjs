import test from 'node:test';import assert from 'node:assert/strict';
import {verifyOfficialRoster} from '../../scripts/results/apply-official-verification.mjs';
import {southDakotaBallots,californiaBallots,coloradoBallots} from '../../scripts/results/official-ballots.mjs';
import {parseNbcResults,NbcProvider} from '../../scripts/results/nbc-provider.mjs';
import {auditCandidateFiles} from '../../scripts/results/audit-candidates.mjs';
test('Official verification requires complete one-to-one identities, compatible parties and dated hashed authority provenance',()=>{
 const race={id:'senate-SD',state:'SD',candidates:[{name:'Brian Bengs',party:'I'},{name:'Mike Rounds',party:'R'}]},source={candidates:structuredClone(race.candidates)},metadata={authority:'South Dakota Secretary of State',sourceUrl:'https://vip.sdsos.gov/candidatelist.aspx?eid=774',checkedAt:'2026-10-29',electionDate:'2026-11-03',sha256:'a'.repeat(64),scope:'All active Senate candidates'};
 const facts=[{name:'Brian L Bengs',party:'I'},{name:'Mike Rounds',party:'R'}];assert.throws(()=>verifyOfficialRoster(race,source,facts.slice(1),metadata),/count/);assert.throws(()=>verifyOfficialRoster(race,source,[{name:'Brian Bengs',party:'D'},facts[1]],metadata),/party/);assert.throws(()=>verifyOfficialRoster(race,source,facts,{...metadata,sha256:''}),/provenance/);
 const result=verifyOfficialRoster(race,source,facts,metadata);assert.equal(result.candidates[0].ballotName,'Brian L Bengs');assert.equal(race.rosterVerified,true);assert.ok(race.candidates[0].aliases.includes('Brian L Bengs'));
});
test('Stored authority verification covers 71 new complete scopes without falsely calling secondary reviews official',()=>{
 const audit=auditCandidateFiles();assert.equal(audit.passed,true);assert.ok(audit.official>=81);assert.equal(audit.official+audit.secondaryReviewed,506);assert.equal(audit.providerMismatches.count,null);assert.ok(audit.unverified.senate.length>0);assert.ok(audit.unverified.watchTossup.length>0);assert.equal(audit.emptyRosters.length,0);
});
test('Official SD parser excludes withdrawn candidates, includes independent Senate and strips only governor running mate',()=>{
 const row=(office,name,party,status='Active')=>'<tr>'+[office,name,party,'','','','','','','','','','',status,'General','11/3/2026 12:00:00 AM'].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
 const html='2026 General Election Candidate List'+row('United States Senator','Withdrawn Person','DEM','Withdrawn')+row('United States Senator','Brian L Bengs','IND')+row('United States Representative','Nicole &quot;Nikki&quot; Gronli','DEM')+row('Governor and Lieutenant Governor','First Person &amp; Running Mate','REP');
 const parsed=southDakotaBallots(html);assert.equal(parsed['senate-SD'].length,1);assert.equal(parsed['senate-SD'][0].party,'I');assert.equal(parsed['house-SD-AL'][0].name,'Nicole "Nikki" Gronli');assert.equal(parsed['governor-SD'][0].name,'First Person');assert.throws(()=>southDakotaBallots(html.replaceAll('2026','2024')),/identity/);
});
test('Authority parsers preserve California designation lines and Colorado write-ins while excluding withdrawn entries',()=>{
 const block=(heading,i)=>'                              '+heading+'\n        Named Person '+i+'           Democratic\n          Member of Congress\n        Other Person '+i+'           Republican\n';
 const text='General Election - November 3, 2026\nOfficial Certified List of Candidates\n'+block('Governor',0)+Array.from({length:52},(_,i)=>block('United States Representative District '+(i+1),i+1)).join('')+'                              State Senate District 2\n        Ignored Person           Democratic\n';const ca=californiaBallots(text);assert.equal(Object.keys(ca).length,53);assert.equal(ca['house-CA-52'].length,2);assert.throws(()=>californiaBallots(text.replace('District 52','District 51')),/incomplete/);
 const row=(name,office,district,party,writeIn='N')=>'<tr>'+[name,office,district,party,writeIn].map(v=>'<td>'+v+'</td>').join('')+'</tr>';
 const html='2026 General Election Official Candidate List; certified to the counties'+row('Senate Person','US Senate','State','Republican Party','Y')+row('Governor Person','Governor','State','Democratic Party')+Array.from({length:8},(_,i)=>row('House Person '+i,'US House of Representatives',i+1,'Libertarian Party')).join('')+row('<del>Withdrawn Person</del>','US Senate','State','Republican Party');const co=coloradoBallots(html);assert.equal(co['senate-CO'].length,1);assert.equal(co['senate-CO'][0].writeIn,true);
});
const local={id:'house-OH-1',type:'house',state:'OH',district:1,rosterReviewed:true,candidates:[{name:'First Person',party:'D'},{name:'Second Person',party:'R'}]};
const source={url:'https://www.nbcnews.com/firecracker/synthetic-contract-test',status:'CONFIRMED',election:'2026-general',races:[{feaRaceId:local.id,providerRaceId:'test'}],projection:{verified:true,candidateFlag:'isWinner'}};
const payload=()=>({stateAbbr:'OH',electionDate:'2026-11-03',lastUpdated:'2026-11-04T02:00:00Z',races:[{summary:{raceId:'test',officeName:'US House',district:1,percentIn:50,candidates:[{name:'First Person',party:'DEM',votes:100,isWinner:true},{name:'Second Person',party:'REP',votes:90,isWinner:false}]}}]});
test('Synthetic provider contract: identities, date, district, explicit call, explicit withdrawal, missing flag quarantine and duplicate winner',()=>{
 assert.equal(parseNbcResults(payload(),source,[local])[0].providerCall.candidate,'First Person');
 const withdrawn=payload();withdrawn.races[0].summary.candidates[0].isWinner=false;assert.equal(parseNbcResults(withdrawn,source,[local])[0].providerCall,null);
 for(const mutate of [p=>p.races[0].summary.candidates.pop(),p=>p.races[0].summary.candidates[0].name='Unexpected Person',p=>p.races[0].summary.candidates[1].isWinner=true,p=>p.electionDate='2026-05-01',p=>p.races[0].summary.district=2,p=>delete p.races[0].summary.candidates[0].isWinner,p=>p.races[0].summary.candidates.forEach(c=>delete c.isWinner)]){const p=payload();mutate(p);assert.throws(()=>parseNbcResults(p,source,[local]));}
 const unverified=payload();assert.equal(parseNbcResults(unverified,{...source,projection:{verified:false}},[local])[0].providerCall,null);
});
test('Conditional upstream requests preserve validated bodies on 304 and recover after one failed request',async()=>{
 const headers=[],responses=[new Response(JSON.stringify(payload()),{headers:{etag:'"v1"','last-modified':'Wed, 04 Nov 2026 02:00:00 GMT'}}),new Response(null,{status:304}),new Response('broken',{status:500}),new Response(JSON.stringify(payload()),{headers:{etag:'"v2"'}})];
 const provider=new NbcProvider({sources:[source],fetchImpl:async(_,options)=>{headers.push(options.headers);return responses.shift();}});await provider.fetchResults([local]);assert.equal((await provider.fetchResults([local]))[0].candidates[0].votes,100);assert.equal(headers[1]['If-None-Match'],'"v1"');assert.ok(headers[1]['If-Modified-Since']);await assert.rejects(provider.fetchResults([local]),/500/);assert.equal((await provider.fetchResults([local])).length,1);assert.equal(provider.quarantined.length,0);
 const noCache=new NbcProvider({sources:[source],fetchImpl:async()=>new Response(null,{status:304})});await assert.rejects(noCache.fetchResults([local]),/304 without/);
});
