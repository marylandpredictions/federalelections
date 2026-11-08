import assert from 'node:assert/strict';
import test from 'node:test';
import {reconcileStateArchive} from '../../scripts/results/probability-state-archive-study.mjs';

const race={id:'senate-OH',candidates:[
  {id:'d',name:'Alex Example'},
  {id:'r',name:'Robin Example'},
  {id:'w',name:'William Example',aliases:['Bill Example'],writeIn:true}
]};
const counties=[{county:'Adams',fips:'39001'},{county:'Allen',fips:'39003'}];
const manifest={id:race.id,state:'OH',contest:'U.S. Senate',expectedCountyCount:2,
  source:'State',sourceUrl:'https://example.test/counts',archiveCommitAt:'2026-11-04T18:00:00Z',
  notBefore:'2026-11-04T00:30:00Z'};
const rows=[['',3,4,1],['Adams',1,2,1],['Allen',2,2,0]].flatMap(([county,d,r,w])=>
  [['Alex Example',d],['Robin Example',r],['Bill Example',w]].map(([candidate,votes])=>({
    state:'OH',contest:manifest.contest,level:county?'county':'state',county,candidate,votes:String(votes),
    contestTotalVotes:String(d+r+w),source:manifest.source,sourceUrl:manifest.sourceUrl,
    fetchedAt:'2026-11-04T17:15:59Z',sourceUpdatedAt:''
  })));

test('State archives preserve known write-ins and unknown source update time',()=>{
  const observed=reconcileStateArchive(rows,race,counties,manifest);
  assert.equal(observed.statewide.total,8);
  assert.equal(observed.counties[0].candidateVotes.w,1);
  assert.equal(observed.counties[1].candidateVotes.w,0);
  assert.equal(observed.sourceUpdatedAt,null);
  assert.equal(observed.observedAt,'2026-11-04T17:15:59.000Z');
});

test('State archives reject wrong timestamps, missing write-ins, and counts that only reconcile in aggregate',()=>{
  const read=input=>reconcileStateArchive(input,race,counties,manifest);
  assert.throws(()=>read([...rows,{...rows[0],fetchedAt:'2026-11-04T18:00:01Z'}]),/capture time/);
  assert.throws(()=>read(rows.slice(0,-1)),/incomplete roster/);
  assert.throws(()=>read(rows.map((row,index)=>index===0?{...row,votes:'4'}:
    index===1?{...row,votes:'3'}:row)),/do not reconcile/);
});
