import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import model from '../../assets/incoming-congress-model.js';
import home from '../../assets/home-results.js';

const read = path => JSON.parse(readFileSync(path,'utf8'));

test('The homepage counts published contest calls, preserves the Mississippi manual call, and excludes retractions',()=>{
  const base = read('data/election-night-races.json').races.find(race=>race.id==='senate-MS');
  const production = read('data/result-calls.json').races[base.id];
  const archive = read('data/results/archive/2026-11-03-congress.json');
  const recorded = archive.groups.flatMap(group=>group.races).find(race=>race.id===base.id);
  const manual = {...recorded,calls:production.calls};
  const retracted = {...recorded,id:'senate-fixture',calls:[{...production.calls[0],retracted:true},...production.calls]};
  const {totals,recent,close} = home.summarize([manual,retracted]);
  assert.deepEqual(totals.senate,{D:1,R:0,other:0,called:1,open:1});
  assert.equal(recent[0].winner.name,'Scott Colom');
  assert.equal(recent[0].call.source,'fea-manual');
  assert.equal(close[0].race.id,retracted.id);
  const config = read('data/features/incoming-congress-120.json');
  const catalogue = read('data/features/map-maker-races.json').races;
  const seat = race=>model.composition('senate',catalogue,config,[race]).seats.find(row=>row.id===base.id);
  assert.equal(seat(manual).winner.name,'Scott Colom');
  assert.equal(seat(recorded).status,'uncalled');
});

test('Close-race gaps use all reported votes and omit very early estimates',()=>{
  const race = {id:'house-test',type:'house',expectedVotePercent:70,candidates:[{votes:52},{votes:48},{votes:10}]};
  const {close} = home.summarize([{...race,id:'early',expectedVotePercent:5},race]);
  assert.deepEqual(close.map(row=>row.race.id),[race.id]);
  assert.equal(close[0].gap,400/110);
});
