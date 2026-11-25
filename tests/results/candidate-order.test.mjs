import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {orderCandidates, compareCandidates, hasReportedVotes} = createRequire(import.meta.url)('../../assets/candidate-order.js');

test('With votes, candidates sort by vote total then percent then name', () => {
  const rows = orderCandidates([
    {name: 'Zoe', party: 'D', votes: 10, percent: 40},
    {name: 'Adam', party: 'R', votes: 20, percent: 50},
    {name: 'Mia', party: 'I', votes: 20, percent: 55},
  ]);
  assert.deepEqual(rows.map((c) => c.name), ['Mia', 'Adam', 'Zoe']);
});

test('Without votes, Dem and GOP lock the top slots alphabetically, then others alphabetically', () => {
  const rows = orderCandidates([
    {name: 'Zed Independent', party: 'I', votes: 0},
    {name: 'Zoe Democrat', partyCode: 'D', votes: 0},
    {name: 'Adam Republican', party: 'Republican', votes: 0},
    {name: 'Bea Green', party: 'G', votes: 0},
  ]);
  assert.deepEqual(rows.map((c) => c.name), [
    'Adam Republican',
    'Zoe Democrat',
    'Bea Green',
    'Zed Independent',
  ]);
  assert.equal(hasReportedVotes(rows), false);
});

test('Compare helper keeps major-party candidates ahead of third parties when quiet', () => {
  assert.ok(compareCandidates({name: 'A', party: 'D'}, {name: 'B', party: 'I'}, {live: false}) < 0);
  assert.ok(compareCandidates({name: 'B', party: 'R'}, {name: 'A', party: 'D'}, {live: false}) > 0);
});

test('Results UI re-exports orderCandidates', () => {
  const require = createRequire(import.meta.url);
  require('../../assets/candidate-order.js');
  const ui = require('../../assets/results-ui.js');
  assert.equal(typeof ui.orderCandidates, 'function');
  assert.deepEqual(
    ui.orderCandidates([{name: 'B', party: 'I', votes: 1}, {name: 'A', party: 'D', votes: 5}]).map((c) => c.name),
    ['A', 'B']
  );
});
