import test from 'node:test';import assert from 'node:assert/strict';import {pollingReference} from '../../scripts/results/polling-reference.mjs';
const race={id:'senate-OH',type:'senate',state:'OH',candidates:[{name:'Jane Doe',party:'D'},{name:'John Doe',party:'R'}]};
const poll=(id,pollster,a,b,extra={})=>({id,pollster,poll_type:'us-senator',subject:'2026 Ohio',end_date:'2026-10-30',population:'lv',internal:false,answers:[{choice:'Jane Doe',pct:a},{choice:'John Doe',pct:b}],...extra});
test('Polling reference uses raw candidate percentages, exact geography and matchup, and one latest poll per pollster',()=>{
 const rows=[poll('1','A',50,44),poll('2','B',48,46),poll('3','A',99,1,{end_date:'2026-10-29'}),poll('4','C',60,40,{subject:'2026 Iowa'}),poll('5','D',60,40,{poll_type:'governor'}),poll('6','E',60,40,{internal:true}),poll('7','F',60,40,{end_date:'2026-11-04'}),poll('8','G',60,40,{answers:[{choice:'Former nominee',pct:60},{choice:'John Doe',pct:40}]})];
 const r=pollingReference([race],rows).races[race.id];assert.equal(r.pollCount,2);assert.deepEqual(r.candidates.map(c=>c.percent),[49,45]);assert.deepEqual(r.pollIds,['1','2']);
 assert.equal(pollingReference([race],[rows[0]]).races[race.id],undefined);
});
test('Polling reference rejects duplicate answers, malformed shares and crowded same-party matchups',()=>{
 const valid=poll('1','A',50,45),duplicate={...poll('2','B',50,45),answers:[...valid.answers,valid.answers[0]]};
 assert.equal(Object.keys(pollingReference([race],[valid,duplicate]).races).length,0);
 assert.equal(Object.keys(pollingReference([{...race,candidates:[...race.candidates,{name:'Another Democrat',party:'D'}]}],[valid,poll('2','B',50,45)]).races).length,0);
});
