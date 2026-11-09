import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {matchBallotCandidate} from '../../scripts/results/candidate-roster.mjs';
import {modelVersion,simulateWinProbability} from '../../scripts/results/win-probability.mjs';
import {LiveProbability,validateProbabilityRelease} from '../../scripts/results/probability-live.mjs';
import {runProbabilityReplay,readProbabilityReplay,scoreProbabilityReplay} from '../../scripts/results/probability-replay.mjs';
import {benchmarkProbability} from '../../scripts/results/probability-benchmark.mjs';
import {readProbabilityCapture} from '../../scripts/results/probability-capture.mjs';
import {compareSparsePairFallbacks,fitTurnoutWeight,evaluateTurnoutWeight} from '../../scripts/results/probability-turnout-study.mjs';
import {countOnlyEstimate,readApCheckpoints,readNyt2022Ballots} from '../../scripts/results/probability-count-study.mjs';
import {scoreGeorgiaRunoffs} from '../../scripts/results/probability-georgia-runoff-study.mjs';
import {estimateFromBallotAnalogs} from '../../scripts/results/probability-ballot-study.mjs';
import {benchmarkStatewideProxy,fitHistoricalTurnout,statewideFeatures} from '../../scripts/results/probability-statewide-study.mjs';
import {firstCountBounds,firstCountOutcome} from '../../scripts/results/probability-rule-outcomes.mjs';
import {alignWinnerMass,allocateJointDraw,roundedPairEndpoints} from '../../scripts/results/probability-joint-study.mjs';
import {buildCountyProbabilityPrior,evaluateRegularProbability,matchFrozenCandidateCenter,normalizeProbabilitySnapshot,probabilityGeographyBasis,probabilityRule,readGeographicReferences} from '../../scripts/results/probability-inputs.mjs';

const settings={simulations:1200};
test('Rounded historical checkpoints retain the full feasible vote range',()=>{
  const row={total:10000,ranked:[{share:.502},{share:.498}]};
  assert.deepEqual(roundedPairEndpoints(row).map(x=>x.votes),[[5015,4985],[5025,4975]]);
});
const ids=['d','r','other'];
const prior={raceId:'senate-fixture',office:'senate',rule:'plurality',electionDate:'2026-11-03',
  availableAt:'2026-11-02T20:00:00Z',source:'Frozen fixture prior',candidateIds:ids,marginCandidateIds:['d','r'],
  units:[
    {id:'metro',region:'east',turnout:1000,turnoutLogSd:.14,shares:{d:.75,r:.20,other:.05}},
    {id:'rural',region:'west',turnout:1000,turnoutLogSd:.14,shares:{d:.20,r:.75,other:.05}},
    {id:'large-late',region:'west',turnout:9000,turnoutLogSd:.14,shares:{d:.25,r:.70,other:.05}},
  ]};
function snapshot(minute,rows) {
  const at=`2026-11-04T02:${String(minute).padStart(2,'0')}:00Z`;
  const units=rows.map(([d,r,other,complete],index)=>({id:prior.units[index].id,availableAt:at,
    complete,votes:{d,r,other},...(complete?{completionSource:'Fixture completion notice'}:{})}));
  return {raceId:prior.raceId,at,sourceUpdatedAt:at,source:'Fixture returns',units,
    totals:Object.fromEntries(ids.map(id=>[id,units.reduce((sum,unit)=>sum+unit.votes[id],0)]))};
}
const early=snapshot(0,[[750,200,50,true],[0,0,0,false],[0,0,0,false]]);
const middle=snapshot(10,[[750,200,50,true],[200,750,50,true],[0,0,0,false]]);
const late=snapshot(20,[[750,200,50,true],[200,750,50,true],[4010,3990,100,false]]);
const final=snapshot(30,[[750,200,50,true],[200,750,50,true],[4510,4490,200,true]]);

test('NBC No Labels code matches the reviewed ballot party without weakening party checks',()=>{
  const roster=[{name:'Teri Hourihan',aliases:['Teri Ann Hourihan'],party:'No Labels Party'}];
  assert.equal(matchBallotCandidate({name:'Teri Ann Hourihan',partyCode:'NOL'},roster).name,'Teri Hourihan');
  assert.throws(()=>matchBallotCandidate({name:'Teri Ann Hourihan',partyCode:'I'},roster),/party mismatch/);
});

test('Election rules separate ranked-choice, runoff and legislative outcomes from plurality',()=>{
  const date='2026-11-03';
  assert.equal(probabilityRule('senate-AK',date),'ranked-choice');
  assert.equal(probabilityRule('house-ME-2',date),'ranked-choice');
  assert.equal(probabilityRule('governor-ME',date),'plurality');
  assert.equal(probabilityRule('senate-GA',date),'majority-runoff');
  assert.equal(probabilityRule('house-LA-1',date),'majority-runoff');
  assert.equal(probabilityRule('governor-VT',date),'legislative-contingency');
  assert.equal(probabilityRule('senate-OH',date),'plurality');
});

