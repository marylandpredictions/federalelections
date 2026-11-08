import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LiveProbability,validateProbabilityRelease} from '../../scripts/results/probability-live.mjs';
import {partialLiveModelVersion,simulatePartialProbability} from '../../scripts/results/probability-partial-adapter.mjs';
import {partialReleaseEvidence} from '../../scripts/results/probability-partial-release.mjs';

function fixture(){
 const now=Date.now(),at=new Date(now).toISOString(),e=partialReleaseEvidence();
 const roster=[{id:'dem',name:'Alex Fixture',party:'D'},{id:'rep',name:'Jamie Fixture',party:'R'}];
 const prior={raceId:'house-AL-2',office:'house',electionDate:'2026-11-03',rule:'plurality',
  method:'calibrated-partial-count',modelVersion:partialLiveModelVersion,candidateIds:['dem','rep'],parties:{dem:'D',rep:'R'},
  anchorAvailableAt:'2026-11-02T20:00:00Z',geographyAvailableAt:at,marginSigmaPoints:10,calibration:e.calibration,
  units:[{id:'01001',margin:.1,weight:1000},{id:'01003',margin:-.1,weight:1000}]};
 const candidates=(d,r)=>roster.map((c,i)=>({...c,votes:i?r:d}));
 const detail={id:prior.raceId,electionDate:prior.electionDate,provider:'NBC',lastUpdated:at,expectedVotePercent:60,
  candidates:candidates(110,90),counties:[{fips:'01001',source:'NBC News',lastUpdated:at,estimatedVoteReporting:60,candidates:candidates(70,30)},
   {fips:'01003',source:'NBC News',lastUpdated:at,estimatedVoteReporting:60,candidates:candidates(40,60)}]};
 const release={modelVersion:partialLiveModelVersion,policy:{method:prior.method,simulations:20000,minimumReportedPercent:25,maximumInputAgeMs:48*60*60*1000},
  approval:{kind:'automated-source-and-statistical-review',at},validationHash:e.validationHash,calibrationHash:e.calibrationHash,
  implementationHash:e.implementationHash,races:{[prior.raceId]:{prior,roster}}};
 return {now,detail,release,id:prior.raceId};
}
async function directory(t){const path=await mkdtemp(join(tmpdir(),'fea-partial-live-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
test('The repository rollout binds the actual code and evidence that deployment will read',async()=>{
 const release=JSON.parse(await readFile(new URL('../../data/results/probability-release.json',import.meta.url),'utf8'));
 assert.equal(validateProbabilityRelease(release).length,Object.keys(release.races).length);
 assert.ok(Object.keys(release.races).length>0);
 assert.ok(Object.values(release.races).every(config=>config.roster.every(c=>!('votes'in c)&&!('percent'in c)&&!('calls'in c))));
});

test('Partial release binds actual validation, calibration, implementation and supported scope',()=>{
 const {release}=fixture();assert.equal(validateProbabilityRelease(release).length,1);
 for(const mutate of [r=>r.validationHash='a'.repeat(64),r=>r.implementationHash='b'.repeat(64),r=>r.calibrationHash='c'.repeat(64),
  r=>r.races['house-AL-2'].prior.calibration.bias[0]++,r=>r.races['house-AL-2'].roster[0].party='I',
  r=>r.races['house-AL-2'].prior.rule='ranked-choice',r=>r.races['house-AL-2'].roster[0].name='Democrat']){
  const copy=structuredClone(release);mutate(copy);assert.throws(()=>validateProbabilityRelease(copy),/Partial-count release/);
 }
});
test('Actual worker generates and persists partial estimates without requiring completed counties',async t=>{
 const x=fixture(),path=await directory(t),worker=new LiveProbability(path,{now:()=>x.now});
 await worker.load(x.release);await worker.update(x.id,x.detail);
 const view=worker.view(x.id);assert.equal(view.status,'live');assert.equal(view.modelVersion,partialLiveModelVersion);
 assert.equal(view.points.length,1);assert.equal(view.points[0].simulations,20000);assert.equal(view.points[0].verifiedComplete,false);
 const recovered=new LiveProbability(path,{now:()=>x.now});await recovered.load(x.release);
 assert.equal(recovered.view(x.id).status,'stale');assert.deepEqual(recovered.view(x.id).points,view.points);
 await recovered.update(x.id,x.detail);assert.equal(recovered.view(x.id).status,'live');assert.equal(recovered.view(x.id).points.length,1);
});
test('Changed reporting estimates recompute odds; unchanged heartbeats do not',async t=>{
 const x=fixture();let now=x.now,runs=0;
 const worker=new LiveProbability(await directory(t),{now:()=>now,simulate:(...args)=>{runs++;return simulatePartialProbability(...args);}});
 await worker.load(x.release);await worker.update(x.id,x.detail);await worker.update(x.id,x.detail);assert.equal(runs,1);
 now+=15000;x.detail.lastUpdated=new Date(now).toISOString();x.detail.expectedVotePercent=85;
 for(const unit of x.detail.counties){unit.lastUpdated=x.detail.lastUpdated;unit.estimatedVoteReporting=85;}
 await worker.update(x.id,x.detail);assert.equal(runs,2);assert.equal(worker.view(x.id).points.length,2);
 assert.notEqual(worker.view(x.id).points[0].inputHash,worker.view(x.id).points[1].inputHash);
});
test('Approval updates preserve history and a changed prior records a model revision',async t=>{
 const x=fixture(),path=await directory(t),worker=new LiveProbability(path,{now:()=>x.now});
 await worker.load(x.release);await worker.update(x.id,x.detail);
 const first=worker.view(x.id).points[0];
 const release=structuredClone(x.release);release.approval.at=new Date(x.now+1000).toISOString();
 const same=new LiveProbability(path,{now:()=>x.now+1000});await same.load(release);await same.update(x.id,x.detail);
 assert.equal(same.view(x.id).points.length,1);
 release.races[x.id].prior.marginSigmaPoints+=1;
 const revised=new LiveProbability(path,{now:()=>x.now+2000});await revised.load(release);await revised.update(x.id,x.detail);
 assert.equal(revised.view(x.id).points.length,2);assert.deepEqual(revised.view(x.id).points[0],first);
 assert.equal(revised.view(x.id).points[1].reason,'model-revision');
});
test('A dated last-good snapshot can produce an explicitly stale initial estimate, never false freshness',async t=>{
 const x=fixture();let now=x.now+10*60*1000;
 const worker=new LiveProbability(await directory(t),{now:()=>now});await worker.load(x.release);await worker.update(x.id,x.detail);
 assert.equal(worker.view(x.id).status,'stale');assert.equal(worker.view(x.id).points.length,1);
 const point=worker.view(x.id).points[0];await worker.update(x.id,undefined);assert.deepEqual(worker.view(x.id).points[0],point);
 now+=49*60*60*1000;await worker.update(x.id,x.detail);assert.equal(worker.view(x.id).points.length,1);
 assert.equal(worker.view(x.id).status,'stale');
});
test('Small verified NBC corrections retain history, while large resets still require review',async t=>{
 const x=fixture();let now=x.now;
 const worker=new LiveProbability(await directory(t),{now:()=>now});await worker.load(x.release);await worker.update(x.id,x.detail);
 now+=15000;x.detail.lastUpdated=new Date(now).toISOString();for(const u of x.detail.counties)u.lastUpdated=x.detail.lastUpdated;
 x.detail.candidates[0].votes--;x.detail.counties[0].candidates[0].votes--;
 await worker.update(x.id,x.detail);assert.equal(worker.view(x.id).points.length,2);
 assert.equal(worker.view(x.id).points[1].reason,'documented-correction');
 assert.match(worker.view(x.id).points[1].correctionSource,/NBC News verified count revision/);
 now+=15000;x.detail.lastUpdated=new Date(now).toISOString();for(const u of x.detail.counties)u.lastUpdated=x.detail.lastUpdated;
 x.detail.candidates[0].votes-=40;x.detail.counties[0].candidates[0].votes-=40;
 await worker.update(x.id,x.detail);assert.equal(worker.view(x.id).points.length,2);assert.equal(worker.view(x.id).status,'stale');
});
