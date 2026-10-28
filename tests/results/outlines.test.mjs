import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const desk=createRequire(import.meta.url)('../../assets/results-desk.js');
const schedule=JSON.parse(readFileSync('data/results/poll-closes.json'));
const races=JSON.parse(readFileSync('data/election-night-races.json')).races;
test('Default outlines select every race in the next closing group, then advance at the exact close',()=>{
 const house=races.filter(r=>r.type==='house');
 const first=desk.nextPollClosures(house,schedule,Date.parse('2026-10-28T12:00:00Z'));
 assert.equal(first.at,Date.parse('2026-11-03T23:00:00Z'));
 assert.ok(first.raceIds.includes('house-IN-2'));
 assert.ok(first.raceIds.includes('house-KY-3'));
 assert.ok(!first.raceIds.includes('house-IN-1'));
 const next=desk.nextPollClosures(house,schedule,first.at);
 assert.equal(next.at,Date.parse('2026-11-04T00:00:00Z'));
 assert.ok(next.raceIds.includes('house-IN-1'));
 assert.ok(next.raceIds.includes('house-FL-3'));
 assert.ok(!next.raceIds.includes('house-IN-2'));
 assert.deepEqual(desk.raceOutlineIds(house,schedule,'next',first.at),next.raceIds);
});
test('Statewide races use statewide closing time; House respects split-state district schedules',()=>{
 assert.equal(desk.racePollCloseAt({state:'ID',type:'house',district:'02'},schedule),Date.parse('2026-11-04T03:00:00Z'));
 assert.equal(desk.racePollCloseAt({state:'ID',type:'senate'},schedule),Date.parse('2026-11-04T04:00:00Z'));
 const senate=races.filter(r=>r.type==='senate');
 const first=desk.nextPollClosures(senate,schedule,Date.parse('2026-10-28T12:00:00Z'));
 assert.deepEqual(first.raceIds.sort(),['senate-GA','senate-KY','senate-SC','senate-VA']);
});
test('Watch mode uses explicit watch metadata and stays independent of the clock',()=>{
 const rows=[{id:'watch',watch:{watch:true}},{id:'tossup',watch:{tossup:true}},{id:'close',candidates:[{party:'D',votes:51},{party:'R',votes:49}]}];
 assert.deepEqual(desk.raceOutlineIds(rows,null,'watch',0),['watch','tossup']);
 assert.deepEqual(desk.raceOutlineIds(rows,null,'watch',Infinity),['watch','tossup']);
});
test('No source, unknown geography, or no remaining scheduled closes produces no invented outlines',()=>{
 assert.deepEqual(desk.nextPollClosures(races,null,0),{at:null,raceIds:[]});
 assert.deepEqual(desk.nextPollClosures([{id:'unknown',state:'ZZ'}],schedule,0),{at:null,raceIds:[]});
 assert.deepEqual(desk.raceOutlineIds(races,schedule,'next',Date.parse('2026-11-05T00:00:00Z')),[]);
});
