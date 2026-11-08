import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'fs';
import {
  normalizeApprovalPoll,
  collapseSamePollsterDay,
  weightApprovalPolls,
  buildTrumpApproval,
} from '../../scripts/polling/build-trump-approval.mjs';
import {
  canonicalPollster,
  dedupeApprovalPolls,
  fromPollfinity,
  fromVoteHub,
} from '../../scripts/polling/approval-sources.mjs';

function makePoll({id, pollster, end, approve, disapprove, population = 'rv', n = 1000}) {
  return {
    id,
    poll_type: 'approval',
    sample_size: n,
    population,
    start_date: end,
    end_date: end,
    pollster,
    answers: [{choice: 'Approve', pct: approve}, {choice: 'Disapprove', pct: disapprove}],
    internal: false,
    partisan: null,
  };
}

const sample = [
  makePoll({id: 'a1', pollster: 'Alpha', end: '2026-09-01', approve: 42, disapprove: 55}),
  makePoll({id: 'a2', pollster: 'Beta', end: '2026-09-05', approve: 40, disapprove: 57}),
  makePoll({id: 'a3', pollster: 'Gamma', end: '2026-09-10', approve: 41, disapprove: 56}),
  makePoll({id: 'a4', pollster: 'Delta', end: '2026-09-15', approve: 39, disapprove: 58}),
  makePoll({id: 'a5', pollster: 'Epsilon', end: '2026-09-20', approve: 40, disapprove: 57}),
  makePoll({id: 'a6', pollster: 'Zeta', end: '2026-09-25', approve: 38, disapprove: 59}),
  makePoll({id: 'a7', pollster: 'Eta', end: '2026-09-28', approve: 39, disapprove: 58}),
  makePoll({id: 'a8', pollster: 'Theta', end: '2026-09-30', approve: 40, disapprove: 57}),
  makePoll({id: 'a9', pollster: 'Iota', end: '2026-08-01', approve: 43, disapprove: 54}),
  makePoll({id: 'a10', pollster: 'Kappa', end: '2026-07-15', approve: 44, disapprove: 53}),
];

test('normalizes and collapses Trump approval polls', () => {
  const rows = sample.map(normalizeApprovalPoll);
  assert.equal(rows.filter(Boolean).length, 10);
  assert.equal(rows[0].net, -13);
  assert.equal(collapseSamePollsterDay(rows).length, 10);
});

test('soft decay keeps more than a short hard window', () => {
  const rows = sample.map(normalizeApprovalPoll);
  const hardish = weightApprovalPolls(rows, {asOf: '2026-09-30', maxAgeDays: 45, halfLife: 14});
  const soft = weightApprovalPolls(rows, {asOf: '2026-09-30'});
  assert.ok(soft.pollCount >= hardish.pollCount);
  assert.ok(soft.enop > 3);
  assert.ok(soft.approve > 35 && soft.approve < 45);
});

test('builds packaged release JSON shape without thin-end spikes', () => {
  const release = buildTrumpApproval(sample, {asOf: '2026-09-30'});
  assert.equal(release.schemaVersion, 3);
  assert.equal(release.subject, 'Donald Trump');
  assert.equal(release.asOf, '2026-09-30');
  assert.ok(release.current.pollCount >= 8);
  assert.ok(release.current.enop > 3);
  assert.ok(release.series.length >= 1);
  assert.ok(release.recentPolls.length >= 5);
  const last = release.series.at(-1);
  const prev = release.series.at(-2) || last;
  assert.ok(Math.abs(last.approve - prev.approve) < 8);
});

test('dedupes identical surveys across VoteHub and Pollfinity labels', () => {
  assert.equal(canonicalPollster('YouGov / The Economist'), 'yougov');
  assert.equal(canonicalPollster('Economist/YouGov'), 'yougov');
  const votehub = fromVoteHub({
    id: 'vh1',
    poll_type: 'approval',
    sample_size: 1400,
    population: 'rv',
    start_date: '2026-10-26',
    end_date: '2026-10-26',
    pollster: 'YouGov',
    answers: [{choice: 'Approve', pct: 39}, {choice: 'Disapprove', pct: 58}],
    internal: false,
    url: 'https://example.test/vh',
  });
  const pollfinity = fromPollfinity({
    pollster: 'YouGov / The Economist',
    end_date: '2026-10-26',
    sample_size: 1440,
    approve: 39,
    disapprove: 58,
  });
  const {polls, collapsed} = dedupeApprovalPolls([votehub, pollfinity]);
  assert.equal(collapsed, 1);
  assert.equal(polls.length, 1);
  assert.deepEqual(polls[0].sources.sort(), ['pollfinity', 'votehub']);
  assert.ok(polls[0].url);
});

test('page has net toggle and published data exists', () => {
  const html = readFileSync('polling/trump-approval.html', 'utf8');
  assert.match(html, /Polling averages/);
  assert.match(html, /approval-view-net/);
  assert.match(html, /Net approval/);
  assert.match(html, /Pollfinity/);
  const js = readFileSync('assets/trump-approval.js', 'utf8');
  assert.match(js, /visibility:\s*'hidden'|setAttribute\('visibility', 'hidden'\)/);
  const data = JSON.parse(readFileSync('data/polling/trump-approval.json', 'utf8'));
  assert.ok(data.current.pollCount > 5);
  assert.ok(data.current.enop > 5);
  assert.ok(data.series.length > 10);
  assert.ok((data.sources || []).some(s => s.source === 'votehub'));
  assert.ok((data.sources || []).some(s => s.source === 'pollfinity'));
  assert.ok(data.asOf >= '2026-10-26');
});
