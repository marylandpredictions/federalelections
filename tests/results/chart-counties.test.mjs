import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {dissolveCounty} from '../../scripts/results/county-geometry.mjs';
const require=createRequire(import.meta.url),N=require('../../assets/night-awareness.js');
test('Margin domains always center on even, including one-party leads and absent measurements',()=>{
  for(const [input,expected] of [[[3,7],[-7,7]],[[-9,-2],[-9,9]],[[-4,6],[-6,6]],[[0,null,NaN],[-1,1]],[[.05,-.2],[-1,1]]])assert.deepEqual(N.marginDomain(input),expected);
});
test('County dissolve removes shared district seams while preserving islands, holes and identity',()=>{
  const square=(a,b)=>[[a,0],[b,0],[b,1],[a,1],[a,0]];
  const hole=[[.2,.2],[.2,.4],[.4,.4],[.4,.2],[.2,.2]];
  const f={type:'Feature',id:'test',properties:{NAME:'Example'},geometry:{type:'MultiPolygon',coordinates:[[square(0,1),hole],[square(1,2)],[square(5,6)]]}};
  const unchanged=structuredClone(f),merged=dissolveCounty(f);
  assert.equal(merged.id,f.id);assert.deepEqual(merged.properties,f.properties);
  assert.equal(merged.geometry.coordinates.length,2);
  assert.equal(merged.geometry.coordinates.reduce((n,p)=>n+p.length,0),3);
  assert.deepEqual(f,unchanged);
  const rings=merged.geometry.coordinates.flat();
  assert.equal(rings.filter(r=>r.every(p=>Math.abs(p[0]-1)<1e-5)).length,0);
});
test('Published statewide Texas geometry has a complete Dallas outline with no six-piece House subdivision',()=>{
  const manifest=JSON.parse(readFileSync('data/results/map-assets.json'));
  const texas=JSON.parse(gunzipSync(readFileSync(manifest.counties['48'])));
  assert.equal(texas.features.length,254);
  assert.equal(new Set(texas.features.map(f=>f.properties.GEOID)).size,254);
  const dallas=texas.features.find(f=>f.properties.GEOID==='48113');
  assert.equal(dallas.geometry.coordinates.length,1);
  assert.equal(dallas.geometry.coordinates[0].length,1);
  assert.match(manifest.countyGeometry,/dissolved/);
  for(const [state,id] of [['13','13121'],['17','17031'],['42','42003']]){
    const collection=JSON.parse(gunzipSync(readFileSync(manifest.counties[state])));
    assert.equal(collection.features.find(f=>f.properties.GEOID===id).geometry.coordinates.length,1,id);
  }
});
