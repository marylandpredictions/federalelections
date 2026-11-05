import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import model from '../../assets/incoming-congress-model.js';

const read = path => JSON.parse(readFileSync(path,'utf8'));
const config = read('data/features/incoming-congress-120.json');
const catalogue = read('data/features/map-maker-races.json').races;
const race = {
  id:'senate-OH',type:'senate',
  candidates:[{name:'First',party:'I',votes:55},{name:'Second',party:'R',votes:35},{name:'Third',party:'D',votes:10}],
  calls:[{candidate:'First',status:'projected'}]
};

test('An uncalled tie has no leader and later returns update the same seat',()=>{
  const current = candidates=>model.composition('senate',catalogue,config,[{...race,calls:[],candidates}])
    .seats.find(seat=>seat.id===race.id);
  const tied = current([{name:'First',party:'I',votes:50},{name:'Second',party:'R',votes:50}]);
  assert.equal(tied.status,'uncalled');
  assert.equal(tied.tied,true);
  assert.equal(tied.leader,null);
  const updated = current([{name:'First',party:'I',votes:50},{name:'Second',party:'R',votes:60}]);
  assert.equal(updated.id,tied.id);
  assert.equal(updated.tied,false);
  assert.equal(updated.leader.name,'Second');
  assert.equal(updated.winner,null);
});

test('Every arrangement keeps party blocks and anchors continuing seats on the outside',()=>{
  const seats = [
    {id:'d-1',state:'AZ',group:'D',status:'called',margin:2},
    {id:'d-2',state:'CA',group:'D',status:'called',margin:7},
    {id:'d-held',state:'WA',group:'D',status:'continuing'},
    {id:'r-1',state:'TX',group:'R',status:'called',margin:4},
    {id:'r-held',state:'AK',group:'R',status:'continuing'},
    {id:'u-1',state:'AL',group:'uncalled',status:'uncalled'}
  ];
  for (const mode of ['party','margin','state']) {
    const sorted = model.arrange(seats,mode);
    assert.deepEqual(sorted.map(seat=>seat.group),['D','D','D','uncalled','R','R']);
    assert.equal(sorted[0].id,'d-held');
    assert.equal(sorted.at(-1).id,'r-held');
    assert.equal(sorted[1].id,mode==='margin' ? 'd-2' : 'd-1');
  }
});

test('Caucusing independents stay purple in the Democratic section and narrow margins face inward',()=>{
  const seats = [
    {id:'d-close',state:'AZ',group:'D',status:'called',margin:1},
    {id:'d-wide',state:'CA',group:'D',status:'called',margin:10},
    {id:'king',state:'ME',group:'I',status:'continuing',caucus:'D'},
    {id:'r-wide',state:'TX',group:'R',status:'called',margin:12},
    {id:'r-close',state:'UT',group:'R',status:'called',margin:2}
  ];
  assert.equal(model.section(seats[2]),'D');
  assert.equal(seats[2].group,'I');
  assert.deepEqual(model.arrange(seats,'margin').map(seat=>seat.id),
    ['king','d-wide','d-close','r-close','r-wide']);
  assert.deepEqual(model.arrange(seats,'state').map(seat=>seat.id),
    ['king','d-close','d-wide','r-wide','r-close']);
});

test('Each real district and Senate seat is unique, including both special elections',()=>{
  for (const [office,expected] of Object.entries(config.expected)) {
    const result = model.composition(office,catalogue,config,[]);
    assert.equal(result.complete,true);
    assert.equal(new Set(result.seats.map(s=>s.id)).size,expected);
    assert.equal(result.counts.uncalled,0);
    assert.equal(result.counts.missing,office==='senate'?35:435);
    assert.equal(result.seats.filter(s=>s.status==='continuing').length,office==='senate'?65:0);
    assert.equal(result.seats.filter(s=>s.special).length,office==='senate'?2:0);
    assert.equal(result.counts.I,office==='senate'?2:0);
    const layout = model.layout(expected);
    assert.equal(layout.length,expected);
    assert.equal(new Set(layout.map(s=>s.x.toFixed(2)+','+s.y.toFixed(2))).size,expected);
    assert.ok(layout.every(s=>s.x>24 && s.x<876 && s.y>40 && s.y<342));
  }
});

test('Calls and retractions update the same seat; sorting retains its identity and totals',()=>{
  const incoming = model.composition('senate',catalogue,config,[race]);
  const seat = incoming.seats.find(s=>s.id===race.id);
  assert.equal(seat.status,'called');
  assert.equal(seat.group,'I');
  assert.equal(seat.margin,20);
  assert.equal(seat.total,100);
  assert.equal(incoming.counts.I,3);
  for (const mode of ['party','margin','state']) {
    const sorted = model.arrange(incoming.seats,mode);
    assert.equal(sorted.find(s=>s.id===seat.id),seat);
    assert.deepEqual(sorted.map(s=>s.id).sort(),incoming.seats.map(s=>s.id).sort());
  }
  const withdrawn = model.composition('senate',catalogue,config,[{...race,calls:[{...race.calls[0],retracted:true}]}]);
  assert.equal(withdrawn.counts.I,2);
  assert.equal(withdrawn.counts.uncalled,1);
  assert.equal(withdrawn.seats.find(s=>s.id===race.id).margin,null);
  const invalid = model.composition('senate',catalogue,config,[{...race,calls:[{candidate:'Unknown',status:'winner'}]}]);
  assert.equal(invalid.counts.I,2);
  assert.equal(invalid.counts.missing,35);
});
