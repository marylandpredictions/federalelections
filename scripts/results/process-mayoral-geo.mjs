import {readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const outDir = 'data/features/map-maker/cities';
const metaPath = 'data/features/map-maker/cities-2027.json';
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));

const KIND = {
  'mayor-chicago': 'wards',
  'mayor-houston': 'council',
  'mayor-philadelphia': 'council',
  'mayor-dallas': 'council',
  'mayor-denver': 'council',
  'mayor-nashville': 'council',
  'mayor-memphis': 'council',
  'mayor-jacksonville': 'council',
  'mayor-columbus': 'council',
  'mayor-indianapolis': 'council',
  'mayor-fortworth': 'council',
  'mayor-charlotte': 'council',
  'mayor-tucson': 'council',
  'mayor-kansascity': 'council',
  'mayor-coloradosprings': 'council',
  'mayor-tampa': 'council',
  'mayor-aurora': 'council',
  'mayor-sanantonio': 'council'
};

function pickId(props) {
  for (const key of ['unitId','DISTRICT','District','district','district_num','DISTRICT_NUM','COUNCIL','WARD','ward','NAME','Name','SHORTNAME']) {
    if (props[key] != null && String(props[key]).trim() !== '') return String(props[key]);
  }
  for (const [key, value] of Object.entries(props)) {
    if (/district|ward|council/i.test(key) && value != null && String(value).trim() !== '') return String(value);
  }
  return null;
}

function normalizeCollection(collection, kind) {
  return {
    type: 'FeatureCollection',
    features: (collection.features || []).filter((f) => f.geometry).map((f, i) => {
      const raw = pickId(f.properties || {}) || String(i + 1);
      const num = String(raw).replace(/\D+/g, '') || String(i + 1);
      const prefix = kind === 'wards' ? 'ward' : 'district';
      return {
        type: 'Feature',
        properties: {
          unitId: `${prefix}-${num.padStart(2, '0')}`,
          name: kind === 'wards' ? `Ward ${num}` : `District ${num}`,
          kind
        },
        geometry: f.geometry
      };
    })
  };
}

function toOutlineFeatureCollection(raw, name) {
  let geometry = null;
  if (raw.type === 'FeatureCollection' && raw.features?.[0]) geometry = raw.features[0].geometry || raw;
  else if (raw.type === 'Feature') geometry = raw.geometry;
  else if (raw.type === 'GeometryCollection' || raw.type === 'Polygon' || raw.type === 'MultiPolygon') geometry = raw;
  if (!geometry) throw new Error('no geometry');
  if (geometry.type === 'GeometryCollection') {
    const coords = [];
    for (const g of geometry.geometries || []) {
      if (g.type === 'Polygon') coords.push(g.coordinates);
      else if (g.type === 'MultiPolygon') coords.push(...g.coordinates);
    }
    geometry = {type: 'MultiPolygon', coordinates: coords};
  }
  if (geometry.type === 'FeatureCollection') throw new Error('nested fc');
  return {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {name, unitId: 'city'}, geometry}]
  };
}

function runMapshaper(args) {
  return spawnSync('npx', ['--yes', 'mapshaper', ...args], {encoding: 'utf8', shell: true});
}

function processCity(id, inputPath) {
  const slug = id.replace(/^mayor-/, '');
  const kind = KIND[id] || 'council';
  const raw = JSON.parse(readFileSync(inputPath, 'utf8'));
  const normalized = normalizeCollection(raw, kind);
  if (!normalized.features.length) throw new Error('no features');
  const rawOut = join(outDir, `${slug}-raw.geojson`);
  const subPath = join(outDir, `${slug}-subdivisions.geojson`);
  const outlinePath = join(outDir, `${slug}-outline.geojson`);
  writeFileSync(rawOut, JSON.stringify(normalized));
  let sub = runMapshaper([rawOut, '-simplify', '12%', 'keep-shapes', '-o', 'format=geojson', 'precision=0.0001', subPath]);
  if (sub.status !== 0) writeFileSync(subPath, JSON.stringify(normalized));
  const dissolve = runMapshaper([subPath, '-dissolve', '-o', 'format=geojson', 'precision=0.0001', outlinePath]);
  if (dissolve.status !== 0) {
    writeFileSync(outlinePath, JSON.stringify(toOutlineFeatureCollection({
      type: 'GeometryCollection',
      geometries: normalized.features.map((f) => f.geometry)
    }, slug)));
  } else {
    const outlineRaw = JSON.parse(readFileSync(outlinePath, 'utf8'));
    writeFileSync(outlinePath, JSON.stringify(toOutlineFeatureCollection(outlineRaw, slug)));
  }
  return JSON.parse(readFileSync(subPath, 'utf8')).features.length;
}

// Seed from successful try downloads / existing raw
const seeds = {
  'mayor-philadelphia': join(outDir, '_try-philly2.geojson'),
  'mayor-sanantonio': join(outDir, '_try-sanantonio.geojson')
};

for (const city of meta.cities) {
  const slug = city.id.replace(/^mayor-/, '');
  const subPath = join(outDir, `${slug}-subdivisions.geojson`);
  const outlinePath = join(outDir, `${slug}-outline.geojson`);
  try {
    if (seeds[city.id] && existsSync(seeds[city.id])) {
      const n = processCity(city.id, seeds[city.id]);
      console.log('processed seed', city.id, n);
    } else if (existsSync(join(outDir, `${slug}-raw.geojson`)) && (!existsSync(outlinePath) || JSON.parse(readFileSync(outlinePath, 'utf8')).type !== 'FeatureCollection')) {
      const n = processCity(city.id, join(outDir, `${slug}-raw.geojson`));
      console.log('reprocessed', city.id, n);
    } else if (existsSync(subPath) && existsSync(outlinePath)) {
      // ensure outline is FeatureCollection
      const outline = JSON.parse(readFileSync(outlinePath, 'utf8'));
      if (outline.type !== 'FeatureCollection' || !outline.features?.[0]?.geometry) {
        writeFileSync(outlinePath, JSON.stringify(toOutlineFeatureCollection(outline, slug)));
      }
      console.log('keep', city.id, JSON.parse(readFileSync(subPath, 'utf8')).features.length);
    } else {
      console.log('missing', city.id);
      continue;
    }
    const kind = KIND[city.id] || 'council';
    city.subdivisionKind = kind;
    city.detailMode = kind === 'wards' ? 'wards' : 'council';
    city.subdivisionUrl = `/data/features/map-maker/cities/${slug}-subdivisions.geojson`;
    city.outlineUrl = `/data/features/map-maker/cities/${slug}-outline.geojson`;
    city.placeName = city.name;
  } catch (err) {
    console.error('fail', city.id, err.message || err);
  }
}

writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
const ready = meta.cities.filter((c) => c.outlineUrl).length;
console.log('ready', ready, '/', meta.cities.length);
