import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {partialCountPosterior,simulatePartialCounts} from '../../scripts/results/probability-partial-model.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/partial-count-kernel.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const predict=(reports=fixture.reports,settings={})=>simulatePartialCounts(fixture.priors,reports,fixture.calibration,{simulations:2000,...settings});

test('Partial-count posterior agrees with the independent Python/Numpy matrix solution',()=>{
  const actual=partialCountPosterior(fixture.priors,fixture.reports,fixture.calibration);
  actual.mean.forEach((value,i)=>assert.ok(Math.abs(value-fixture.expectedMean[i])<1e-12));
  actual.covariance.forEach((row,i)=>row.forEach((value,j)=>
    assert.ok(Math.abs(value-fixture.expectedCovariance[i][j])<1e-12)));
});

test('Node partial-count simulation agrees with independent Python Monte Carlo',()=>{
  const actual=predict(fixture.reports,{simulations:100000}),expected=fixture.pythonMonteCarlo;
  assert.equal(actual.status,'research-only');
  assert.ok(Math.abs(actual.conditionalProbabilityD-expected.probabilityD)<.005);
  assert.ok(Math.abs(actual.medianMarginPoints-expected.median)<.2);
  actual.interval80.forEach((value,i)=>assert.ok(Math.abs(value-expected.interval80[i])<.3));
});

test('All-vote margins use their own count variance and final-vote denominator',()=>{
  const f=fixture.allVotes;
  const posterior=partialCountPosterior(f.priors,f.reports,f.calibration);
  posterior.mean.forEach((value,i)=>assert.ok(Math.abs(value-f.expectedMean[i])<1e-12));
  posterior.covariance.forEach((row,i)=>row.forEach((value,j)=>
    assert.ok(Math.abs(value-f.expectedCovariance[i][j])<1e-12)));
  const actual=simulatePartialCounts(f.priors,f.reports,f.calibration,{simulations:100000});
  assert.ok(Math.abs(actual.conditionalProbabilityD-f.pythonMonteCarlo.probabilityD)<.005);
  assert.ok(Math.abs(actual.medianMarginPoints-f.pythonMonteCarlo.median)<.2);
  actual.interval80.forEach((value,i)=>assert.ok(Math.abs(value-f.pythonMonteCarlo.interval80[i])<.3));
  const wrong=simulatePartialCounts(f.priors,f.reports,{...f.calibration,marginBasis:'two-party'},{simulations:20000});
  assert.ok(Math.abs(actual.medianMarginPoints-wrong.medianMarginPoints)>1);
});

test('Research forecasts remain deterministic and independent of unit order and supplied outcomes',()=>{
  const expected=predict();
  const changed=clone(fixture.reports).reverse();
  changed.forEach(row=>Object.assign(row,{winnerD:false,truthMargin:-99,truthVotes:9999999}));
  assert.deepEqual(predict(changed),expected);
  assert.deepEqual(simulatePartialCounts([...fixture.priors].reverse(),fixture.reports,fixture.calibration,{simulations:2000}),expected);
});

test('A zero-vote county contributes no invented count observation or zero-turnout estimate',()=>{
  const reports=fixture.reports.map(row=>({...row,d:0,r:0,total:0,reported:100}));
  const actual=partialCountPosterior(fixture.priors,reports,fixture.calibration);
  assert.deepEqual(actual.mean,Array(7).fill(0));
  actual.units.forEach((unit,i)=>{
    assert.equal(unit.fraction,0);
    assert.equal(unit.expected,fixture.priors[i].turnout);
  });
  const updated=predict(reports),priorOnly=predict(reports,{useCounts:false});
  assert.equal(updated.conditionalProbabilityD,priorOnly.conditionalProbabilityD);
  assert.equal(updated.medianMarginPoints,priorOnly.medianMarginPoints);
});

test('100% reported still permits outstanding votes and uncertainty',()=>{
  const reports=fixture.reports.map(row=>({...row,d:501,r:499,total:1000,reported:100}));
  const actual=predict(reports);
  assert.ok(actual.medianFinalVotes>actual.reportedVotes);
  assert.ok(actual.conditionalProbabilityD>.01&&actual.conditionalProbabilityD<.99);
  assert.ok(actual.interval80[0]<actual.interval80[1]);
});

test('Uniform swing can use positive source turnout estimates without an unused historical turnout prior',()=>{
  const calibration={...fixture.calibration,swingLoading:[[.08,0],[0,0]]};
  const reports=[fixture.reports[0],{...fixture.reports[1],d:200,r:300,total:500,reported:10}];
  const historical=simulatePartialCounts(fixture.priors,reports,calibration,{simulations:2000});
  const missing=fixture.priors.map(({turnout,...rest})=>rest);
  assert.deepEqual(simulatePartialCounts(missing,reports,calibration,{simulations:2000}),historical);
  assert.throws(()=>simulatePartialCounts(missing,fixture.reports,calibration),/Historical turnout is required/);
  assert.throws(()=>simulatePartialCounts(missing,reports,fixture.calibration),/Historical turnout is required/);
  const zero=reports.map(row=>({...row,d:0,r:0,total:0,reported:100}));
  assert.throws(()=>simulatePartialCounts(missing,zero,calibration),/Historical turnout is required/);
});

test('An explicitly count-only hierarchy ignores historical margins and uses its learned wide prior',()=>{
  const calibration={...fixture.calibration,priorMode:'count-only',countyVariance:.2,swingLoading:[[.3,0],[0,0]]};
  const reports=[fixture.reports[0],{...fixture.reports[1],d:200,r:300,total:500,reported:10}];
  const historical=simulatePartialCounts(fixture.priors,reports,calibration,{simulations:2000});
  const absent=fixture.priors.map(({id})=>({id}));
  assert.deepEqual(simulatePartialCounts(absent,reports,calibration,{simulations:2000}),historical);
  assert.throws(()=>simulatePartialCounts(absent,fixture.reports,calibration),/Historical turnout is required/);
});

test('Malformed counts, missing geography and invalid calibration fail clearly',()=>{
  for(const votes of [-1,NaN,1.5,Infinity]){
    const rows=clone(fixture.reports);rows[0].d=votes;
    assert.throws(()=>predict(rows),/Malformed partial candidate counts/);
  }
  const duplicate=[fixture.reports[0],fixture.reports[0]];
  assert.throws(()=>predict(duplicate),/Duplicate partial-count geography/);
  assert.throws(()=>predict(fixture.reports.slice(1)),/Incomplete partial-count geography/);
  const invalid=clone(fixture.calibration);invalid.countyVariance=0;
  assert.throws(()=>simulatePartialCounts(fixture.priors,fixture.reports,invalid),/calibration/);
  assert.throws(()=>predict(fixture.reports,{simulations:0}),/simulation count/);
});
