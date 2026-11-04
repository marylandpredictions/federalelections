import test from 'node:test';
import assert from 'node:assert/strict';
import cycle from '../../assets/home-cycle.js';

const race = (id, expectedVotePercent, call) => ({id,expectedVotePercent,calls:call ? [call] : []});
const call = (candidate, calledAt, retracted = false) => ({candidate,calledAt,retracted});
const rank = (...races) => races.map(race=>({race}));

test('Editorial phase drives polling and suppresses election updates between cycles', () => {
  assert.equal(cycle.phase('election-night').poll,true);
  assert.equal(cycle.phase('post-election').title,'Election recap');
  assert.equal(cycle.phase('post-election').poll,false);
  assert.equal(cycle.phase('between-elections').updates,'');
  assert.equal(cycle.phase('constructor').updates,'');
});

test('Live selection omits known early margins and does not treat no-vote races as completed', () => {
  const early = race('early',4);
  const active = race('active',80);
  const unavailable = race('unavailable',null);
  const finished = race('called',100,call('Winner','2026-11-04T04:00:00Z'));
  assert.deepEqual(cycle.raceUpdates(rank(early,active,finished),[early,active,unavailable,finished]).selected,rank(active));
  const pending = cycle.raceUpdates(rank(finished),[unavailable,finished]);
  assert.equal(pending.unresolved,true);
  assert.deepEqual(pending.selected,[]);
  assert.deepEqual(cycle.raceUpdates(rank(finished),[finished]).selected,rank(finished));
});

test('Call feed uses current public calls, deduplicates races and omits retractions', () => {
  const original = race('same',90,call('Original','2026-11-04T03:00:00Z'));
  const corrected = race('same',90,call('Corrected','2026-11-04T04:00:00Z'));
  const retracted = race('retracted',90,call('Retracted','2026-11-04T05:00:00Z',true));
  const undated = race('undated',90,call('Undated',''));
  const result = cycle.raceUpdates(rank(retracted),[original,corrected,retracted,undated]);
  assert.deepEqual(result.recent.map(row=>row.call.candidate),['Corrected']);
  assert.deepEqual(result.selected,rank(retracted));
});