test('Geographic prior uses compatible reporting units and preserves a frozen candidate forecast',()=>{
  const {races}=readGeographicReferences();
  const geography=races.find(race=>race.raceId==='house-ND-1' || race.raceId==='house-ND-AL');
  assert.ok(geography?.countyReferences.length>1);
  const forecast={raceId:geography.raceId,rule:'plurality',electionDate:'2026-11-03',
    availableAt:'2026-11-02T18:00:00Z',source:'Fixture frozen forecast',turnout:500001,turnoutLogSd:.15,
    candidates:[{id:'d',party:'D',share:.48},{id:'r',party:'R',share:.52}],
    regions:Object.fromEntries(geography.countyReferences.map(row=>[row.fips,'test-region']))};
  const result=buildCountyProbabilityPrior(geography,forecast);
  assert.equal(result.units.reduce((sum,unit)=>sum+unit.turnout,0),forecast.turnout);
  assert.ok(Math.abs(result.units.reduce((sum,unit)=>sum+unit.turnout*unit.shares.d,0)/forecast.turnout-.48)<1e-9);
  assert.throws(()=>buildCountyProbabilityPrior({...geography,countyReferences:geography.countyReferences.slice(1)},forecast),/reconcile/);
  const alternate=races.find(race=>race.raceId==='senate-AL');
  assert.equal(probabilityGeographyBasis(alternate),'two-party-votes');
  const alternatePrior=buildCountyProbabilityPrior(alternate,{...forecast,raceId:alternate.raceId,
    regions:Object.fromEntries(alternate.countyReferences.map(row=>[row.fips,'test-region']))});
  assert.equal(alternatePrior.geographyBasis,'two-party-votes');
  assert.equal(alternatePrior.units.reduce((sum,unit)=>sum+unit.turnout,0),forecast.turnout);
  const [first,...other]=alternate.countyReferences;
  assert.equal(probabilityGeographyBasis({...alternate,countyReferences:[{...first,demVotes:first.demVotes-1},...other]}),null);
  const multi={...forecast,candidates:[{id:'d',party:'D',share:.47},{id:'r',party:'R',share:.49},{id:'l',party:'L',share:.04}]};
  assert.throws(()=>buildCountyProbabilityPrior(geography,multi),/Missing frozen county shares/);
  multi.otherUnitShares=Object.fromEntries(geography.countyReferences.map(row=>[row.fips,{l:.04}]));
  const multiPrior=buildCountyProbabilityPrior(geography,multi);
  assert.deepEqual(multiPrior.candidateIds,['d','r','l']);
  for (const candidate of multi.candidates)
    assert.ok(Math.abs(multiPrior.units.reduce((sum,unit)=>sum+unit.turnout*unit.shares[candidate.id],0)/multi.turnout-candidate.share)<1e-9);
  multi.otherUnitShares[geography.countyReferences[0].fips]={l:.06};
  assert.throws(()=>buildCountyProbabilityPrior(geography,multi),/do not reconcile/);
  assert.throws(()=>readGeographicReferences(process.cwd(),{ohioDistrictCsv:'ShortName,CD,Harris,Trump,Total\nBad,1,1,1,2'}),/Unmapped/);
  const duplicatedSplit=['County,ShortName,CD,Harris,Trump,Total',
    'Deaf Smith,DeafSmith,19,10,20,30',',Split E/A/P Votes,,,,',
    'Deaf Smith,DeafSmith,19,0,2,2','Deaf Smith,DeafSmith,19,0,2,2'].join('\n');
  assert.throws(()=>readGeographicReferences(process.cwd(),{texasDistrictCsv:duplicatedSplit}),/duplicate split ballot row/);
});

test('Nationwide workbook import checks district totals and isolates unmapped source districts',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fea-probability-tables-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const {races}=readGeographicReferences();
  const ny=races.find(row=>row.raceId==='house-NY-11').reference;
  const tx=races.find(row=>row.raceId==='house-TX-14').reference;
  const mid=value=>Math.floor(value/2);
  const first=[mid(ny.demVotes),mid(ny.repVotes),mid(ny.totalVotes)];
  const second=[ny.demVotes,ny.repVotes,ny.totalVotes].map((votes,i)=>votes-first[i]);
  await writeFile(join(directory,'NY.csv'),[
    'County,ShortName,CD,Harris,Trump,Total',
    'NYC - Staten Island,NYC_SI,11,'+first.join(','),
    'NYC - Brooklyn (pt.),NYC_BK,11,'+second.join(','),
    'Unmapped,Unmapped,12,1,1,2',
  ].join('\n'));
  await writeFile(join(directory,'TX.csv'),[
    'County,ShortName,CD,Harris,Trump,Total',
    'Galveston,Galveston,14,'+[tx.demVotes,tx.repVotes,tx.totalVotes].join(','),
  ].join('\n'));
  const loaded=readGeographicReferences(process.cwd(),{districtTablesDir:directory});
  const district=loaded.races.find(row=>row.raceId==='house-NY-11');
  assert.equal(probabilityGeographyBasis(district),'all-votes');
  assert.deepEqual(district.countyReferences.map(row=>row.fips),['36085','36047']);
  assert.match(loaded.workbooks.NY.rejected['NY-12'],/Unmapped county/);
  assert.equal(loaded.workbooks.CA.error,'Table export missing');
  const texas=loaded.races.find(row=>row.raceId==='house-TX-14');
  assert.deepEqual(texas.countyReferences,[]);
  assert.match(loaded.workbooks.TX.rejected['TX-14'],/official Texas district county set/);
});

