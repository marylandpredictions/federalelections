import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {partialLiveModelVersion,partialCalibrationWithPrior,tiltPartialGeography,simulatePartialProbability} from '../../scripts/results/probability-partial-adapter.mjs';
import {simulatePartialCounts} from '../../scripts/results/probability-partial-model.mjs';

const fixture=JSON.parse(readFileSync('tests/results/fixtures/partial-count-kernel.json','utf8'));
test('Candidate recentering preserves geographic ordering and exactly matches the frozen mean',()=>{
 const units=[{id:'a',margin:-.3,weight:300},{id:'b',margin:.5,weight:100}],before=structuredClone(units);
 const result=tiltPartialGeography(units,10);
 assert.deepEqual(units,before);assert.ok(result[0].margin<result[1].margin);
 assert.ok(Math.abs(result.reduce((sum,u)=>sum+u.margin*u.weight,0)/400-.1)<1e-12);
 assert.deepEqual(result.map(u=>u.weight),[300,100]);
 assert.throws(()=>tiltPartialGeography(units,NaN));
});
function input(){
 const at='2026-11-08T12:00:00Z';
 const prior={raceId:'house-AL-2',office:'house',electionDate:'2026-11-03',method:'calibrated-partial-count',
  modelVersion:partialLiveModelVersion,rule:'plurality',candidateIds:['dem','rep'],parties:{dem:'D',rep:'R'},
  anchorAvailableAt:'2026-11-02T20:00:00Z',geographyAvailableAt:'2026-11-07T20:00:00Z',
  marginSigmaPoints:10,calibration:structuredClone(fixture.calibration),
  units:fixture.priors.map(unit=>({id:unit.id,margin:unit.margin,weight:unit.turnout}))};
 const snapshot={raceId:prior.raceId,electionDate:prior.electionDate,at,sourceUpdatedAt:at,source:'NBC News',
  expectedVotePercent:60,totals:{dem:900,rep:600},units:prior.units.map((unit,i)=>({id:unit.id,
   availableAt:at,expectedVotePercent:60,complete:false,votes:i?{dem:200,rep:300}:{dem:700,rep:300}}))};
 return {prior,snapshot};
}
test('Two-candidate production-format points agree with the verified partial-count kernel',()=>{
 const {prior,snapshot}=input(),copy=structuredClone({prior,snapshot});
 const result=simulatePartialProbability(prior,snapshot);
 const calibration=partialCalibrationWithPrior(prior.calibration,prior.units,prior.marginSigmaPoints);
 const expected=simulatePartialCounts(prior.units.map(({id,margin})=>({id,margin})),snapshot.units.map(u=>({id:u.id,d:u.votes.dem,r:u.votes.rep,total:u.votes.dem+u.votes.rep,reported:u.expectedVotePercent})),calibration);
 assert.equal(result.candidates[0].probability,expected.conditionalProbabilityD);
 assert.equal(result.candidates.reduce((sum,c)=>sum+c.probability,0),1);
 assert.deepEqual(result.margin.interval80,expected.interval80);
 assert.equal(result.margin.median,expected.medianMarginPoints);
 assert.deepEqual({prior,snapshot},copy);
 assert.equal(result.reportedVotes,1500);assert.equal(result.verifiedComplete,false);
 assert.ok(result.candidates.every(c=>c.probability>0&&c.probability<1));
 assert.equal(simulatePartialProbability(prior,snapshot,{},result.inputHash).status,'unchanged');
});
test('The partial adapter refuses multicandidate fields, incorrect rules and future priors',()=>{
 const mutations=[
  x=>x.prior.candidateIds.push('other'),x=>x.prior.parties.dem='I',
  x=>x.prior.rule='ranked-choice',x=>x.prior.office='governor',
  x=>x.prior.anchorAvailableAt='2026-11-04T00:00:00Z',
  x=>x.prior.geographyAvailableAt='2026-11-09T00:00:00Z',
  x=>x.snapshot.units[0].votes.other=1,x=>x.snapshot.totals.dem++,
  x=>x.snapshot.units[0].id='different-unit',x=>x.snapshot.source='CivicAPI',
  x=>x.snapshot.units[0].availableAt='2026-11-09T00:00:00Z',
 ];
 for(const mutate of mutations){const x=input();mutate(x);assert.throws(()=>simulatePartialProbability(x.prior,x.snapshot));}
});
test('Unvalidated early stages and absent unit estimates stay unavailable without invented priors',()=>{
 for(const mutate of [x=>x.snapshot.expectedVotePercent=24,x=>x.snapshot.units[0].expectedVotePercent=null,
  x=>{x.snapshot.units[0].votes={dem:0,rep:0};x.snapshot.totals={dem:200,rep:300};}]){
  const x=input();mutate(x);assert.equal(simulatePartialProbability(x.prior,x.snapshot).status,'unavailable');
 }
});
test('A single verified reporting unit works without inventing geographic subdivisions',()=>{
 const {prior,snapshot}=input();prior.units=prior.units.slice(0,1);snapshot.units=snapshot.units.slice(0,1);
 snapshot.totals={...snapshot.units[0].votes};
 const result=simulatePartialProbability(prior,snapshot);
 assert.equal(result.geography.reportedUnits,1);assert.equal(result.reportedVotes,1000);
 assert.ok(result.margin.interval80[0]<result.margin.interval80[1]);
});
