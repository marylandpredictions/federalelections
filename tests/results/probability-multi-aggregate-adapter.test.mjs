import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateMultiAggregateProbability, multiAggregateModelVersion}
  from '../../scripts/results/probability-multi-aggregate-adapter.mjs';

function twoPartyInput(id = 'house-AL-2') {
  const at = '2026-11-08T12:00:00Z';
  const office = id.split('-')[0];
  const prior = {
    inputMode: 'race-total-multi', method: 'dirichlet-remaining-count',
    modelVersion: multiAggregateModelVersion, office, raceId: id,
    electionDate: '2026-11-03', rule: 'plurality',
    candidateIds: ['dem', 'rep'],
    anchorAvailableAt: '2026-11-02T20:00:00Z',
    shareConcentration: 40,
    units: [{id: 'race:' + id, weight: 1, shares: {dem: 0.52, rep: 0.48}}]
  };
  const snapshot = {
    raceId: id, electionDate: '2026-11-03',
    at, sourceUpdatedAt: at, source: 'NBC News',
    expectedVotePercent: 80,
    totals: {dem: 1100, rep: 900},
    units: [{id: 'race:' + id, availableAt: at,
      expectedVotePercent: 80, votes: {dem: 1100, rep: 900}, complete: false}]
  };
  return {prior, snapshot};
}

function threePartyInput(id = 'house-OH-3') {
  const at = '2026-11-08T12:00:00Z';
  const prior = {
    inputMode: 'race-total-multi', method: 'dirichlet-remaining-count',
    modelVersion: multiAggregateModelVersion, office: 'house', raceId: id,
    electionDate: '2026-11-03', rule: 'plurality',
    candidateIds: ['dem', 'rep', 'ind'],
    anchorAvailableAt: '2026-11-02T20:00:00Z',
    shareConcentration: 30,
    units: [{id: 'race:' + id, weight: 1,
      shares: {dem: 0.45, rep: 0.40, ind: 0.15}}]
  };
  const snapshot = {
    raceId: id, electionDate: '2026-11-03',
    at, sourceUpdatedAt: at, source: 'NBC News',
    expectedVotePercent: 75,
    totals: {dem: 4500, rep: 4000, ind: 1500},
    units: [{id: 'race:' + id, availableAt: at,
      expectedVotePercent: 75,
      votes: {dem: 4500, rep: 4000, ind: 1500}, complete: false}]
  };
  return {prior, snapshot};
}

test('Two-candidate race returns research status with valid probabilities', () => {
  const {prior, snapshot} = twoPartyInput();
  const result = simulateMultiAggregateProbability(prior, snapshot);
  assert.equal(result.status, 'research');
  assert.equal(result.inputMode, 'race-total-multi');
  assert.equal(result.modelVersion, multiAggregateModelVersion);
  assert.equal(result.candidates.length, 2);
  const totalProb = result.candidates.reduce((s, c) => s + c.probability, 0);
  assert.ok(Math.abs(totalProb - 1) < 1e-9, 'probabilities must sum to 1');
  assert.ok(result.candidates[0].probability > 0.5, 'D should lead with 55% of counted votes');
  assert.deepEqual(result.geography, {reportedUnits: 1, scheme: 'race-total-multi'});
  assert.equal(result.verifiedComplete, false);
  assert.equal(result.simulations, 20000);
});

test('Three-candidate race returns valid plurality probabilities', () => {
  const {prior, snapshot} = threePartyInput();
  const result = simulateMultiAggregateProbability(prior, snapshot);
  assert.equal(result.status, 'research');
  assert.equal(result.candidates.length, 3);
  const totalProb = result.candidates.reduce((s, c) => s + c.probability, 0);
  assert.ok(Math.abs(totalProb - 1) < 1e-9, 'probabilities must sum to 1');
  assert.ok(result.candidates.find(c => c.id === 'dem').probability >
    result.candidates.find(c => c.id === 'ind').probability,
    'dem should be more likely to win than ind');
  assert.ok(result.margin.interval80[0] < result.margin.median);
  assert.ok(result.margin.median < result.margin.interval80[1]);
});