test('NBC expected vote metadata never supplies a completion notice',()=>{
  const roster=[{id:'d',name:'Alex Doe',party:'D'},{id:'r',name:'Jamie Roe',party:'R'}];
  const updatedAt='2026-11-04T02:00:00Z';
  const candidates=(d,r)=>roster.map((candidate,i)=>({...candidate,votes:i?r:d}));
  const detail={id:'senate-fixture',provider:'NBC',electionDate:'2026-11-03',updatedAt,expectedVotePercent:91,
    candidates:candidates(100,100),counties:[
      {fips:'39001',source:'NBC News',updatedAt,expectedVotePercent:100,candidates:candidates(60,40)},
      {fips:'39003',source:'NBC News',updatedAt,expectedVotePercent:82,candidates:candidates(40,60)},
    ]};
  const capture={at:'2026-11-04T02:00:10Z',source:'Fixture NBC snapshot',maxAgeMs:30000};
  const observed=normalizeProbabilitySnapshot(detail,roster,capture);
  assert.throws(()=>normalizeProbabilitySnapshot({...detail,providerBallotAccounting:{ballotsOutsideCandidateTotals:6021}},roster,capture),/ballot-aware probability model/);
  assert.equal(observed.expectedVotePercent,91);
  assert.equal(observed.units[0].expectedVotePercent,100);
  assert.equal(observed.units[0].complete,false);
  const completion={'39001':{raceId:detail.id,unitId:'39001',electionDate:detail.electionDate,
    availableAt:updatedAt,countedVotes:100,source:'Fixture county completion notice'}};
  assert.equal(normalizeProbabilitySnapshot(detail,roster,{...capture,completion}).units[0].complete,true);
  assert.throws(()=>normalizeProbabilitySnapshot({...detail,candidates:candidates(101,100)},roster,capture),/reconcile/);
  assert.throws(()=>normalizeProbabilitySnapshot({...detail,candidates:candidates(101,100).slice(0,1)},roster,capture),/frozen roster/);
  assert.equal(evaluateRegularProbability({electionDate:detail.electionDate},detail,roster,{...capture,maxAgeMs:1000}).status,'unavailable');
  const frozen={raceId:detail.id,electionDate:detail.electionDate,office:'senate',rule:'plurality',
    availableAt:'2026-11-02T18:00:00Z',source:'Fixture prior',candidateIds:['d','r'],marginCandidateIds:['d','r'],
    units:detail.counties.map((county,i)=>({id:county.fips,region:'region-'+i,turnout:120,turnoutLogSd:.15,shares:{d:.5,r:.5}}))};
  const verified={...completion,'39003':{...completion['39001'],unitId:'39003'}};
  assert.match(evaluateRegularProbability(frozen,{...detail,provider:'CivicAPI'},roster,capture).reason,/Waiting for NBC/);
  assert.match(evaluateRegularProbability(frozen,{...detail,counties:[{...detail.counties[0],source:'CivicAPI'},detail.counties[1]]},roster,capture).reason,/Waiting for NBC/);
  const result=evaluateRegularProbability(frozen,detail,roster,{...capture,completion:verified});
  assert.equal(result.status,'research');
  assert.equal(result.providerExpectedVotePercent,91);
  assert.equal(result.verifiedComplete,true);
});
test('Municipality counts align to frozen county portions without losing votes or masking stale units',()=>{
  const roster=[{id:'d',name:'Alex Doe',party:'D'},{id:'r',name:'Jamie Roe',party:'R'}];
  const at='2026-11-04T02:10:00Z',old='2026-11-04T01:00:00Z';
  const candidates=(d,r)=>roster.map((candidate,i)=>({...candidate,votes:i?r:d}));
  const unit=(fips,d,r,updatedAt=at)=>({fips,source:'NBC News',updatedAt,estimatedVoteReporting:100,candidates:candidates(d,r)});
  const detail={id:'house-MA-fixture',provider:'NBC',electionDate:'2026-11-03',updatedAt:at,
    candidates:candidates(150,130),counties:[
      unit('2500100010',60,40,old),unit('2500100020',20,30),
      unit('2500300010',70,60),
    ]};
  const capture={at,source:'NBC News',reportingUnitIds:['25001','25003']};
  const result=normalizeProbabilitySnapshot(detail,roster,capture);
  assert.deepEqual(result.units.map(unit=>[unit.id,unit.votes]),[
    ['25001',{d:80,r:70}],['25003',{d:70,r:60}],
  ]);
  assert.equal(result.units[0].availableAt,old);
  assert.ok(result.units.every(unit=>!unit.complete));
  assert.throws(()=>normalizeProbabilitySnapshot({...detail,counties:[...detail.counties,detail.counties[0]]},roster,capture),/Duplicate reporting units/);
  assert.throws(()=>normalizeProbabilitySnapshot({...detail,counties:[...detail.counties,unit('25001',1,1)]},roster,capture),/overlap/);
  assert.throws(()=>normalizeProbabilitySnapshot(detail,roster,{...capture,reportingUnitIds:['25001','25005']}),/outside/);
  const completion={'25001':{raceId:detail.id,unitId:'25001',electionDate:detail.electionDate,
    availableAt:at,countedVotes:150,source:'Fixture county certification'}};
  assert.equal(normalizeProbabilitySnapshot(detail,roster,{...capture,completion}).units[0].complete,true);
});

test('Frozen centers check the named matchup, district, and publication time',()=>{
  const race={id:'house-OH-1',state:'OH',type:'house',district:1,electionDate:'2026-11-03',
    candidates:[{name:'Alex Doe',party:'D'},{name:'Jamie Roe',party:'R'},{name:'Devin Roe',party:'I'}]};
  const row={state:'OH',id:'OH-01',matchupStatus:'CONFIRMED_MATCHUP',projectedMargin:2.1,dem:'Alex Doe',rep:'Jamie Roe'};
  const forecast={row,office:'house',generatedAt:'2026-11-02T18:00:00Z'};
  const meta={availableAt:'2026-11-02T19:00:00Z',source:'Frozen fixture commit'};
  const center=matchFrozenCandidateCenter(race,forecast,meta);
  assert.equal(center.projectedMargin,2.1);
  assert.equal(center.twoCandidateRace,false);
  assert.throws(()=>matchFrozenCandidateCenter(race,{...forecast,row:{...row,id:'OH-02'}},meta),/different race/);
  assert.throws(()=>matchFrozenCandidateCenter(race,{...forecast,row:{...row,rep:'Devin Roe'}},meta),/party mismatch/);
  assert.throws(()=>matchFrozenCandidateCenter(race,forecast,{...meta,availableAt:'2026-11-04T00:00:00Z'}),/not frozen/);
});

