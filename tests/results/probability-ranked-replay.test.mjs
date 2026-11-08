import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {replayAlaskaRanked,verifyAlaskaReplay} from '../../scripts/results/probability-ranked-replay.mjs';
import {assessAlaskaTransfer} from '../../scripts/results/probability-ranked-transfer-study.mjs';
import {firstCountOutcome} from '../../scripts/results/probability-rule-outcomes.mjs';

const candidates={1:{},2:{},3:{},4:{writeIn:true}};
const input={
  archiveSha256:'fixture',electionId:'fixture',contestId:1,candidates,ballots:23,
  patterns:[
    {ranks:[[1],[],[],[],[]],count:9},
    {ranks:[[2],[],[],[],[]],count:8},
    {ranks:[[3],[2],[],[],[]],count:3},
    {ranks:[[3],[],[3],[2],[]],count:1},
    {ranks:[[3],[3,2],[2],[],[]],count:1},
    {ranks:[[4],[2],[],[],[]],count:1}
  ]
};
const control={
  archiveSha256:'fixture',electionId:'fixture',contestId:1,unresolvedWriteIns:[4],winner:2,
  rounds:[
    {votes:{1:9,2:9,3:5},continuing:23,eliminated:3},
    {votes:{1:9,2:12},continuing:21}
  ]
};

test('Alaska replay verifies transfers and exhausts duplicate skips and overvotes',()=>{
  assert.equal(verifyAlaskaReplay(input,control).winner,2);
  assert.throws(()=>verifyAlaskaReplay(input,{...control,contestId:2}),/does not match this ballot archive/);
  assert.throws(()=>verifyAlaskaReplay(input,{...control,rounds:[{...control.rounds[0],continuing:22},control.rounds[1]]}),/round 1/);
});

test('Alaska replay requires official write-in resolution and stops at an unresolved tie',()=>{
  assert.equal(replayAlaskaRanked(input).status,'write-ins-require-official-resolution');
  assert.equal(replayAlaskaRanked({...input,candidates:{1:{},2:{}},ballots:2,patterns:[
    {ranks:[[1],[]],count:1},{ranks:[[2],[]],count:1}
  ]}).status,'tie-requires-official-resolution');
});

test('Transfer sensitivity preserves abstentions and holds the later reported outcome out of the estimate',async()=>{
  const path=new URL('../../data/results/probability-alaska-house-transfer-controls.json',import.meta.url);
  const fixture=JSON.parse(await readFile(path,'utf8'));
  const scored=assessAlaskaTransfer(fixture);
  assert.equal(scored.earlierTransferMargin.toFixed(2),'18.56');
  assert.equal(scored.actualMargin.toFixed(2),'9.89');
  fixture.evaluation.countsAfterTransfer['Sarah Palin']++;
  assert.equal(assessAlaskaTransfer(fixture).earlierTransferMargin,scored.earlierTransferMargin);
  fixture.training.availableAt='2022-11-09T00:00:00Z';
  assert.throws(()=>assessAlaskaTransfer(fixture),/requires an earlier source/);
});

test('Official 2024 Maine district returns require tabulation even with a majority of named first choices',()=>{
  // Maine Secretary of State statewide control row and final tabulation.
  const firstChoices={golden:196388,theriault:194130,others:421};
  const allBallots=402936;
  assert.ok(firstChoices.golden>(firstChoices.golden+firstChoices.theriault)/2);
  assert.equal(firstCountOutcome('ranked-choice',firstChoices,allBallots).status,'transfers-required');
});
