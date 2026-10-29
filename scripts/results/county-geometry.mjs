import { topology } from 'topojson-server';
import { merge } from 'topojson-client';

// Census district-within-county pieces are not independent county outlines.
// Dissolve shared arcs offline; never do this work while rendering the map.
export function dissolveCounty(feature) {
  const geometry=feature.geometry;
  if(geometry?.type!=='MultiPolygon' || geometry.coordinates.length<2)return feature;
  const t=topology({pieces:{type:'GeometryCollection',geometries:geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates}))}},1e7);
  const merged=merge(t,t.objects.pieces.geometries);
  if(!merged.coordinates.length)throw Error(`County dissolve produced no geometry: ${feature.id}`);
  return {...feature,geometry:merged};
}
