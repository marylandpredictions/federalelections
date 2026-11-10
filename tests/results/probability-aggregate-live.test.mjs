import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LiveProbability,validateProbabilityRelease} from '../../scripts/results/probability-live.mjs';
import {partialLiveModelVersion} from '../../scripts/results/probability-partial-adapter.mjs';
import {partialReleaseEvidence,validatePartialProbabilityRelease} from '../../scripts/results/probability-partial-release.mjs';
import {normalizeProbabilitySnapshot} from '../../scripts/results/probability-inputs.mjs';
import {compilePartialRelease} from '../../scripts/results/build-partial-probability-release.mjs';

function fixture(id='house-HI-2'){
 const now=Date.now(),at=new Date(now).toISOString(),e=partialReleaseEvidence({aggregate:true}),office=id.split('-')[0];
 const roster=[{id:'dem',name:'Alex Fixture',party:'D',aliases:['Alex Source']},{id:'rep',name:'Jamie Fixture',party:'R'}];
 const anchorSource={commit:'a'.repeat(40),sha256:'b'.repeat(64),file:'data/results/prior-anchors-v1.json',availableAt:'2026-11-02T20:00:00Z'};
 const prior={raceId:id,office,electionDate:'2026-11-03',rule:'plurality',method:'calibrated-partial-count',
  inputMode:'race-total',modelVersion:partialLiveModelVersion,candidateIds:['dem','rep'],parties:{dem:'D',rep:'R'},
  anchorAvailableAt:anchorSource.availableAt,anchorSource,marginSigmaPoints:10,units:[{id:'race:'+id,margin:.1,weight:1}]};
 const release={modelVersion:partialLiveModelVersion,policy:{method:prior.method,simulations:20000,minimumReportedPercent:25,maximumInputAgeMs:7*24*60*60*1000},
  approval:{kind:'automated-source-and-statistical-review',at},validationHash:e.validationHash,calibrationHash:e.calibrationHash,
  implementationHash:e.implementationHash,aggregateValidationHash:e.aggregateValidationHash,
  aggregatePriorSources:{[office]:anchorSource},races:{[id]:{prior,roster}}};
 const detail={id,electionDate:prior.electionDate,provider:'NBC',lastUpdated:at,expectedVotePercent:80,
  candidates:[{name:'Alex Source',party:'D',votes:1100},{name:'Jamie Fixture',party:'R',votes:900}]};
 return {id,now,detail,release};
}
async function directory(t){const p=await mkdtemp(join(tmpdir(),'fea-aggregate-live-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}

test('Actual worker publishes and restores a race-total point without county data or invented completion',async t=>{
 const x=fixture(),path=await directory(t),worker=new LiveProbability(path,{now:()=>x.now});
 await worker.load(x.release);assert.deepEqual(worker.nextCountyRaces(()=>true,10),[]);
 await worker.update(x.id,x.detail);const view=worker.view(x.id);
 assert.equal(view.status,'live');assert.equal(view.inputMode,'race-total');assert.equal(view.points.length,1);
 assert.equal(view.points[0].verifiedComplete,false);assert.equal(view.points[0].reportedVotes,2000);
 assert.ok(view.points[0].candidates.every(c=>c.probability>0&&c.probability<1));
 const recovered=new LiveProbability(path,{now:()=>x.now});await recovered.load(x.release);
 assert.equal(recovered.view(x.id).status,'stale');assert.deepEqual(recovered.view(x.id).points,view.points);
 await recovered.update(x.id,x.detail);assert.equal(recovered.view(x.id).status,'live');assert.equal(recovered.view(x.id).points.length,1);
});

test('Manual regeneration reruns identical inputs, preserves history and serializes competing updates', async t => {
 const x = fixture();
 const path = await directory(t);
 const simulate = (await import('../../scripts/results/probability-aggregate-adapter.mjs')).simulateAggregateProbability;
 let active = 0;
 let runs = 0;
 const worker = new LiveProbability(path, {now:()=>x.now, simulate:async (...args) => {
   assert.equal(++active, 1);
   runs++;
   await new Promise(resolve => setImmediate(resolve));
   try { return simulate(...args); } finally { active--; }
 }});
 await worker.load(x.release);
 const [, manual] = await Promise.all([
   worker.update(x.id,x.detail),
   worker.update(x.id,x.detail,undefined,{regenerate:true})
 ]);
 assert.equal(runs,2);
 assert.equal(manual.regenerated,true);
 assert.equal(manual.historyChanged,false);
 assert.equal(worker.view(x.id).points.length,1);
 const before = worker.view(x.id).points;
 const rejected = await worker.update(x.id,{...x.detail,provider:'CivicAPI'},undefined,{regenerate:true});
 assert.equal(rejected.regenerated,false);
 assert.equal(runs,2);
 assert.deepEqual(worker.view(x.id).points,before);
});

test('The governor path uses the same verified worker and complete-ballot checks',async t=>{
 const x=fixture('governor-IA'),worker=new LiveProbability(await directory(t),{now:()=>x.now});
 await worker.load(x.release);await worker.update(x.id,x.detail);assert.equal(worker.view(x.id).status,'live');
 const before=worker.view(x.id).points;
 const invalid = {...x.detail,candidates:[...x.detail.candidates,{name:'Another Candidate',party:'I',votes:1}]};
 const result = await worker.update(x.id,invalid,undefined,{regenerate:true});
 assert.equal(result.regenerated,false);
 assert.match(result.reason,/do not reconcile/);
 assert.deepEqual(worker.view(x.id).points,before);
});

test('Race-total normalization maps aliases, ignores county geometry, and cannot import a completion notice',()=>{
 const x=fixture(),r=x.release.races[x.id],options={at:x.detail.lastUpdated,source:'NBC News',
  reportingUnitIds:r.prior.units.map(u=>u.id),aggregateRace:true,completion:{['race:'+x.id]:{claimed:true}}};
 const snapshot=normalizeProbabilitySnapshot(x.detail,r.roster,options);
 assert.equal(snapshot.units[0].complete,false);assert.deepEqual(snapshot.totals,{dem:1100,rep:900});
 assert.deepEqual(normalizeProbabilitySnapshot({...x.detail,counties:[{bad:'geometry'}]},r.roster,options),snapshot);
 const withWriteIns=normalizeProbabilitySnapshot({...x.detail,candidates:[...x.detail.candidates,
  {name:'Total Write-ins',party:'O',votes:17,writeIn:true}]},r.roster,options);
 assert.deepEqual(withWriteIns.totals,snapshot.totals);
 for(const detail of [{...x.detail,provider:'CivicAPI'},{...x.detail,providerBallotAccounting:{ballotsOutsideCandidateTotals:1}},
  {...x.detail,reportingUnitScheme:'nbc-alaska-state-house-districts'}])
  assert.throws(()=>normalizeProbabilitySnapshot(detail,r.roster,options));
 assert.throws(()=>normalizeProbabilitySnapshot(x.detail,r.roster,{...options,reportingUnitIds:['01001']}),/input scheme/);
});

test('Early inputs, outage and provider fallback retain the last estimate without pretending it is fresh',async t=>{
 const x=fixture();let now=x.now;const worker=new LiveProbability(await directory(t),{now:()=>now});
 await worker.load(x.release);await worker.update(x.id,{...x.detail,expectedVotePercent:59});
 assert.equal(worker.view(x.id).status,'waiting');await worker.update(x.id,x.detail);const point=worker.view(x.id).points[0];
 await worker.update(x.id,{...x.detail,provider:'CivicAPI'});assert.equal(worker.view(x.id).status,'stale');
 now+=6*60*1000;await worker.update(x.id,x.detail);assert.equal(worker.view(x.id).status,'stale');
 await worker.update(x.id,undefined);assert.deepEqual(worker.view(x.id).points[0],point);
});

test('Release gate rejects missing fallback proof, bad priors, unsupported office and weaker numerical evidence',()=>{
 const x=fixture();assert.equal(validateProbabilityRelease(x.release).length,1);
 for(const mutate of [r=>r.aggregateValidationHash='c'.repeat(64),r=>r.races[x.id].prior.anchorSource.sha256='bad',
  r=>r.races[x.id].prior.units[0].id='01001',r=>r.races[x.id].prior.inputMode='guess',
  r=>r.races[x.id].prior.office='senate']){
  const release=structuredClone(x.release);mutate(release);assert.throws(()=>validateProbabilityRelease(release),/Partial-count release/);
 }
 const evidence=partialReleaseEvidence({aggregate:true});
 evidence.aggregateEvidence['probability-aggregate-node-validation.json'].monteCarloCheck.failures=1;
 assert.throws(()=>validatePartialProbabilityRelease(x.release,evidence),/numerical port/);
 const other=partialReleaseEvidence({aggregate:true});
 other.aggregateEvidence['probability-aggregate-2024-validation.json'].cohorts['60-100'].pairedBrierDifference.interval95[1]=0;
 assert.throws(()=>validatePartialProbabilityRelease(x.release,other),/different-cycle/);
});

test('Compiler retains the geographic model when both input paths are available and strips live counts',()=>{
 const x=fixture(),e=partialReleaseEvidence({aggregate:true}),config=x.release.races[x.id];
 const geo=structuredClone(config);delete geo.prior.inputMode;delete geo.prior.anchorSource;
 geo.prior.geographyAvailableAt=x.detail.lastUpdated;geo.prior.units=[{id:'15001',margin:.1,weight:1000}];
 const catalogue=[{id:x.id,type:'house',candidates:config.roster}];
 const inventory={status:'research-real-NBC',priors:{[x.id]:geo}};
 const aggregate={status:'Research-only real NBC aggregate input audit',priors:{[x.id]:config},anchorSources:x.release.aggregatePriorSources};
 const {release}=compilePartialRelease(inventory,{rows:[]},catalogue,e,x.detail.lastUpdated,aggregate);
 assert.equal(release.races[x.id].prior.inputMode,undefined);assert.equal(release.races[x.id].prior.units[0].id,'15001');
 assert.ok(release.races[x.id].roster.every(c=>!('votes'in c)));
});
