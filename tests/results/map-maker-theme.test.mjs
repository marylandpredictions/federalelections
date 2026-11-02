import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),M=require('../../assets/map-maker-theme.js'),T=require('../../assets/desk-theme.js');
test('YAPms distribution includes held seats exactly once and every scenario rating',()=>{
 const races=[{id:'a'},{id:'b'},{id:'c'}],ratings={a:'Lean Democratic',b:'Tilt Republican',c:'Tossup'},parts=M.segments(races,id=>ratings[id],{D:34,R:31,I:0});
 assert.equal(parts.reduce((n,p)=>n+p.count,0),68);assert.ok(Math.abs(parts.reduce((n,p)=>n+p.fraction,0)-1)<1e-12);
 assert.equal(parts.find(p=>p.label==='Safe Independent'),undefined);assert.equal(parts.find(p=>p.label==='Safe Democratic').count,34);
 const independent=M.segments([{id:'ind'}],()=> 'Safe Independent',{D:34,R:31,I:0});assert.equal(independent.find(p=>p.label==='Safe Independent').count,1);
 assert.equal(parts.at(-1).start+parts.at(-1).fraction,1);assert.equal(M.segments([],()=>'',{D:0,R:0,I:0}).length,0);
});
test('YAPms preset keeps reference shades, editable colors and saved layout identity',()=>{
 const preset=T.presets.find(t=>t.id==='yapms-map');assert.equal(preset.presentation,'yapms');assert.deepEqual(T.resolve(preset).warnings,[]);
 T.apply(preset);assert.equal(M.color(T,'Tossup','#000000'),'#a8a8a8');assert.equal(M.color(T,'Safe Democratic','#000000'),'#2c54bc');assert.equal(M.color(T,'Lean Republican','#000000'),'#dd7a78');
 const saved=T.validate({...preset,id:'saved-map',partyColors:{...preset.partyColors,D:'#123456'}});assert.equal(saved.presentation,'yapms');T.apply(saved);assert.equal(M.color(T,'Safe Democratic','#000000'),'#123456');
 T.apply(T.presets[0]);assert.equal(M.color(T,'Likely Democratic','#123456'),T.mix(T.candidateColor({party:'D'}),'#123456',.2));
});
