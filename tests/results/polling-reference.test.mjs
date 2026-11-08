import test from 'node:test';
import assert from 'node:assert/strict';
import {pollingReference} from '../../scripts/results/polling-reference.mjs';

const race = {
  id: 'senate-OH',
  type: 'senate',
  state: 'OH',
  candidates: [{name: 'Jane Doe', party: 'D'}, {name: 'John Doe', party: 'R'}],
};
const poll = (id, pollster, a, b, extra = {}) => ({
  id,
  pollster,
  poll_type: 'us-senator',
  subject: '2026 Ohio',
  end_date: '2026-10-30',
  population: 'lv',
  internal: false,
  sample_size: 1000,
  answers: [{choice: 'Jane Doe', pct: a}, {choice: 'John Doe', pct: b}],
  ...extra,
});

test('Polling reference builds a weighted aggregate with exact geography and matchup', () => {
  const rows = [
    poll('1', 'A', 50, 44),
    poll('2', 'B', 48, 46),
    poll('3', 'A', 99, 1, {end_date: '2026-09-01'}), // outside 60-day window
    poll('4', 'C', 60, 40, {subject: '2026 Iowa'}),
    poll('5', 'D', 60, 40, {poll_type: 'governor'}),
    poll('6', 'E', 60, 40, {internal: true}),
    poll('7', 'F', 60, 40, {end_date: '2026-11-04'}),
    poll('8', 'G', 60, 40, {answers: [{choice: 'Former nominee', pct: 60}, {choice: 'John Doe', pct: 40}]}),
  ];
  const r = pollingReference([race], rows).races[race.id];
  assert.equal(r.pollCount, 2);
  assert.equal(r.effectivePollsters, 2);
  assert.deepEqual(r.candidates.map(c => c.percent), [49, 45]);
  assert.ok(Math.abs(r.projectedMargin - 4) < 0.01);
  assert.ok(r.error >= 6 && r.error <= 18);
  assert.deepEqual(r.pollIds.sort(), ['1', '2']);
  assert.equal(pollingReference([race], [rows[0]]).races[race.id], undefined);
});

test('Polling reference rejects duplicate answers, malformed shares and crowded same-party matchups', () => {
  const valid = poll('1', 'A', 50, 45);
  const duplicate = {...poll('2', 'B', 50, 45), answers: [...valid.answers, valid.answers[0]]};
  assert.equal(Object.keys(pollingReference([race], [valid, duplicate]).races).length, 0);
  assert.equal(Object.keys(pollingReference([{
    ...race,
    candidates: [...race.candidates, {name: 'Another Democrat', party: 'D'}],
  }], [valid, poll('2', 'B', 50, 45)]).races).length, 0);
});

test('Polling reference can aggregate 1D+NR headliner matchups', () => {
  const multi = {
    id: 'senate-AK',
    type: 'senate',
    state: 'AK',
    candidates: [
      {name: 'Mary Peltola', party: 'D'},
      {name: 'Dan Sullivan', party: 'R'},
      {name: 'Gerald Heikes', party: 'R'},
    ],
  };
  const rows = [
    poll('a', 'X', 48, 45, {
      subject: '2026 Alaska',
      answers: [
        {choice: 'Mary Peltola', pct: 48},
        {choice: 'Dan Sullivan', pct: 45},
        {choice: 'Gerald Heikes', pct: 2},
      ],
    }),
    poll('b', 'Y', 49, 44, {
      subject: '2026 Alaska',
      answers: [
        {choice: 'Mary Peltola', pct: 49},
        {choice: 'Dan Sullivan', pct: 44},
      ],
    }),
  ];
  const r = pollingReference([multi], rows).races[multi.id];
  assert.ok(r);
  assert.equal(r.candidates[0].name, 'Mary Peltola');
  assert.equal(r.candidates[1].name, 'Dan Sullivan');
  assert.equal(r.effectivePollsters, 2);
});
