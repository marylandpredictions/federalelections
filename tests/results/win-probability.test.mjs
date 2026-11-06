import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
import {buildCountyProbabilityPrior,evaluateRegularProbability,matchFrozenCandidateCenter,normalizeProbabilitySnapshot,probabilityGeographyBasis,probabilityRule,readGeographicReferences} from '../../scripts/results/probability-inputs.mjs';

const settings={simulations:1200};
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
  assert.equal(national.nextCountyRace(),'senate-test-0');
  let now=Date.parse('2026-11-04T02:00:10Z');
  const updatedAt=new Date(now-1000).toISOString(),frozenDate=prior.electionDate;
  const rows=(d,r)=>roster.map((row,i)=>({...row,votes:i?r:d}));
  const county=(fips,d,r)=>({fips,updatedAt,source:'NBC News',candidates:rows(d,r)});
  const detail={id:raceId,provider:'NBC',electionDate:frozenDate,updatedAt,candidates:rows(110,100),
    counties:[county('39001',60,40),county('39003',40,60),county('39005',10,0)]};
  const completion=Object.fromEntries(['39001','39003'].map(unitId=>[unitId,{unitId,raceId,
    electionDate:frozenDate,availableAt:updatedAt,source:'Fixture report',countedVotes:100}]));
  const live=new LiveProbability(directory,{now:()=>now});
  await live.load(release);
  await live.update(raceId,detail);
  assert.equal(live.view(raceId).status,'waiting');
  assert.match(live.view(raceId).reason,/completion/);
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

test('Rejects future evidence, incompatible rules, incomplete geography, and unreconciled counts',()=>{
  assert.throws(()=>simulateWinProbability({...prior,availableAt:late.at},middle,settings),/look-ahead/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,sourceUpdatedAt:late.at},settings),/look-ahead/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,units:[...middle.units.slice(0,-1),late.units.at(-1)]},settings),/timestamp/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,units:middle.units.slice(1)},settings),/coverage/);
  assert.throws(()=>simulateWinProbability(prior,{...middle,totals:{d:1,r:1,other:1}},settings),/reconcile/);
  assert.throws(()=>simulateWinProbability({...prior,rule:'ranked-choice'},middle,settings),/Unsupported/);
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
