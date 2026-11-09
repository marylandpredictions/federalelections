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

test('House popular vote sums every district ballot by party for each state',()=>{
  const races = [
    {id:'h-ca-1',type:'house',state:'CA',candidates:[
      {partyCode:'D',votes:100},{partyCode:'R',votes:80},{party:'Green',votes:5},
    ]},
    {id:'h-ca-2',type:'house',state:'CA',candidates:[
      {partyCode:'D',votes:50},{partyCode:'R',votes:90},{partyCode:'I',votes:10},
    ]},
    {id:'h-tx-1',type:'house',state:'TX',candidates:[
      {partyCode:'R',votes:200},{partyCode:'D',votes:150},
    ]},
  ];
  const {housePopular,nationalHouse} = home.summarize(races);
  assert.deepEqual(Object.fromEntries(housePopular),{
    CA:{D:150,R:170,other:15},
    TX:{D:150,R:200,other:0},
  });
  const leans = home.statePopularLean(housePopular);
  assert.equal(leans.get('CA').lean,'R');
  assert.equal(leans.get('TX').lean,'R');
  assert.equal(leans.get('CA').total,335);
  assert.ok(leans.get('TX').margin < leans.get('CA').margin);
  assert.equal(home.marginFill(null, {open:'#111'}), '#111');
  assert.equal(home.marginFill(leans.get('TX'), {D:'#00f',R:'#f00',open:'#111',split:'#888'}), '#f00');
  assert.deepEqual(nationalHouse,{
    D:300,R:370,other:15,total:685,
    demShare:100*300/685,repShare:100*370/685,otherShare:100*15/685,
    margin:100*(300-370)/685,
  });
});
