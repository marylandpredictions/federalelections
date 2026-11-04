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
});