test('Reviewed regular-model release runs off-thread, keeps history on restart, and marks CivicAPI delayed',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fea-live-probability-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const policy={method:'full-coverage',settings:{simulations:1200}};
  const raceId='senate-fixture';
  const roster=[{id:'d',name:'Alex Doe',party:'D'},{id:'r',name:'Jamie Roe',party:'R'}];
  const prior={raceId,office:'senate',rule:'plurality',electionDate:'2026-11-03',
    availableAt:'2026-11-02T18:00:00Z',source:'Fixture prior',candidateIds:['d','r'],marginCandidateIds:['d','r'],
    units:['39001','39003','39005'].map((id,i)=>({id,region:i?'west':'east',turnout:120,turnoutLogSd:.15,shares:{d:.5,r:.5}}))};
  const release={policy,reviewedAt:'2026-11-02T20:00:00Z',reviewedBy:'Fixture reviewer',
    benchmark:{modelVersion,method:'full-coverage',status:'requires-independent-review',
      policyHash:createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
      inputHash:'a'.repeat(64),truthHash:'b'.repeat(64),
      cohorts:[{cohort:'senate:5',status:'passes-screen',cycles:2,races:8}]},races:{[raceId]:{prior,roster}}};
  assert.throws(()=>validateProbabilityRelease({...release,policy:{...policy,settings:{simulations:500}}}),/benchmark evidence/);
  assert.throws(()=>validateProbabilityRelease({...release,reviewedBy:''}),/benchmark evidence/);
  const rankedId='senate-AK';
  assert.throws(()=>validateProbabilityRelease({...release,races:{[rankedId]:{prior:{...prior,raceId:rankedId},roster}}}),/benchmark evidence/);
  const nationalRelease={...release,races:Object.fromEntries(Array.from({length:506},(_,i)=>{
    const raceId='senate-test-'+i;
    return [raceId,{prior:{...prior,raceId},roster}];
  }))};
  const national=new LiveProbability(directory);
  await national.load(nationalRelease);
  const visited=[];
  let active=0,peak=0;
  for(let batch=0;batch<43;batch++) await national.updateBatch(async id=>{
    visited.push(id);
    peak=Math.max(peak,++active);
    await Promise.resolve();
    active--;
    if (id==='senate-test-0') throw Error('One malformed source');
  },(id,error)=>{
    if(error) assert.equal(id,'senate-test-0');
  });
  assert.equal(new Set(visited.slice(0,506)).size,506);
  assert.equal(peak,2);
  // Vote-drop races are processed before the ordinary round-robin slice.
  const priorityVisited=[];
  national.prioritize(['senate-test-400','senate-test-401']);
  await national.updateBatch(async id=>{priorityVisited.push(id);},()=>{},{limit:4});
  assert.deepEqual(priorityVisited.slice(0,2),['senate-test-400','senate-test-401']);
  assert.equal(priorityVisited.length,4);
  const allVisited=[];
  await national.updateAll(async id=>{allVisited.push(id);},()=>{},{concurrency:2});
  assert.equal(allVisited.length,506);
  assert.equal(new Set(allVisited).size,506);
  const hydrated=new Set();
  for(let batch=0;batch<169;batch++){
    const selected=national.nextCountyRaces(()=>true,3);
    assert.equal(selected.length,3);
    for(const id of selected)hydrated.add(id);
  }
  assert.equal(hydrated.size,506);
  assert.deepEqual(national.nextCountyRaces(id=>id==='senate-test-0',4),['senate-test-0']);
  assert.deepEqual(national.nextCountyRaces(()=>false,4),[]);
  let now=Date.parse('2026-11-04T02:00:10Z');
  const updatedAt=new Date(now-1000).toISOString(),frozenDate=prior.electionDate;
  const rows=(d,r)=>roster.map((row,i)=>({...row,votes:i?r:d}));
  const county=(fips,d,r)=>({fips,updatedAt,source:'NBC News',candidates:rows(d,r)});
  const detail={id:raceId,provider:'NBC',electionDate:frozenDate,updatedAt,candidates:rows(110,100),
    counties:[county('39001',60,40),county('39003',40,60),county('39005',10,0)]};
  const completion=Object.fromEntries(['39001','39003'].map(unitId=>[unitId,{unitId,raceId,
    electionDate:frozenDate,availableAt:updatedAt,source:'Fixture report',countedVotes:100}]));
  let attempts=0;
  const pending=new LiveProbability(directory,{now:()=>now,simulate:(...args)=>{
    attempts++;
    return simulateWinProbability(...args);
  }});
  await pending.load(release);
  await pending.update(raceId,detail);
  await pending.update(raceId,{...detail,updatedAt:new Date(now).toISOString()});
  assert.equal(attempts,1);
  assert.equal(pending.view(raceId).status,'waiting');
  await pending.update(raceId,detail,{[completion['39001'].unitId]:completion['39001']});
  assert.equal(attempts,2);
  const live=new LiveProbability(directory,{now:()=>now});
  await live.load(release);
  await live.update(raceId,detail);
  assert.equal(live.view(raceId).status,'waiting');
  assert.match(live.view(raceId).reason,/completed reporting units/);
  await live.update(raceId,detail,completion);
  const first=live.view(raceId);
  assert.equal(first.status,'live');
  assert.equal(first.points.length,1);
  assert.ok(first.points[0].candidates.every(row=>row.probability>0 && row.probability<1));
  const reloaded=new LiveProbability(directory,{now:()=>now,simulate:()=>assert.fail('Unchanged returns should not start a worker')});
  await reloaded.load(release);
  assert.equal(reloaded.view(raceId).status,'stale');
  await reloaded.update(raceId,detail,completion);
  assert.deepEqual(reloaded.view(raceId),first);
  await reloaded.update(raceId,{...detail,provider:'CivicAPI'},completion);
  assert.equal(reloaded.view(raceId).status,'stale');
  assert.deepEqual(reloaded.view(raceId).points,first.points);
  assert.match(reloaded.view(raceId).reason,/verified NBC update/);
});

test('Regional completion guard and large outstanding county outweigh an unrepresentative early lead',()=>{
  assert.equal(simulateWinProbability(prior,early,settings).status,'unavailable');
  const result=simulateWinProbability(prior,middle,settings);
  assert.ok(result.margin.median<-10);
  assert.ok(result.candidates[1].probability>.95);
  assert.ok(result.candidates.every(c=>c.probability>0 && c.probability<1));
  assert.ok(Math.abs(result.candidates.reduce((total,c)=>total+c.probability,0)-1)<1e-12);
  assert.deepEqual(simulateWinProbability(prior,middle,settings),result);
  assert.equal(simulateWinProbability(prior,{...middle,at:'2026-11-04T02:11:00Z'},settings,result.inputHash).status,'unchanged');
});

