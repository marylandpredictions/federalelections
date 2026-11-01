import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{InkStore,pathData}=require('../../assets/map-annotations.js'),UI=require('../../assets/results-ui.js'),Theme=require('../../assets/desk-theme.js');
test('Map ink is scoped, copied, bounded and independent of ratings',()=>{
 const ink=new InkStore(),points=[[10,20],[30,40]];ink.add('senate','#ffe600',5,points);points[0][0]=999;
 assert.equal(ink.forScope('senate')[0].points[0][0],10);ink.add('senate-CO','#ff0000',3,[[1,2]]);ink.undo('senate');assert.equal(ink.forScope('senate').length,0);assert.equal(ink.forScope('senate-CO').length,1);
 for(let n=0;n<200;n++)ink.add('house','#00ff00',9,[[n,n]]);assert.equal(ink.strokes.length,100);ink.clear('house');assert.equal(ink.strokes.length,0);
});
test('Malformed annotation values cannot create SVG attributes or unbounded paths',()=>{
 const ink=new InkStore();for(const args of [['x','url(javascript:bad)',3,[[0,0]]],['x','#ffffff',20,[[0,0]]],['x','#ffffff',3,[[NaN,0]]],['x','#ffffff',3,[]],['x','#ffffff',3,Array.from({length:1501},()=>[0,0])]])assert.throws(()=>ink.add(...args));
 assert.equal(pathData([[1.234,2.345],[4,5]]),'M1.23,2.35L4,5');assert.equal(pathData([[1,2]]),'M1,2l.01,.01');
});
test('Shared historical comparison cards keep published votes, party styling and blank boundary state',()=>{
 const row={total:100,candidates:[{name:'A <test>',party:'D',votes:55},{name:'B',party:'R',votes:45}]},html=UI.comparisonColumn('2024','President',row,Theme);
 assert.match(html,/comparison-candidate is-history-leader/);assert.match(html,/A &lt;test&gt;/);assert.match(html,/55.0<em>%/);assert.match(html,/D \+10.0/);assert.doesNotMatch(html,/2026|PROJECTED WINNER/);
 assert.match(UI.comparisonColumn('2024','House',null,Theme),/No verified result for these boundaries/);
});
test('Shared Census profiles preserve facts layout and county/district source scope',()=>{
 const row={name:'Test',population:1000,income:50000,whiteNH:60,boundaryStatus:'historical-boundaries'};
 const county=UI.demographicProfile(row,{house:true,county:true});assert.match(county,/ACS 5-year/);assert.match(county,/Whole-county estimates/);assert.doesNotMatch(county,/Earlier district boundaries/);assert.match(county,/<dl class="race-facts"><div><dt>Population/);
 const district=UI.demographicProfile(row,{house:true,district:true});assert.match(district,/ACS 1-year/);assert.match(district,/Earlier district boundaries/);assert.match(district,/119th Congress/);
});
test('NBC palette refresh upgrades old defaults while preserving customized and saved themes',()=>{
 const preset=Theme.presets.find(p=>p.id==='nbc-big-board'),old={...preset,advanced:{...preset.advanced,'map-bg':'#e1e3e5','board-bg':'#e1e3e5','map-neutral':'#b7c2ce'},partyColors:{D:'#0078bd',R:'#c8203f',I:'#8b57b5',O:'#d59119'}};
 const read=current=>Theme.read({getItem:()=>JSON.stringify({schemaVersion:1,current,saved:[]})}).current;
 assert.equal(read(old).partyColors.D,'#008cdb');assert.equal(read(old).partyColors.R,'#eb263b');
 assert.equal(read(old).advanced['map-bg'],'#1c2c44');assert.equal(read({...old,advanced:{...old.advanced,'map-bg':'#445566'}}).advanced['map-bg'],'#445566');
 assert.equal(read({...old,id:'custom-nbc'}).partyColors.D,'#0078bd');
 assert.deepEqual(read({...old,partyColors:{...old.partyColors,D:'#123456'}}).partyColors,{...old.partyColors,D:'#123456'});
});
