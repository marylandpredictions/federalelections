import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {Scenario,validate,ratings}=createRequire(import.meta.url)('../../assets/scenario-model.js');
const catalogue=JSON.parse(readFileSync('data/election-night-races.json')).races;
test('Scenario ratings use the existing FEA rating vocabulary and all 506 contest IDs',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(readFileSync('assets/prediction-map-utils.js','utf8'),context);
 assert.deepEqual([...context.window.FeaPredictionMaps.allowedRatings].sort(),[...ratings].sort());
 assert.deepEqual(JSON.parse(readFileSync('data/features/map-maker-races.json')).races,catalogue.map(({id,type,state,district})=>({id,type,state,...(district!==undefined?{district}:{})})));
 const model=new Scenario(catalogue);assert.equal(catalogue.length,506);
 assert.deepEqual(model.counts('house'),{D:0,R:0,I:0,T:435});assert.equal(model.counts('senate').T,35);assert.equal(model.counts('governor').T,36);
});
test('Rating strokes undo atomically, redo correctly, preserve other offices and stay bounded',()=>{
 const model=new Scenario(catalogue),a=catalogue.find(r=>r.type==='house').id,b=catalogue.find(r=>r.type==='senate').id;
 model.apply([[a,'Safe Democratic'],[b,'Lean Independent']]);assert.equal(model.counts('house').D,1);assert.equal(model.counts('senate').I,1);
 model.undo();assert.equal(model.rating(a),'Tossup');assert.equal(model.rating(b),'Tossup');model.redo();assert.equal(model.rating(b),'Lean Independent');
 for(let i=0;i<300;i++)model.apply([[a,i%2?'Safe Republican':'Safe Democratic']]);assert.equal(model.past.length,100);
 model.undo();model.apply([[a,'Tilt Independent']]);assert.equal(model.future.length,0);
 const before=JSON.stringify(model.state);assert.throws(()=>model.apply([[a,'Safe Democratic'],['not-a-race','Safe Republican']]));assert.equal(JSON.stringify(model.state),before);
});
test('Scenario files restore exact ratings and reject unsafe, invalid and incompatible imports',()=>{
 const model=new Scenario(catalogue),id=catalogue[0].id;model.apply([[id,'Likely Republican']]);model.state.title='<My scenario>';
 assert.deepEqual(new Scenario(catalogue,JSON.parse(JSON.stringify(model.state))).state,model.state);
 for(const bad of [{...model.state,schemaVersion:2},{...model.state,office:'president'},{...model.state,title:'x'.repeat(81)},{...model.state,ratings:{[id]:'winner'}},{...model.state,ratings:{unknown:'Safe Democratic'}},{...model.state,ratings:[]}])assert.throws(()=>validate(bad,catalogue));
 assert.throws(()=>validate(JSON.parse('{"schemaVersion":1,"title":"x","office":"house","ratings":{"__proto__":"Safe Democratic"}}'),catalogue));
});

test('Full scenario totals include held seats, keep independents separate, and survive edits/imports/undo',()=>{
 const model=new Scenario(catalogue);
 assert.deepEqual(model.totalCounts('senate'),{D:32,R:31,I:2,T:35});
 assert.deepEqual(model.totalCounts('governor'),{D:6,R:8,I:0,T:36});
 assert.deepEqual(model.totalCounts('house'),{D:0,R:0,I:0,T:435});
 model.apply([['senate-CO','Safe Democratic'],['governor-CO','Lean Republican']]);
 assert.deepEqual(model.totalCounts('senate'),{D:33,R:31,I:2,T:34});assert.deepEqual(model.totalCounts('governor'),{D:6,R:9,I:0,T:35});
 for(const [office,total] of [['senate',100],['governor',50],['house',435]])assert.equal(Object.values(model.totalCounts(office)).reduce((n,v)=>n+v,0),total);
 model.undo();assert.deepEqual(model.totalCounts('senate'),{D:32,R:31,I:2,T:35});
 const restored=new Scenario(catalogue,JSON.parse(JSON.stringify(model.state)));assert.deepEqual(restored.totalCounts('governor'),{D:6,R:8,I:0,T:36});
 model.apply(catalogue.filter(r=>r.type==='senate').map(r=>[r.id,'Safe Republican']));assert.deepEqual(model.totalCounts('senate'),{D:32,R:66,I:2,T:0});
});

test('Race explorer uses an inline board panel and shared map region, not a modal',()=>{
 const html=readFileSync('features/map-maker.html','utf8'),code=readFileSync('assets/map-maker-detail.js','utf8');
 assert.match(html,/<aside id="focused-race-panel"[^>]*hidden>/);assert.doesNotMatch(html,/<dialog id="focused-race-panel"/);
 assert.doesNotMatch(code,/showModal\(/);assert.match(code,/\$\('maker-map'\)\.hidden=true/);
 assert.match(code,/\$\('maker-map'\)\.hidden=false/);assert.match(code,/maker-detail-open/);
 assert.match(code,/FEANight.fitRenderedGeometry\(d3.geoAlbersUsa\(\)/);assert.doesNotMatch(code,/geoIdentity\(/);
 assert.match(code,/FEAResultsUI.comparisonColumn/);assert.doesNotMatch(html,/data-detail-tab="trends"/);
 assert.match(readFileSync('assets/election-night.js','utf8'),/GOVERNOR_NOT_UP_BY_PARTY = \{ D: 6, R: 8 \}/);
});


test('Inspect mode opens detail without painting and disabling detail restores painting',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync('assets/map-maker.js','utf8');
 const functions=['inspectRace','setInspect','paint'].map(name=>source.split('\n').find(line=>line.trim().startsWith('function '+name+'('))).join('\n');
 const nodes=Object.fromEntries(['maker-race','board-menu','maker-menu-button','maker-detail-enabled','maker-drag'].map(id=>[id,{checked:true,setAttribute(){}}]));
 const buttons=['paint','inspect'].map(value=>({dataset:{makerInteraction:value},setAttribute(key,value){this[key]=value;}}));
 let opened=0,painted=0;const context={inspecting:false,selected:'',brush:'Safe Republican',$:id=>nodes[id],document:{querySelectorAll:()=>buttons},detail:{open(){opened++;}},model:{apply(){painted++;return true;}},edited(){},title:r=>r.id,status(){}};
 runInNewContext(functions,context);
 context.setInspect(true);context.paint({id:'senate-OH'});
 assert.equal(opened,1);assert.equal(painted,0);assert.equal(nodes['maker-drag'].disabled,true);assert.equal(buttons[1]['aria-pressed'],'true');
 context.setInspect(false);context.paint({id:'senate-OH'});assert.equal(painted,1);assert.equal(nodes['maker-drag'].disabled,false);
 nodes['maker-detail-enabled'].checked=false;context.setInspect(true);context.paint({id:'senate-OH'});assert.equal(painted,2);assert.equal(opened,1);
 assert.match(source,/isPaintEnabled:\(\)=>!inspecting&&/);assert.doesNotMatch(source,/lastTouch|pointerType!==.touch/);
});