test('Late counts narrow modeled uncertainty and verified completion fixes the margin',()=>{
  const a=simulateWinProbability(prior,middle,settings),b=simulateWinProbability(prior,late,settings);
  const width=result=>result.margin.interval80[1]-result.margin.interval80[0];
  assert.ok(width(b)<width(a));
  const complete=simulateWinProbability(prior,final,settings);
  assert.equal(complete.verifiedComplete,true);
  assert.equal(complete.estimatedCounted,1);
  assert.equal(complete.candidates[0].probability,1);
  assert.equal(width(complete),0);
  assert.ok(b.margin.median<0);
  assert.ok(simulateWinProbability({...prior,units:prior.units.map((u,i)=>i===2?{...u,turnout:16000}:u)},late,settings).margin.median<b.margin.median);
});

test('Municipality-sized geographies can run without dropping reporting units',()=>{
  const unitCount=487;
  const units=Array.from({length:unitCount},(_,i)=>({...prior.units[0],id:'town-'+i}));
  const reports=units.map(({id},i)=>({...middle.units[0],id,complete:i<2,
    ...(i<2?{completionSource:'Fixture'}:{}),votes:{d:100,r:90,other:10}}));
  const result=simulateWinProbability({...prior,units},{...middle,units:reports,
    totals:{d:100*unitCount,r:90*unitCount,other:10*unitCount}},{simulations:100});
  assert.equal(result.status,'research');
  assert.equal(result.reportedVotes,200*unitCount);
  assert.equal(result.geography.completedUnits,2);
});

test('Rejects future evidence, incompatible rules, incomplete geography, and unreconciled counts',()=>{
  assert.throws(()=>simulateWinProbability({...prior,availableAt:late.at},middle,settings),/look-ahead/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,sourceUpdatedAt:late.at},settings),/look-ahead/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,units:[...middle.units.slice(0,-1),late.units.at(-1)]},settings),/timestamp/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,units:middle.units.slice(1)},settings),/coverage/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,totals:{d:1,r:1,other:1}},settings),/reconcile/);
  assert.throws(()=>simulateWinProbability({...prior,rule:'ranked-choice'},middle,settings),/Unsupported/);
});

test('As-of all-ballot limits constrain the outstanding-vote model without implying completion',()=>{
  const input=snapshot(15,[[750,200,50,true],[200,750,50,true],[3400,2500,100,false]]);
  const unit=input.units[2];
  const limit={raceId:prior.raceId,electionDate:prior.electionDate,unitId:unit.id,scope:'all-ballots',evidenceType:'verified-upper-bound',
    reportedVotes:{...unit.votes},maxBallots:300,availableAt:input.at,source:'Fixture official ballot accounting'};
  const uncapped=simulateWinProbability(prior,input,settings);
  unit.outstandingLimit=limit;
  const capped=simulateWinProbability(prior,input,settings,uncapped.inputHash);
  assert.equal(capped.status,'research');
  assert.equal(capped.verifiedComplete,false);
  assert.equal(capped.geography.completedUnits,2);
  assert.ok(capped.estimatedCounted>=8000/8300-1e-12);
  assert.ok(capped.candidates[0].probability>uncapped.candidates[0].probability);
  assert.notEqual(capped.inputHash,uncapped.inputHash);
  assert.equal(simulateWinProbability(prior,input,settings,capped.inputHash).status,'unchanged');
  for (const mismatch of [
    {scope:'provisional-only'},{unitId:'metro'},{raceId:'wrong-race'},{electionDate:'2024-11-05'},
    {availableAt:'2026-11-04T03:00:00Z'},{availableAt:'2026-11-04T01:59:00Z'},
    {reportedVotes:{...unit.votes,r:2501}},{maxBallots:-1},{evidenceType:'unprocessed-ballots-estimate'},
  ]) {
    unit.outstandingLimit={...limit,...mismatch};
    assert.throws(()=>simulateWinProbability(prior,input,settings),/Outstanding-ballot limit/);
  }
});

test('Partial pooling uses completed units in observed regions without imputing missing count records',()=>{
  const fourth={...prior.units[0],id:'fourth',region:'north'};
  const expanded={...prior,units:[...prior.units,fourth]};
  const zero={id:'fourth',availableAt:middle.at,complete:false,votes:{d:0,r:0,other:0}};
  const observed={...middle,units:[...middle.units,zero]};
  const fallback={...settings,method:'partial-pool'};
  assert.equal(simulateWinProbability(expanded,observed,settings).status,'unavailable');
  assert.equal(simulateWinProbability(expanded,observed,fallback).method,'partial-pool');
  assert.equal(simulateWinProbability(expanded,{...early,units:[...early.units,{...zero,availableAt:early.at}]},fallback).status,'unavailable');
  assert.throws(()=>simulateWinProbability(expanded,middle,fallback),/coverage/);
});

test('Benchmark keeps the frozen baseline paired and blocks underpowered or post-hoc claims',async()=>{
  const policy={method:'full-coverage',frozenAt:'2024-01-01T00:00:00Z',holdoutDates:['2026-11-03'],
    cohorts:[{office:'senate',stage:1}],minimumRaces:2,minimumCycles:2,coverageTolerance:.1,settings};
  const bundle={prior,snapshots:[middle]};
  const truth={['2026-11-03:'+prior.raceId]:{source:'Synthetic fixture',totalVotes:12000,winner:'r',
    margin:-30,marginCandidateIds:['d','r']}};
  const result=await benchmarkProbability({policy,bundles:[bundle]},truth);
  assert.equal(result.status,'blocked');
  assert.equal(result.cohorts[0].races,1);
  assert.equal(result.cohorts[0].opportunities,1);
  assert.equal(result.cohorts[0].status,'insufficient-evidence');
  await assert.rejects(benchmarkProbability({policy:{...policy,frozenAt:final.at},bundles:[bundle]},truth),/preregistered/);
  await assert.rejects(benchmarkProbability({policy,bundles:[bundle,bundle]},truth),/duplicate/);
});

