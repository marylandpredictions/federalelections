// Official Census display boundaries for Alaska state House reporting units.
// Run: node scripts/results/build-alaska-district-maps.mjs
import {readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const area = ring => ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2;
function inside(point,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function records(buffer) {
  const count=buffer.readUInt32LE(4), header=buffer.readUInt16LE(8), length=buffer.readUInt16LE(10), fields=[];
  for(let p=32;p<header-1;p+=32) fields.push({name:buffer.subarray(p,p+11).toString().replace(/\0.*$/,''),length:buffer[p+16]});
  return Array.from({length:count},(_,i)=>{
    let p=header+i*length+1; const row={};
    for(const field of fields){row[field.name]=buffer.subarray(p,p+field.length).toString('utf8').trim();p+=field.length;}return row;
  });
}
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
    const polygons=rings.filter(r=>area(r)<0).map(r=>[r.slice().reverse()]);
    for(const hole of rings.filter(r=>area(r)>=0)){
      const parent=polygons.filter(p=>inside(hole[0],p[0])).sort((a,b)=>Math.abs(area(a[0]))-Math.abs(area(b[0])))[0];
      if(parent)parent.push(hole.slice().reverse());
    }
    out.push({type:'MultiPolygon',coordinates:polygons});
  }return out;
}

const directory=mkdtempSync(join(tmpdir(),'fea-ak-sldl-'));
const name='cb_2025_02_sldl_500k';
const url=`https://www2.census.gov/geo/tiger/GENZ2025/shp/${name}.zip`;
const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);
const zip=join(directory,'source.zip');writeFileSync(zip,Buffer.from(await response.arrayBuffer()));
execFileSync('tar',['-xf',zip,'-C',directory]);
const names=readdirSync(directory),dbf=records(readFileSync(join(directory,names.find(n=>n.endsWith('.dbf'))))),geo=shapes(readFileSync(join(directory,names.find(n=>n.endsWith('.shp')))));
if(dbf.length!==geo.length)throw Error('Boundary record mismatch');
const features=dbf.flatMap((r,i)=>{
  if(!geo[i]?.coordinates.length||r.STATEFP!=='02')return [];
  const district=Number(r.SLDLST);
  if(!Number.isInteger(district)||district<1||district>40)return [];
  const id='AK-HD-'+String(district).padStart(2,'0');
  return [{type:'Feature',id,properties:{GEOID:r.GEOID,STATEFP:r.STATEFP,SLDLST:r.SLDLST,NAME:r.NAMELSAD||r.NAME||`State House District ${district}`,NAMELSAD:r.NAMELSAD||r.NAME,reportingUnitId:id,localType:'state-house-district'},geometry:geo[i]}];
});
if(features.length!==40||new Set(features.map(f=>f.id)).size!==40)throw Error('Expected exactly 40 Alaska state House districts');
mkdirSync(resolve('data/results/maps'),{recursive:true});
const collection={type:'FeatureCollection',source:url,vintage:2025,features},text=JSON.stringify(collection),hash=createHash('sha256').update(text).digest('hex').slice(0,12),path=`data/results/maps/legislative-districts-02.${hash}.json.gz`;
writeFileSync(resolve(path),gzipSync(text,{level:9}));
const manifestPath='data/results/map-assets.json',manifest=JSON.parse(readFileSync(manifestPath));
manifest.legislativeDistricts={...(manifest.legislativeDistricts||{}),'02':{path,state:'AK',count:40,source:url,vintage:2025,scheme:'nbc-alaska-state-house-districts'}};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.legislativeDistricts,null,2));
