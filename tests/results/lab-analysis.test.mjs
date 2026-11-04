import test from 'node:test';
import assert from 'node:assert/strict';
import lab from '../../assets/fea-lab-analysis.js';

const candidates = (d,r,i=0) => [
  {party:'D',votes:d}, {party:'R',votes:r}, {party:'I',votes:i}
];

test('Lab uses all votes for party margins and ranks the actual top two candidates', () => {
  const result = lab.contest(candidates(35,20,45));
  assert.equal(result.margin,15);
  assert.equal(result.leader.party,'I');
  assert.equal(result.gap,10);
  assert.equal(result.gapPoints,10);
});

test('Lab computes an uncapped change with a common denominator convention', () => {
  const current = lab.contest(candidates(89,10,1));
  const result = lab.shift(current,{candidates:candidates(10,90),total:100,margin:-80});
  assert.equal(result.value,159);
});

test('Lab separates missing, one-party, and inconsistent historical returns', () => {
  const current = lab.contest(candidates(55,45));
  for (const past of [null,{candidates:candidates(100,0),total:100,margin:100},{candidates:candidates(40,50),total:100,margin:25}]) {
    const result = lab.shift(current,past);
    assert.ok(Number.isNaN(result.value));
    assert.ok(result.reason);
  }
  assert.ok(Number.isNaN(lab.contest(candidates(100,0)).gap));
  assert.ok(Number.isNaN(lab.contest(candidates(0,0)).margin));
  const rankedChoice = lab.shift(current,{candidates:candidates(60,40),total:100,margin:20,round:'first-choice'});
  assert.ok(Number.isNaN(rankedChoice.value));
  assert.match(rankedChoice.reason,/round is not verified/);
});

test('Snapshot findings distinguish the closest race by votes from the closest by share', () => {
  const rows = [
    {race:{id:'large',candidates:[{name:'Winner',party:'R'}],calls:[{candidate:'Winner'}]},current:lab.contest(candidates(5050,4950)),swing:-12},
    {race:{id:'small',candidates:[]},current:lab.contest(candidates(55,45)),swing:3},
    {race:{id:'missing',candidates:[]},current:lab.contest(candidates(0,0)),swing:NaN}
  ];
  const snapshot = lab.findings(rows);
  assert.equal(snapshot.close[0].race.id,'large');
  assert.equal(snapshot.closeVotes[0].race.id,'small');
  assert.equal(snapshot.swings[0].race.id,'large');
  assert.deepEqual(snapshot.calls,{D:0,R:1,other:0});
  assert.equal(snapshot.reported,2);
  assert.equal(snapshot.withinTwo,1);
});

test('Local findings use published vote edges and skip unreported units', () => {
  const local = lab.localFindings([
    {name:'East',candidates:candidates(60,20,20)},
    {name:'West',candidates:candidates(30,50)},
    {name:'Unreported',candidates:candidates(0,0)}
  ]);
  assert.equal(local.rows.length,2);
  assert.equal(local.votes,180);
  assert.equal(local.edge,20);
  assert.equal(local.dem.county.name,'East');
  assert.equal(local.rep.county.name,'West');
});