test('Ballot-limit benchmark pairs a newly available limit with the same unchanged count',async()=>{
  const first=snapshot(14,[[750,200,50,true],[200,750,50,true],[3400,2500,100,false]]);
  const second=snapshot(15,[[750,200,50,true],[200,750,50,true],[3400,2500,100,false]]);
  const unit=second.units[2];
  unit.outstandingLimit={raceId:prior.raceId,electionDate:prior.electionDate,unitId:unit.id,scope:'all-ballots',evidenceType:'verified-upper-bound',
    reportedVotes:{...unit.votes},maxBallots:300,availableAt:second.at,source:'Fixture official ballot accounting'};
  const policy={method:'outstanding-limits',frozenAt:'2026-10-01',holdoutDates:[prior.electionDate],
    minimumRaces:2,minimumCycles:2,coverageTolerance:.2,settings,cohorts:[{office:'senate',stage:9}]};
  const input={policy,bundles:[{prior,snapshots:[first,second]}]};
  const truth={[prior.electionDate+':'+prior.raceId]:{source:'Fixture certified outcome',totalVotes:8200,
    winner:'d',margin:10,marginCandidateIds:prior.marginCandidateIds}};
  const report=await benchmarkProbability(input,truth);
  assert.equal(report.status,'blocked');
  assert.equal(report.cohorts[0].opportunities,1);
  assert.equal(report.cohorts[0].races,1);
  assert.ok(report.cohorts[0].model.brier<report.cohorts[0].baseline.brier);
  await assert.rejects(benchmarkProbability({...input,policy:{...policy,method:'full-coverage'}},truth),/separate benchmark/);
  truth[prior.electionDate+':'+prior.raceId].totalVotes=8301;
  await assert.rejects(benchmarkProbability(input,truth),/exceeds the claimed/);
});

test('Archived county captures require a matching checksum and reconciliation and do not infer completion',()=>{
  const unit=(level,fips_county,d,r)=>({level,fips_state:'04',fips_county,total_votes:d+r,eevp:99,
    candidates:[{nyt_id:'d',votes:{total:d}},{nyt_id:'r',votes:{total:r}}]});
  const race={nyt_id:'az-governor',election_date:'2022-11-08',updated_at:'2022-11-09T03:15:06Z',
    reporting_units:[unit('state',null,20,10),unit('county','001',20,10)]};
  const meta={nytId:race.nyt_id,electionDate:race.election_date,raceId:'governor-AZ',
    at:'2022-11-09T03:21:26Z',source:'https://example.com/capture'};
  const read=value=>{
    const body=Buffer.from(JSON.stringify({races:[value]}));
    const sha256=createHash('sha256').update(body).digest('hex');
    return readProbabilityCapture(gzipSync(body),{...meta,sha256});
  };
  assert.equal(read(race).units[0].complete,false);
  assert.throws(()=>read({...race,reporting_units:[race.reporting_units[0],unit('county','001',19,10)]}),/reconcile/);
  assert.throws(()=>read({...race,updated_at:'2022-11-09T03:25:00Z'}),/after/);
  assert.throws(()=>readProbabilityCapture(Buffer.from('{}'),{...meta,sha256:'bad'}),/checksum/);
});

test('Turnout fit stays fixed when scoring separate races and floors the anchor at counted votes',()=>{
  const training=[
    {historical:100,provider:140,reported:60,actual:140},
    {historical:100,provider:120,reported:70,actual:120},
    {historical:100,provider:160,reported:80,actual:160},
  ];
  const weight=fitTurnoutWeight(training);
  assert.equal(weight,1);
  const [heldout]=evaluateTurnoutWeight([{historical:80,provider:140,reported:100,actual:100}],weight);
  assert.equal(heldout.blended,140);
  assert.ok(heldout.absoluteLogError.blended>heldout.absoluteLogError.historical);
  assert.throws(()=>evaluateTurnoutWeight([{historical:80,provider:90,reported:100,actual:100}],weight),/Invalid held-out/);
});

test('Sparse D/R research draws do not depend on held-out winners or final margins',()=>{
  const input={id:'fixture',historical:1000,historicalShare:.53,d:210,r:240,progress:62};
  const training=[
    {...input,finalD:540,finalR:460},
    {...input,historicalShare:.42,finalD:400,finalR:600},
    {...input,historicalShare:.59,finalD:610,finalR:390},
  ];
  const score=(finalD,finalR)=>compareSparsePairFallbacks(training,[{...input,finalD,finalR}]);
  const d=score(520,480), r=score(480,520);
  for (const name of Object.keys(d.metrics)) assert.equal(d.forecasts[0].methods[name].democraticPairProbability,
    r.forecasts[0].methods[name].democraticPairProbability);
  assert.notEqual(d.metrics['frozen-prior'].brier,r.metrics['frozen-prior'].brier);
  assert.deepEqual(score(209,600).unresolvedTruth,[input.id]);
});

test('Count-only forecasts use one historical update per race and ignore evaluation outcomes',()=>{
  const observed={office:'house',hour:4,margin:-.04};
  const training=Array.from({length:10},(_,i)=>({id:'house-'+i,...observed,finalMargin:i<4?-.08:.01}));
  const forecast=countOnlyEstimate(observed,training);
  assert.ok(forecast.p>.5 && forecast.p<1);
  assert.deepEqual(forecast,countOnlyEstimate({...observed,finalMargin:-.9},[...training,...training]));
  assert.equal(countOnlyEstimate({...observed,office:'senate'},training),null);
  assert.equal(countOnlyEstimate({...observed,hour:50},training),null);
  assert.throws(()=>countOnlyEstimate({...observed,hour:336},training),/unsupported/);
});

test('Georgia runoff scenarios use earlier rounds without reading the target outcome',()=>{
  const earlier={year:2020,general:[90,100],runoff:[95,90]};
  const later={year:2022,general:[100,95],runoff:[105,90]};
  const [first]=scoreGeorgiaRunoffs([earlier,later]);
  const [changed]=scoreGeorgiaRunoffs([earlier,{...later,runoff:[90,105]}]);
  assert.deepEqual(first.analogs,changed.analogs);
  assert.notEqual(first.actual.margin,changed.actual.margin);
  assert.throws(()=>scoreGeorgiaRunoffs([later,earlier]),/predate/);
});

