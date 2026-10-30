import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ui=require('../../assets/polling-bias.js');
const data=JSON.parse(readFileSync('data/features/polling-bias.json','utf8'));
const geometry=JSON.parse(readFileSync('data/features/polling-bias-map.json','utf8'));
const html=readFileSync('features/polling-bias.html','utf8');
test('PDF import reconciles all state, contest and poll totals and the split race columns',()=>{
 assert.equal(data.states.length,50);assert.equal(new Set(data.states.map(s=>s.abbr)).size,50);
 assert.equal(data.states.reduce((n,s)=>n+s.raceCount,0),135);assert.equal(data.states.reduce((n,s)=>n+s.pollCount,0),835);
 for(const state of data.states){
  assert.equal(state.races.length,state.raceCount,state.abbr);assert.equal(state.races.reduce((n,r)=>n+r.polls,0),state.pollCount,state.abbr);
  for(const race of state.races){assert.ok(Math.abs(race.pollMargin-race.actualMargin-race.bias)<.0021,state.abbr+' '+race.year);assert.ok(race.pollsFinal21Days<=race.polls);assert.ok([2014,2016,2018,2020,2022,2024].includes(race.year));}
 }
});
test('source outliers, zero-evidence Oklahoma and source precision remain intact',()=>{
 const state=abbr=>data.states.find(s=>s.abbr===abbr);
 assert.equal(state('WA').prior,-6.8401);assert.equal(state('KY').prior,6.133);assert.equal(state('OK').raceCount,0);assert.equal(state('OK').prior,1.8334);
 assert.equal(state('KS').races.find(r=>r.year===2016).bias,-24.148);assert.equal(state('KS').races.find(r=>r.year===2016).cappedBias,-12);
 assert.equal(state('ME').races.find(r=>r.year===2020).bias,13.625);assert.equal(state('ME').races.find(r=>r.year===2020).cappedBias,12);
 assert.match(data.source.sha256,/^[a-f0-9]{64}$/);assert.equal(data.source.format,'User-provided PDF export');
});
test('both maps have exactly the source state coverage and finite geographic paths and labels',()=>{
 assert.deepEqual(geometry.states.map(s=>s.abbr).sort(),data.states.map(s=>s.abbr).sort());
 for(const state of geometry.states){assert.match(state.d,/^M/);assert.doesNotMatch(state.d,/NaN|Infinity/);assert.ok(state.label.every(Number.isFinite));assert.ok(state.label[0]>=0&&state.label[0]<=960);assert.ok(state.label[1]>=0&&state.label[1]<=600);assert.ok(state.bounds[1][0]-state.bounds[0][0]<600,state.abbr+': world-complement slab');assert.ok(state.bounds[1][1]-state.bounds[0][1]<450,state.abbr+': world-complement slab');}
});
test('positive is Democratic overstatement and every map label meets 4.5:1 contrast',()=>{
 const luminance=hex=>{const h=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 assert.equal(ui.direction(3),'Democratic overstatement');assert.equal(ui.direction(-3),'Republican overstatement');assert.equal(ui.number(-.0001),'0.00');
 for(let n=-12;n<=12;n+=.1){const fill=ui.color(n),label=ui.labelColor(fill),a=luminance(fill),b=luminance(label);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,fill);}
 assert.notEqual(ui.color(null),ui.color(0));
});
test('feature page includes a usable static table, source link, unique IDs and no chart dependency',()=>{
 assert.ok(html.includes(data.source.url));assert.match(html,/snapshot/);assert.match(html,/not a race forecast/);assert.doesNotMatch(html,/cdn.*d3|C:[\\/]/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 for(const state of data.states)assert.ok(html.includes(`data-state="${state.abbr}"`));
 assert.match(html,/aria-current="page">State polling bias/);assert.match(html,/<summary class="active">Features/);
});