test('Identical inputs produce unchanged status on second call', () => {
  const {prior, snapshot} = twoPartyInput();
  const first = simulateMultiAggregateProbability(prior, snapshot);
  const second = simulateMultiAggregateProbability(prior, snapshot, {}, first.inputHash);
  assert.equal(second.status, 'unchanged');
  assert.equal(second.inputHash, first.inputHash);
});

test('Deterministic output for the same inputHash seed', () => {
  const {prior, snapshot} = twoPartyInput();
  const a = simulateMultiAggregateProbability(prior, snapshot);
  const b = simulateMultiAggregateProbability(prior, snapshot);
  assert.equal(a.candidates[0].probability, b.candidates[0].probability);
  assert.equal(a.margin.median, b.margin.median);
  assert.deepEqual(a.margin.interval80, b.margin.interval80);
});

test('Below-50% reporting returns unavailable', () => {
  const {prior, snapshot} = twoPartyInput();
  snapshot.expectedVotePercent = 49;
  snapshot.units[0].expectedVotePercent = 49;
  const result = simulateMultiAggregateProbability(prior, snapshot);
  assert.equal(result.status, 'unavailable');
});

test('100% reporting still marks verifiedComplete false', () => {
  const {prior, snapshot} = twoPartyInput();
  snapshot.expectedVotePercent = 100;
  snapshot.units[0].expectedVotePercent = 100;
  const result = simulateMultiAggregateProbability(prior, snapshot);
  assert.equal(result.status, 'research');
  assert.equal(result.verifiedComplete, false);
});

test('Non-plurality races are rejected', () => {
  for (const id of ['house-AK-AL', 'senate-ME', 'governor-AK', 'house-LA-2',
                     'senate-GA', 'governor-VT']) {
    const {prior, snapshot} = twoPartyInput(id);
    prior.raceId = id; prior.office = id.split('-')[0];
    snapshot.raceId = id; prior.units[0].id = 'race:' + id;
    snapshot.units[0].id = 'race:' + id;
    assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
      /election rule/, 'should reject ' + id);
  }
});

test('Invalid concentration is rejected', () => {
  const {prior, snapshot} = twoPartyInput();
  prior.shareConcentration = 1;
  assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
    /concentration/);
  prior.shareConcentration = 501;
  assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
    /concentration/);
});

test('Shares that do not sum to 1 are rejected', () => {
  const {prior, snapshot} = twoPartyInput();
  prior.units[0].shares.dem = 0.6;
  prior.units[0].shares.rep = 0.6;
  assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
    /share center/);
});

test('Mismatched snapshot source is rejected', () => {
  const {prior, snapshot} = twoPartyInput();
  snapshot.source = 'AP';
  assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
    /NBC/);
});

test('Vote count mismatch between totals and unit is rejected', () => {
  const {prior, snapshot} = twoPartyInput();
  snapshot.totals.dem = 1101;
  assert.throws(() => simulateMultiAggregateProbability(prior, snapshot),
    /unreconciled/);
});

test('Implementation hash revision changes inputHash', () => {
  const {prior, snapshot} = twoPartyInput();
  const a = simulateMultiAggregateProbability(prior, snapshot, {implementationHash: 'a'.repeat(64)});
  const b = simulateMultiAggregateProbability(prior, snapshot, {implementationHash: 'b'.repeat(64)});
  assert.equal(a.status, 'research');
  assert.equal(b.status, 'research');
  assert.notEqual(a.inputHash, b.inputHash);
});

test('Prior inputs are not mutated by the adapter', () => {
  const {prior, snapshot} = twoPartyInput();
  const priorCopy = JSON.parse(JSON.stringify(prior));
  const snapCopy = JSON.parse(JSON.stringify(snapshot));
  simulateMultiAggregateProbability(prior, snapshot);
  assert.deepEqual(prior, priorCopy);
  assert.deepEqual(snapshot, snapCopy);
});