test('Archived AP checkpoints require reconciled vote totals, matching candidates and a real as-of update',()=>{
  const key='20241105OH1',at='2024-11-06T04:00:00Z';
  const row={raceID:key,statePostal:'OH',lastUpdated:'2024-11-06T03:00:00Z',
    pollClosingTime:'2024-11-06T00:30:00Z',test:false,resultsType:'live',level:'state',
    parameters:{vote:{total:150}},candidates:[{candidateID:'1',voteCount:70},{candidateID:'2',voteCount:80}]};
  const race={raceID:key,statePostal:'OH',officeID:'H',seatNum:'1',eventID:'20241105',
    electionDate:'2024-11-05',raceTypeID:'G',candidates:{
      '1':{first:'Alex',last:'Example',party:'Dem'},'2':{first:'Robin',last:'Example',party:'GOP'}}};
  const truth=new Map([['OH-G-H-1',{d:100,r:120,total:220,democrat:'Alex Q Example',republican:'Robin Example'}]]);
  const read=(count,details=race)=>readApCheckpoints({[key]:count},{[key]:details},at,truth);
  assert.equal(read(row)[0].margin,-10/150);
  assert.deepEqual(read({...row,lastUpdated:'2024-11-06T04:00:01Z'}),[]);
  assert.deepEqual(read({...row,lastUpdated:'2024-11-06T00:29:59Z'}),[]);
  assert.deepEqual(read({...row,test:true}),[]);
  assert.deepEqual(read({...row,parameters:{vote:{total:149}}}),[]);
  assert.deepEqual(read(row,{...race,seatNum:'2'}),[]);
  assert.deepEqual(read(row,{...race,candidates:{...race.candidates,'1':{first:'Alice',last:'Example',party:'Dem'}}}),[]);
});

test('2022 candidate histories use only the vote estimate attached to the timestamped checkpoint',()=>{
  const id='OH-G-H-1-2022-11-08',at='2022-11-09T03:00:00Z';
  const race={nyt_id:id,office_id:'H',seat_number:1,top_reporting_unit:{state_postal:'OH',total_expected_vote:900},
    election_date:'2022-11-08',type:'General',race_type_id:'G',max_winners:1,
    candidate_metadata:{d:{first_name:'Alex',last_name:'Example'},r:{first_name:'Robin',last_name:'Example'}}};
  const point={provider_updated_at:at,total_votes:150,nyt_vote_estimate:{total_expected_vote:250},
    candidates:[{nyt_id:'d',votes:{total:70}},{nyt_id:'r',votes:{total:80}}]};
  const truth=new Map([['OH-G-H-1',{total:220,ballot:[
    {name:'Alex Example',votes:100},{name:'Robin Example',votes:120},
  ]}]]);
  const readWithOptions=(series,options)=>readNyt2022Ballots({races:[race],timeseries:{[id]:series},
    pollClosingTimes:[{reporting_unit:{state_postal:'OH'},poll_closing_time:'2022-11-09T00:30:00Z'}]},truth,options);
  const read=(...series)=>readWithOptions(series);
  assert.equal(read(point)[0].expected,250);
  assert.equal(read(point,point).length,1);
  assert.deepEqual(read({...point,nyt_vote_estimate:null}),[]);
  const [countOnly]=readWithOptions([{...point,nyt_vote_estimate:null}],{requireExpected:false});
  assert.equal(countOnly.expected,null);
  assert.equal(countOnly.roster[0].votes,70);
  assert.deepEqual(read({...point,provider_updated_at:'2022-11-09T00:29:59Z'}),[]);
  assert.deepEqual(read(point,{...point,nyt_vote_estimate:{total_expected_vote:251}}),[]);
});

test('Ballot analogs score every candidate without using the target outcome',()=>{
  const race={id:'oh-test',state:'OH',office:'house',hour:6,expected:1000,roster:[
    {id:'a',votes:200},{id:'b',votes:190},{id:'c',votes:100},
  ]};
  const training=Array.from({length:8},(_,i)=>({id:'training-'+i,state:'TX',office:'house',hour:6,
    ranked:race.roster,share:.49,gap:10/490,turnoutError:1,remainingShares:[.15,.2,.65]}));
  const estimate=estimateFromBallotAnalogs(race,training,1);
  assert.ok(estimate.candidates.find(candidate=>candidate.id==='c').probability>.8);
  for (const probabilities of [estimate.candidates,estimate.turnoutOnly])
    assert.ok(Math.abs(probabilities.reduce((total,candidate)=>total+candidate.probability,0)-1)<1e-12);
  assert.equal(estimate.expectedFinal,1000);
  assert.deepEqual(estimateFromBallotAnalogs({...race,roster:race.roster.map(c=>({...c,actual:c.votes+10000}))},
    [...training,...training],1),estimate);
  assert.equal(estimateFromBallotAnalogs(race,training.map(row=>({...row,state:'OH'}))),null);
});

test('Statewide turnout fitting uses prior cycles and keeps the estimated count independent of final returns',()=>{
  const prior={totalVotes:1000,demVotes:510,repVotes:460};
  const states=['DE','MD','CT','WA','MO','NC','OH','CO'];
  const anchors=new Map(states.map(state=>[state,prior]));
  const earlier=states.map((state,i)=>({year:2018,state,office:'governor',total:750+i*30}));
  const cohort=fitHistoricalTurnout(earlier,anchors).get('governor|midterm');
  assert.equal(cohort.n,8);
  assert.ok(cohort.center<cohort.upper);
  assert.throws(()=>fitHistoricalTurnout([...earlier,{...earlier[0],year:2022}],anchors),/target cycle/);
  assert.throws(()=>fitHistoricalTurnout([...earlier,earlier[0]],anchors),/Duplicate/);
  const observed={hour:6,total:780,d:380,r:370};
  const features=statewideFeatures(observed,prior,cohort);
  assert.deepEqual(features,statewideFeatures({...observed,expected:10000,finalD:1000,finalR:5},prior,cohort));
  assert.equal(features.anchor,840);
  assert.equal(features.stage,'90-plus');
  assert.equal(statewideFeatures({...observed,d:1000},prior,cohort),null);
  const rounded=statewideFeatures({hour:6,total:780,dShare:380/780,rShare:370/780},prior,cohort);
  assert.ok(Math.abs(rounded.signal-features.signal)<1e-12);
  assert.throws(()=>benchmarkStatewideProxy([],[],anchors,new Map(),{trainingYear:2024,holdoutYear:2022}),/move forward/);
});

