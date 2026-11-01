import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{read}=require('../../assets/yapms-import.js'),{Scenario,validate}=require('../../assets/scenario-model.js'),{unitId}=require('../../assets/map-maker-detail.js');
const catalogue=JSON.parse(readFileSync('data/features/map-maker-races.json')).races;
const fixture=office=>JSON.parse(readFileSync(`tests/fixtures/yapms/${office}-2026.json`));
for(const [office,n] of [['house',435],['senate',35],['governor',36]])test(`Real YAPms ${office} 2026 download imports every contest`,()=>{
 const value=fixture(office),imported=read(value,catalogue);assert.equal(imported.office,office);assert.equal(imported.entries.length,n);assert.equal(new Set(imported.entries.map(([id])=>id)).size,n);
 assert.ok(imported.entries.every(([id])=>catalogue.some(r=>r.id===id&&r.type===office)));
});
test('YAPms strengths, special seats, at-large IDs, ties and office isolation',()=>{
 const value=fixture('senate');
 for(const [i,id] of ['AL','AK','AR','CO'].entries())value.regions.find(r=>r.id===id).candidates=[{id:'0',count:1,margin:i}];
 value.regions.find(r=>r.id==='FL-S').candidates=[{id:'1',count:1,margin:2}];
 value.regions.find(r=>r.id==='OH-S').candidates=[{id:'0',count:1,margin:0},{id:'1',count:1,margin:0}];
 const imported=read(value,catalogue),ratings=Object.fromEntries(imported.entries);
 assert.deepEqual(['AL','AK','AR','CO'].map(s=>ratings['senate-'+s]),['Safe Democratic','Likely Democratic','Lean Democratic','Tilt Democratic']);assert.equal(ratings['senate-FL'],'Lean Republican');assert.equal(ratings['senate-OH'],'Tossup');assert.equal(imported.notes.length,1);
 const model=new Scenario(catalogue);model.apply([['house-CO-4','Safe Independent'],['house-CO-4@08073','Tilt Republican']]);model.apply(imported.entries);assert.equal(model.rating('house-CO-4'),'Safe Independent');assert.equal(model.rating('house-CO-4@08073'),'Tilt Republican');model.undo();assert.equal(model.rating('senate-AL'),'Tossup');
});
test('Custom YAPms names require explicit party mapping; colors never guess identity',()=>{
 const value=fixture('governor');value.candidates[0].name='My custom candidate';value.regions.find(r=>r.id==='CO').candidates=[{id:'0',count:1,margin:1}];
 assert.deepEqual(read(value,catalogue).unknown,[{id:'0',name:'My custom candidate'}]);assert.equal(Object.fromEntries(read(value,catalogue,{'0':'I'}).entries)['governor-CO'],'Likely Independent');
});
test('Wrong cycles, results maps, partial/duplicate races and malformed allocations fail atomically',()=>{
 for(const mutate of [x=>x.map.year='2024310',x=>x.map.type='presidential',x=>x.map.country='fra',x=>x.map.variant='results',x=>x.regions.splice(x.regions.findIndex(r=>r.id==='AL'),1),x=>x.regions.push(x.regions.find(r=>r.id==='AL')),x=>x.regions.find(r=>r.id==='AL').disabled=true,x=>x.regions.find(r=>r.id==='AL').candidates=[{id:'mystery',count:1,margin:0}],x=>x.regions.find(r=>r.id==='AL').candidates=[{id:'0',count:-1,margin:0}],x=>x.regions.find(r=>r.id==='AL').candidates=[{id:'0',count:1,margin:99}]]){const value=fixture('senate');mutate(value);assert.throws(()=>read(value,catalogue));}
 const house=fixture('house');house.map.year='2026153';assert.throws(()=>read(house,catalogue)); // TN- alias is revision-specific.
});
test('County ratings save, restore and undo separately; cross-state and malformed unit IDs fail',()=>{
 const model=new Scenario(catalogue),id='house-CO-4@08073';model.apply([[id,'Safe Republican']]);assert.equal(model.rating('house-CO-4'),'Tossup');assert.equal(model.counts('house').T,435);
 assert.equal(validate(JSON.parse(JSON.stringify(model.state)),catalogue).countyRatings[id],'Safe Republican');model.undo();assert.equal(model.rating(id),'Tossup');model.redo();assert.equal(model.rating(id),'Safe Republican');
 const legacy={schemaVersion:1,office:'house',title:'Legacy',ratings:{}};assert.deepEqual(validate(legacy,catalogue).countyRatings,{});
 for(const bad of ['house-CO-4@48073','house-CO-4@__proto__','house-CO-4@08073@x','house-nope@08073'])assert.throws(()=>model.apply([[bad,'Safe Democratic']]));
});
test('District fragment GEOIDs never replace county FIPS; municipality identifiers remain distinct',()=>{
 assert.equal(unitId({properties:{GEOID:'0807304',countyFips:'08073'}}),'08073');assert.equal(unitId({properties:{STATEFP:'08',COUNTYFP:'073'}}),'08073');
 assert.equal(unitId({properties:{localType:'municipality',GEOID:'2500112345',countyFips:'25001'}}),'2500112345');
});
