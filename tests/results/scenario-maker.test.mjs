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