test('First-choice plurality does not resolve Maine ranked choice and an uncounted transfer stays unresolved',()=>{
  // Maine Attorney General, OJ-26-1, 2018 CD-2 example. The certified
  // later-round winner was Golden even though Poliquin led this count.
  const votes={golden:132013,poliquin:134184,bond:16552,hoar:6875};
  assert.equal(firstCountOutcome('plurality',votes).winner,'poliquin');
  assert.equal(firstCountOutcome('ranked-choice',votes,289624).status,'transfers-required');
  assert.throws(()=>firstCountOutcome('ranked-choice',votes,289623),/denominator/);
  assert.equal(firstCountOutcome('ranked-choice',{a:51,b:49},105).status,'transfers-required');
  assert.equal(firstCountOutcome('ranked-choice',{a:51,b:49},100).winner,'a');
  const bounds=firstCountBounds('ranked-choice',[
    {votes:{a:51,b:49},majorityDenominator:105},
    {votes:{a:60,b:40},majorityDenominator:105},
  ]);
  assert.deepEqual(bounds,{status:'research-bounds',unresolved:.5,candidates:[
    {id:'a',lower:.5,upper:1},{id:'b',lower:0,upper:.5},
  ]});
  assert.throws(()=>firstCountBounds('plurality',[{votes:{a:20,b:15}},{votes:{a:20,c:15}}]),/different ballots/);
});

test('Second-election and legislative samples bound potential winners without awarding a plurality leader',()=>{
  const votes={a:44,b:24,c:24,d:8};
  assert.deepEqual(firstCountOutcome('majority-runoff',votes,100),
    {status:'runoff-required',possible:['a','b','c']});
  assert.deepEqual(firstCountOutcome('legislative-contingency',{a:40,b:30,c:20,d:10},100),
    {status:'legislative-choice-required',possible:['a','b','c']});
  assert.equal(firstCountOutcome('majority-runoff',{a:52,b:46,c:2},100).winner,'a');
});

test('A joint turnout and margin draw preserves every candidate count and allocates every remaining vote',()=>{
  const observed=[450,480,70];
  const remaining=200,profile=[.35,.45,.20];
  for (const margin of [-.90,-.03,0,.10,.90]) {
    const votes=allocateJointDraw(observed,remaining,profile,margin);
    assert.ok(votes.every((value,i)=>value>=observed[i]));
    assert.equal(votes.reduce((total,value)=>total+value,0),1200);
    assert.equal(votes[2],110);
  }
  assert.deepEqual(allocateJointDraw(observed,0,profile,.90),observed);
  assert.deepEqual(allocateJointDraw([80,20],10,[],-.90),[80,30]);
});

test('Joint calibration adjusts weights without adding unsupported winners or changing vote vectors',()=>{
  const ids=['d','r'],input={ids};
  const draws=Array.from({length:20},(_,index)=>index<10?
    {votes:[10,9],total:19,margin:1/19,weight:1}:{votes:[9,10],total:19,margin:-1/19,weight:1})
    .sort((a,b)=>a.margin-b.margin);
  const distribution={draws,weight:20,effective:20};
  const aligned=alignWinnerMass(input,distribution,[{id:'d',probability:.7},{id:'r',probability:.3}]);
  assert.ok(aligned.effective>=8);
  const mass=aligned.draws.filter(draw=>draw.winner===0).reduce((total,draw)=>total+draw.weight,0);
  assert.ok(Math.abs(mass/aligned.weight-.7)<1e-12);
  assert.deepEqual(aligned.draws.map(draw=>draw.votes),draws.map(draw=>draw.votes));
  const oneSided={draws:draws.slice(10),weight:10,effective:10};
  assert.equal(alignWinnerMass(input,oneSided,[{id:'d',probability:.7},{id:'r',probability:.3}]),null);
});

test('Replay is chronological, persisted, idempotent, and only accepts documented corrections',async t=>{
  const root=await mkdtemp(join(tmpdir(),'fea-probability-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await assert.rejects(runProbabilityReplay({prior,snapshots:[late,middle],settings},root),/strictly increasing/);
  const correction=snapshot(25,[[750,200,50,true],[200,750,50,true],[4000,3990,100,false]]);
  await assert.rejects(runProbabilityReplay({prior,snapshots:[late,correction],settings},root),/documented correction/);
  correction.correctionSource='Fixture correction notice';
  const snapshots=[early,middle,{...middle,at:'2026-11-04T02:11:00Z'},late,correction,final];
  const result=await runProbabilityReplay({prior,snapshots,settings},root);
  assert.equal(result.skipped.length,1);
  assert.equal(result.points.length,4);
  assert.equal(result.points[2].reason,'documented-correction');
  assert.deepEqual(await readProbabilityReplay(prior.raceId,root),result.points);
  await runProbabilityReplay({prior,snapshots,settings},root);
  assert.deepEqual(await readProbabilityReplay(prior.raceId,root),result.points);
  assert.deepEqual((await runProbabilityReplay({prior,snapshots:[middle],settings},root)).points[0],result.points[0]);
  const truth={[prior.raceId]:{winner:'d',marginCandidateIds:['d','r'],margin:result.points.at(-1).margin.median}};
  const {scores,calibration}=scoreProbabilityReplay(result.points,truth);
  assert.ok(scores.length>=2 && scores.every(row=>Number.isFinite(row.brier)&&Number.isFinite(row.logLoss)));
  assert.equal(calibration.reduce((sum,bin)=>sum+bin.count,0),scores.length*ids.length);
});
