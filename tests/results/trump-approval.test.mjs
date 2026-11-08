import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'fs';
import {
  normalizeApprovalPoll,
  collapseSamePollsterDay,
  weightApprovalPolls,
  buildTrumpApproval,
} from '../../scripts/polling/build-trump-approval.mjs';

const sample = [
  {
    id: 'a1',
    poll_type: 'approval',
    sample_size: 1000,
    population: 'rv',
    start_date: '2026-09-20',
    end_date: '2026-09-22',
    pollster: 'Alpha',
    answers: [{choice: 'Approve', pct: 42}, {choice: 'Disapprove', pct: 55}],
    internal: false,
    partisan: null,
  },
  {
    id: 'a2',
    poll_type: 'approval',
    sample_size: 900,
    population: 'a',
    start_date: '2026-09-25',
    end_date: '2026-09-27',
    pollster: 'Beta',
    answers: [{choice: 'Approve', pct: 40}, {choice: 'Disapprove', pct: 57}],
    internal: false,
    partisan: null,
  },
  {
    id: 'a3',
    poll_type: 'approval',
    sample_size: 800,
    population: 'lv',
    start_date: '2026-09-28',
    end_date: '2026-09-30',
    pollster: 'Alpha',
    answers: [{choice: 'Approve', pct: 41}, {choice: 'Disapprove', pct: 56}],
    internal: false,
    partisan: null,
  },
];

test('normalizes and collapses Trump approval polls', () => {
  const rows = sample.map(normalizeApprovalPoll);
  assert.equal(rows.filter(Boolean).length, 3);
  assert.equal(rows[0].net, -13);
  const collapsed = collapseSamePollsterDay(rows);
  assert.equal(collapsed.length, 3);
});

test('weights a current approval window', () => {
  const rows = sample.map(normalizeApprovalPoll);
  const result = weightApprovalPolls(rows, {asOf: '2026-10-01'});
  assert.ok(result);
  assert.ok(result.approve > 39 && result.approve < 43);
  assert.ok(result.disapprove > 54 && result.disapprove < 58);
  assert.equal(result.pollCount, 3);
  assert.equal(result.effectivePollsters, 2);
});

test('builds packaged release JSON shape', () => {
  const release = buildTrumpApproval(sample, {asOf: '2026-09-30'});
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.subject, 'Donald Trump');
  assert.equal(release.asOf, '2026-09-30');
  assert.ok(release.current.pollCount >= 2);
  assert.ok(release.series.length >= 1);
  assert.ok(release.recentPolls.length >= 2);
});

test('page and published data exist', () => {
  const html = readFileSync('polling/trump-approval.html', 'utf8');
  assert.match(html, /Polling averages/);
  assert.match(html, /Trump Approval/);
  assert.match(html, /trump-approval\.js/);
  const data = JSON.parse(readFileSync('data/polling/trump-approval.json', 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.ok(data.current.approve > 0);
  assert.ok(data.series.length > 10);
});
