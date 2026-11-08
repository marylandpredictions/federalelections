import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {simulateAggregateProbability} from '../../scripts/results/probability-aggregate-adapter.mjs';
import {partialLiveModelVersion,partialCalibrationWithPrior} from '../../scripts/results/probability-partial-adapter.mjs';
import {simulatePartialCounts} from '../../scripts/results/probability-partial-model.mjs';

const fixture=JSON.parse(readFileSync('tests/results/fixtures/partial-count-kernel.json','utf8'));
function input(id='house-AL-2'){
 const at='2026-11-08T12:00:00Z';
 const prior={raceId:id,office:id.split('-')[0],electionDate:'2026-11-03',rule:'plurality',
  method:'calibrated-partial-count',inputMode:'race-total',modelVersion:partialLiveModelVersion,
  candidateIds:['dem','rep'],parties:{dem:'D',rep:'R'},anchorAvailableAt:'2026-11-02T20:00:00Z',
  marginSigmaPoints:10,calibration:structuredClone(fixture.calibration),units:[{id:'race:'+id,margin:.05,weight:1}]};
 const snapshot={raceId:id,electionDate:prior.electionDate,at,sourceUpdatedAt:at,source:'NBC News',
  expectedVotePercent:80,totals:{dem:1100,rep:900},units:[{id:'race:'+id,availableAt:at,
   expectedVotePercent:80,votes:{dem:1100,rep:900},complete:false}]};
 return {prior,snapshot};
}

test('Race-total port agrees exactly with the shared kernel without inventing county geography',()=>{
 const {prior,snapshot}=input(),before=structuredClone({prior,snapshot});
 const actual=simulateAggregateProbability(prior,snapshot);
 const expected=simulatePartialCounts([{id:'race-'+prior.raceId,margin:.05}],
  [{id:'race-'+prior.raceId,d:1100,r:900,total:2000,reported:80}],
  partialCalibrationWithPrior(prior.calibration,prior.units,prior.marginSigmaPoints),{simulations:20000});
 assert.equal(actual.candidates[0].probability,expected.conditionalProbabilityD);
 assert.equal(actual.candidates.reduce((n,c)=>n+c.probability,0),1);
 assert.deepEqual(actual.margin.interval80,expected.interval80);
 assert.deepEqual(actual.geography,{reportedUnits:1,scheme:'race-total'});
 assert.equal(actual.status,'research');assert.equal(actual.inputMode,'race-total');
 assert.deepEqual({prior,snapshot},before);
});

test('Race-total source 100% never certifies completion and early inputs remain withheld',()=>{
 const {prior,snapshot}=input();snapshot.expectedVotePercent=100;snapshot.units[0].expectedVotePercent=100;
 assert.equal(simulateAggregateProbability(prior,snapshot).verifiedComplete,false);
 for(const q of [null,0,59.99,101]){
  snapshot.expectedVotePercent=q;snapshot.units[0].expectedVotePercent=q;
  assert.equal(simulateAggregateProbability(prior,snapshot).status,'unavailable');
 }
 snapshot.expectedVotePercent=80;snapshot.units[0].expectedVotePercent=79;
 assert.equal(simulateAggregateProbability(prior,snapshot).status,'unavailable');
});

test('Race-total component supports ordinary office identities but refuses exceptional voting rules',()=>{
 for(const id of ['house-AL-2','senate-OH','governor-AZ']){
  const x=input(id);assert.equal(simulateAggregateProbability(x.prior,x.snapshot).status,'research');
 }
 for(const id of ['house-AK-AL','senate-ME','governor-AK','house-LA-2','senate-GA','governor-VT']){
  const x=input(id);assert.throws(()=>simulateAggregateProbability(x.prior,x.snapshot),/election rule/);
 }
});

test('Race-total inputs fail closed on extra candidates, false identities, future dates and fallback providers',()=>{
 const changes=[x=>x.prior.candidateIds.push('third'),x=>x.prior.parties.dem='I',
  x=>x.snapshot.totals.dem++,x=>x.snapshot.units[0].votes.rep=-1,
  x=>x.snapshot.units[0].votes.third=0,x=>x.prior.units[0].id='01001',
  x=>x.snapshot.units[0].id='another-race',x=>x.snapshot.units[0].complete=true,
  x=>x.snapshot.source='CivicAPI',x=>x.prior.anchorAvailableAt='2026-11-04T00:00:00Z',
  x=>x.snapshot.sourceUpdatedAt='2026-11-09T00:00:00Z',x=>x.snapshot.units[0].availableAt='2026-11-09T00:00:00Z'];
 for(const change of changes){const x=input();change(x);assert.throws(()=>simulateAggregateProbability(x.prior,x.snapshot));}
});

test('Race-total unchanged inputs deduplicate, while implementation revisions recalculate',()=>{
 const {prior,snapshot}=input(),settings={implementationHash:'a'.repeat(64)};
 const first=simulateAggregateProbability(prior,snapshot,settings);
 assert.equal(simulateAggregateProbability(prior,snapshot,settings,first.inputHash).status,'unchanged');
 const revised=simulateAggregateProbability(prior,snapshot,{implementationHash:'b'.repeat(64)},first.inputHash);
 assert.equal(revised.status,'research');assert.notEqual(revised.inputHash,first.inputHash);
 assert.throws(()=>simulateAggregateProbability(prior,snapshot,{implementationHash:'broken'}),/implementation identity/);
});
