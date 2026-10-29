// Official Census display boundaries for New England municipal reporting.
// Run: node scripts/results/build-local-maps.mjs (downloads six public ZIPs).
import {readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const states = {CT:'09',ME:'23',MA:'25',NH:'33',RI:'44',VT:'50'};
function records(buffer) {
  const count=buffer.readUInt32LE(4), header=buffer.readUInt16LE(8), length=buffer.readUInt16LE(10), fields=[];
  for(let p=32;p<header-1;p+=32) fields.push({name:buffer.subarray(p,p+11).toString().replace(/\0.*$/,''),length:buffer[p+16]});
  return Array.from({length:count},(_,i)=>{
    let p=header+i*length+1; const row={};
    for(const field of fields){row[field.name]=buffer.subarray(p,p+field.length).toString('utf8').trim();p+=field.length;}return row;
  });
}
const area = ring => ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2;
function inside(point,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function shapes(buffer) {
  const out=[];
  for(let p=100;p<buffer.length;){
    const length=buffer.readInt32BE(p+4)*2, start=p+8, type=buffer.readInt32LE(start);p+=8+length;
    if(!type){out.push(null);continue;} if(![5,15].includes(type))throw Error('Expected polygon shapefile');
    const count=buffer.readInt32LE(start+36), n=buffer.readInt32LE(start+40), offsets=[];
    for(let i=0;i<count;i++)offsets.push(buffer.readInt32LE(start+44+i*4));
    offsets.push(n);const rings=[];
    for(let i=0;i<count;i++){
      const ring=[];
      for(let j=offsets[i];j<offsets[i+1];j++){const q=start+44+count*4+j*16;ring.push([+buffer.readDoubleLE(q).toFixed(4),+buffer.readDoubleLE(q+8).toFixed(4)]);}
      if(ring.length>=4)rings.push(ring);
    }
    // Shapefile exteriors are clockwise; holes counter-clockwise. Keep holes.
    const polygons=rings.filter(r=>area(r)<0).map(r=>[r.slice().reverse()]);
    for(const hole of rings.filter(r=>area(r)>=0)){
      const parent=polygons.filter(p=>inside(hole[0],p[0])).sort((a,b)=>Math.abs(area(a[0]))-Math.abs(area(b[0])))[0];
      if(parent)parent.push(hole.slice().reverse());
    }
    out.push({type:'MultiPolygon',coordinates:polygons});
  }return out;
}
const directory=mkdtempSync(join(tmpdir(),'fea-local-maps-'));
const files=await Promise.all(Object.entries(states).map(async([state,fips])=>{
  const name=`cb_2025_${fips}_cousub_500k`,url=`https://www2.census.gov/geo/tiger/GENZ2025/shp/${name}.zip`;
  const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);
  const dir=join(directory,state);mkdirSync(dir);const zip=join(dir,'source.zip');writeFileSync(zip,Buffer.from(await response.arrayBuffer()));
  execFileSync('tar',['-xf',zip,'-C',dir]);
  const names=readdirSync(dir),dbf=records(readFileSync(join(dir,names.find(n=>n.endsWith('.dbf'))))),geo=shapes(readFileSync(join(dir,names.find(n=>n.endsWith('.shp')))));
  if(dbf.length!==geo.length)throw Error('Boundary record mismatch');
  const features=dbf.flatMap((r,i)=>geo[i]?.coordinates.length&&r.COUSUBFP!=='00000'?[{type:'Feature',id:r.GEOID,properties:{GEOID:r.GEOID,STATEFP:r.STATEFP,COUNTYFP:r.COUNTYFP,NAME:r.NAME,NAMELSAD:r.NAMELSAD,localType:'municipality'},geometry:geo[i]}]:[]);
  if(!features.length||features.some(f=>!/^\d{10}$/.test(f.id)))throw Error('Invalid municipal boundaries');
  const collection={type:'FeatureCollection',source:url,vintage:2025,features},text=JSON.stringify(collection),hash=createHash('sha256').update(text).digest('hex').slice(0,12),path=`data/results/maps/municipalities-${fips}.${hash}.json.gz`;
  writeFileSync(resolve(path),gzipSync(text,{level:9}));
  return [fips,{path,state,count:features.length,source:url,vintage:2025}];
}));
const path='data/results/map-assets.json',manifest=JSON.parse(readFileSync(path));
manifest.municipalities=Object.fromEntries(files);writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.municipalities,null,2));
