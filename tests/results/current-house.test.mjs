import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {nationalProjection} from '../../scripts/results/nbc-provider.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
test('All 435 districts have verified 2026 geography; both boards use the same national source',()=>{
 const geo=read('data/results/district-geography.json'),map=read('data/house-districts-2026.geojson');
 assert.equal(map.features.length,435);assert.equal(Object.keys(geo.districts).length,435);assert.equal(geo.reviewRequiredStates.length,0);
 const svg=readFileSync('data/maps/house-2026.svg','utf8');assert.equal((svg.match(/<path /g)||[]).length,435);
 for(const f of map.features){const id=f.properties.id,g=geo.districts[id];assert.ok(g.currentComparable);assert.ok(svg.includes(`short-name="${id}"`));const detail=read(g.geometryFile);assert.ok(detail.features.length);assert.ok(detail.features.every(c=>c.properties.districtId===id&&/^\d{5}$/.test(c.properties.countyFips)));}
 assert.equal(geo.districts['MO-01'].congress,119);assert.equal(geo.districts['MO-01'].historicalComparable,true);assert.equal(geo.districts['TX-01'].congress,120);assert.equal(geo.districts['TX-01'].historicalComparable,false);
});
test('NBC projection contract requires explicit status and exactly one winner, supports explicit withdrawal, and never calls on a lead',()=>{
 const source={projection:{verified:true,contract:'nbc-firecracker-call-status-v1'}},candidates=[{name:'Jane Doe'},{name:'John Doe'}];
 const t={callStatusCode:'P',candidates:[{isWinner:true},{isWinner:false}]};
 assert.equal(nationalProjection(t,source,candidates).providerCall.candidate,'Jane Doe');
 assert.throws(()=>nationalProjection({...t,callStatusCode:''},source,candidates),/conflicts/);
 assert.throws(()=>nationalProjection({...t,candidates:[{isWinner:true},{isWinner:true}]},source,candidates),/exactly one/);
 const uncalled={callStatusCode:'C',candidates:[{isWinner:false},{isWinner:false}]};
 assert.deepEqual(nationalProjection(uncalled,source,candidates),{providerCallVerified:true,providerCall:null});
 assert.equal(nationalProjection({...uncalled,callStatusCode:'UNKNOWN'},source,candidates).providerCallVerified,false);
 assert.equal(nationalProjection(t,{projection:{verified:false}},candidates).providerCall,null);
});
