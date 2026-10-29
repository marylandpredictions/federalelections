import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), N=require('../../assets/night-awareness.js'), T=require('../../assets/desk-theme.js'), topo=require('topojson-client');
const manifest=JSON.parse(readFileSync('data/results/map-assets.json'));
const readMap=file=>JSON.parse(gunzipSync(readFileSync(file)));
const source=readFileSync('assets/election-night.js','utf8');
test('Label anchors use the largest visible polygon, ignore winding and outlying islands',()=>{
  const ring=[[0,0],[10,0],[10,10],[0,10],[0,0]], island=[[100,100],[101,100],[101,101],[100,100]];
  for(const main of [ring,[...ring].reverse()]){
    assert.deepEqual(N.projectedAnchor({geometry:{type:'MultiPolygon',coordinates:[[main],[island]]}},p=>p),[5,5]);
  }
  assert.equal(N.projectedAnchor({geometry:{type:'Polygon',coordinates:[ring]}},()=>null),null);
  const states=readMap(manifest.states).features;
  const virginia=states.find(f=>String(f.id)==='51');
  const p=N.projectedAnchor(virginia,p=>p);
  assert.ok(p[0]>-84 && p[0]<-75 && p[1]>36 && p[1]<40);
});
test('Municipal maps preserve official GEOIDs and include all six New England states',()=>{
  assert.deepEqual(Object.values(manifest.municipalities).map(r=>r.state).sort(),['CT','MA','ME','NH','RI','VT']);
  for(const [fips,entry] of Object.entries(manifest.municipalities)){
    const data=readMap(entry.path);
    assert.equal(data.features.length,entry.count);
    assert.match(entry.source,/^https:\/\/www2\.census\.gov\/geo\/tiger\/GENZ2025\//);
    assert.equal(new Set(data.features.map(f=>f.id)).size,entry.count);
    for(const f of data.features){assert.match(f.id,new RegExp('^'+fips+'\\d{8}$'));assert.equal(f.properties.localType,'municipality');assert.ok(N.projectedAnchor(f,p=>p));}
  }
  assert.equal(manifest.municipalities['25'].count,351);
  assert.equal(N.parseView('?county=2502507000').county,'2502507000');
});
test('Town results cannot inherit same-named county totals or ambiguous town names',()=>{
  const a=source.indexOf('function cleanCountyName('),b=source.indexOf('function stateFipsForElectionNight(',a),context={};
  vm.runInNewContext(source.slice(a,b)+';this.lookup=countyLookupForElectionNight;this.find=countyForFeature;',context);
  const feature={id:'2500108540',properties:{NAME:'Bristol',localType:'municipality'}};
  assert.equal(context.find(feature,context.lookup({counties:[{name:'Bristol',type:'County',fips:'25001'}]})),null);
  const city={name:'Bristol town',type:'Town',candidates:[]};
  assert.equal(context.find(feature,context.lookup({counties:[city]})),city);
  assert.equal(context.find({...feature,properties:{...feature.properties,NAME:'Bristol Town'}},context.lookup({counties:[city]})),city);
  assert.equal(context.find(feature,context.lookup({counties:[city,{...city}]})),null);
  const exact={...city,fips:feature.id};
  assert.equal(context.find(feature,context.lookup({counties:[exact,{...city}]})),exact);
});
test('National House display stays under 500 KB and retains all 435 districts with usable polygon area',()=>{
  assert.ok(readFileSync(manifest.house).length<500000);
  const data=readMap(manifest.house),features=topo.feature(data,data.objects.districts).features;
  // The source additionally includes DC's nonvoting district as context.
  const voting=features.filter(f=>!f.properties.id.startsWith('DC-'));
  assert.equal(voting.length,435);assert.equal(new Set(voting.map(f=>f.properties.id)).size,435);
  for(const feature of features) assert.ok(N.projectedAnchor(feature,p=>p),feature.properties.id);
});
test('Desktop automatic map fitting shrinks into free space rather than shifting geography offscreen',()=>{
  const a=source.indexOf('  transformWithPanelClearance('),b=source.indexOf('  currentTransform()',a);
  for(const right of [false,true]){
    const panel={hidden:false,classList:{contains:()=>false},getBoundingClientRect:()=>({left:right?892:18,right:right?1262:388,top:332,bottom:702,width:370,height:370})};
    const context={document:{getElementById:()=>panel,querySelector:s=>({getBoundingClientRect:()=>s==='.board-top-controls'?{bottom:160}:{top:642}})},d3:{zoomIdentity:{translate:(x,y)=>({scale:k=>({x,y,k})})}}};
    vm.runInNewContext(`this.Page=class {${source.slice(a,b)}}`,context);
    const page=new context.Page();page.svg={node:()=>({viewBox:{baseVal:{width:1280,height:720}},getBoundingClientRect:()=>({left:0,top:0,right:1280,bottom:720,width:1280,height:720})})};
    const t=page.transformWithPanelClearance({x:0,y:0,k:1},{x0:34,y0:34,x1:1246,y1:686});
    assert.ok(34*t.k+t.y>=172-1e-5);assert.ok(686*t.k+t.y<=630+1e-5);
    assert.ok(34*t.k+t.x>=24-1e-5);assert.ok(1246*t.k+t.x<=1256+1e-5);
  }
});
test('NYT and NBC presets retain readable primary, secondary and muted text on their actual surfaces',()=>{
  for(const id of ['nyt-results','nbc-big-board']){
    const theme=T.presets.find(t=>t.id===id);assert.ok(theme);
    const {tokens}=T.resolve(theme);
    for(const fg of ['text-primary','text-secondary','text-muted']) for(const bg of ['panel-bg','panel-raised','tooltip-bg','control-bg'])assert.ok(T.contrast(tokens[fg],tokens[bg])>=4.5,`${id}: ${fg} on ${bg}`);
  }
});
