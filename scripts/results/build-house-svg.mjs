// Use the same verified 2026 geography as Results, not a separately dated SVG.
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';import {feature} from 'topojson-client';
const require=createRequire(import.meta.url),d3=require('../../.runtime/d3.cjs');
const manifest=JSON.parse(readFileSync('data/results/map-assets.json','utf8'));
const topo=JSON.parse(gunzipSync(readFileSync(manifest.house)));
const geo=feature(topo,topo.objects.districts);
// D3 spherical polygons expect clockwise exteriors; GeoJSON uses the opposite.
for(const f of geo.features){
 const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
 for(const p of polygons)for(const [i,ring] of p.entries()){
  const area=ring.reduce((n,a,j)=>{const b=ring[(j+1)%ring.length];return n+a[0]*b[1]-b[0]*a[1];},0);
  if(i===0?area>0:area<0)ring.reverse();
 }
}
const projection=d3.geoAlbersUsa().fitExtent([[8,8],[792,493]],geo),path=d3.geoPath(projection);
const paths=geo.features.map(f=>{const id=f.properties.id,d=path(f),b=path.bounds(f);if(!d||b[1][0]-b[0][0]>400||b[1][1]-b[0][1]>430)throw Error(`Unprojectable or incorrectly wound ${id}`);return `<path region="${id}" short-name="${id}" long-name="${id}" d="${d}"/>`;});
if(paths.length!==435)throw Error('Incomplete House SVG');
writeFileSync('data/maps/house-2026.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 501"><g map-type="regions">${paths.join('')}</g></svg>\n`);
