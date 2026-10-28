import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('assets/election-night.js','utf8');
test('Map geometry uses the real short viewport and clears the measured header',()=>{
 const start=source.indexOf('  mapDimensions() {'),end=source.indexOf('  async refreshResults()',start);
 const context={document:{getElementById:()=>({getBoundingClientRect:()=>({width:844,height:320})}),querySelector:()=>({getBoundingClientRect:()=>({bottom:72})})}};
 vm.runInNewContext(`this.Geometry=class {${source.slice(start,end)}}`,context);
 const page=new context.Geometry(),size=page.mapDimensions(),extent=page.mapExtent(size.width,size.height);
 assert.equal(size.height,320);
 assert.equal(extent[0][1],84);
 assert.ok(extent[1][1]<=244);
});
test('Phone portrait and landscape fit the selected geography into space clear of panel and controls',()=>{
 const start=source.indexOf('  transformWithPanelClearance('),end=source.indexOf('  currentTransform()',start);
 for(const config of [{w:844,h:390,panel:{left:466,right:836,top:80,bottom:382,width:370,height:302},header:72,controls:326},{w:320,h:568,panel:{left:0,right:320,top:307,bottom:568,width:320,height:261},header:130,controls:247}]){
  const panel={hidden:false,classList:{contains:()=>false},getBoundingClientRect:()=>config.panel};
  const context={document:{getElementById:()=>panel,querySelector:s=>({getBoundingClientRect:()=>s==='.board-top-controls'?{bottom:config.header}:{top:config.controls}})},d3:{zoomIdentity:{translate:(x,y)=>({scale:k=>({x,y,k})})}}};
  vm.runInNewContext(`this.Geometry=class {${source.slice(start,end)}}`,context);
  const page=new context.Geometry();page.svg={node:()=>({viewBox:{baseVal:{width:config.w,height:config.h}},getBoundingClientRect:()=>({left:0,top:0,right:config.w,bottom:config.h,width:config.w,height:config.h})})};
  const bounds={x0:34,y0:34,x1:810,y1:356};const fitted=page.transformWithPanelClearance({x:0,y:0,k:1},bounds);
  assert.ok(bounds.x0*fitted.k+fitted.x>=16-1e-6);
  assert.ok(bounds.x1*fitted.k+fitted.x<=(config.w<=600?config.w-16:config.panel.left-16)+1e-6);
  assert.ok(bounds.y0*fitted.k+fitted.y>=config.header+12-1e-6);
  assert.ok(bounds.y1*fitted.k+fitted.y<=config.controls-12+1e-6);
 }
});
