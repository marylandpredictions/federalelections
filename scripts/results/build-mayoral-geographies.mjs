import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const outDir = 'data/features/map-maker/cities';
mkdirSync(outDir, {recursive: true});

const q = (base) => `${base}${base.includes('?') ? '&' : '?'}where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;

/** ArcGIS / open-data GeoJSON endpoints for council (or ward) polygons. */
const SOURCES = {
  'mayor-chicago': {
    kind: 'wards',
    local: 'data/features/chicago-wards-2023.geojson',
    idFields: ['ward', 'WARD', 'ward_id']
  },
  'mayor-houston': {
    kind: 'council',
    url: q('https://www.gis.hctx.net/arcgis/rest/services/CoH/CoH_Boundaries/MapServer/0/query'),
    idFields: ['DISTRICT', 'District', 'NAME']
  },
  'mayor-philadelphia': {
    kind: 'council',
    url: 'https://opendata.arcgis.com/datasets/philadelphia::city-council-districts-2024.geojson',
    idFields: ['DISTRICT', 'District', 'DISTRICT_']
  },
  'mayor-dallas': {
    kind: 'council',
    url: q('https://gis.dallascityhall.com/arcgis/rest/services/Basemap/CouncilAreas/MapServer/0/query'),
    idFields: ['DISTRICT', 'District', 'NAME']
  },
  'mayor-denver': {
    kind: 'council',
    url: q('https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_ADMN_COUNCILDISTRICT_A/FeatureServer/0/query'),
    idFields: ['DISTRICT', 'DISTRICT_ID', 'Council_District']
  },
  'mayor-nashville': {
    kind: 'council',
    url: q('https://maps.nashville.gov/arcgis/rest/services/Cadastral/Boundary/MapServer/7/query'),
    idFields: ['DISTRICT', 'DISTNO', 'COUNCIL_DISTRICT']
  },
  'mayor-memphis': {
    kind: 'council',
    url: q('https://gis.memphistn.gov/server/rest/services/OpenData/City_Council_Districts/MapServer/0/query'),
    idFields: ['DISTRICT', 'District', 'DIST']
  },
  'mayor-jacksonville': {
    kind: 'council',
    url: q('https://maps.coj.net/coj/rest/services/msmp/CouncilDistrict/MapServer/0/query'),
    idFields: ['DISTRICT', 'District', 'COUNCILDIST']
  },
  'mayor-columbus': {
    kind: 'council',
    url: q('https://gis.columbus.gov/arcgis/rest/services/Applications/CSIR_Public/MapServer/37/query'),
    idFields: ['SHORTNAME', 'DISTRICT', 'NAME']
  },
  'mayor-indianapolis': {
    kind: 'council',
    url: q('https://gis.indy.gov/server/rest/services/OpenData/OpenData_Political/MapServer/1/query'),
    idFields: ['COUNCIL', 'DISTRICT', 'NAME']
  },
  'mayor-fortworth': {
    kind: 'council',
    url: q('https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/Upcoming_Board_Commission/MapServer/16/query'),
    idFields: ['DISTRICT', 'NAME', 'District']
  },
  'mayor-charlotte': {
    kind: 'council',
    url: q('https://gis.charlottenc.gov/arcgis/rest/services/PLN/CouncilDistricts/MapServer/0/query'),
    idFields: ['District', 'DISTRICT']
  },
  'mayor-tucson': {
    kind: 'council',
    url: q('https://maps.tucsonaz.gov/arcgis/rest/services/OpenData/OpenData_Boundaries/MapServer/3/query'),
    idFields: ['WARD', 'DISTRICT', 'NAME']
  },
  'mayor-kansascity': {
    kind: 'council',
    url: q('https://gismaps.kcmo.org/kcgis/rest/services/OpenData/OpenData_Administrative/MapServer/3/query'),
    idFields: ['DISTRICT', 'District', 'COUNCILDISTRICT']
  },
  'mayor-coloradosprings': {
    kind: 'council',
    url: q('https://gis.coloradosprings.gov/arcgis/rest/services/OpenData/OpenData_CityCouncil/FeatureServer/0/query'),
    idFields: ['DISTRICT', 'District', 'COUNCIL_DISTRICT']
  },
  'mayor-tampa': {
    kind: 'council',
    url: q('https://arcgis.tampagov.net/arcgis/rest/services/ElectionAdministration/CityCouncilDistrict/FeatureServer/0/query'),
    idFields: ['DISTRICT', 'District', 'NAME']
  },
  'mayor-aurora': {
    kind: 'council',
    url: q('https://gis.auroragov.org/arcgis/rest/services/OpenData/OpenData_Boundaries/MapServer/1/query'),
    idFields: ['DISTRICT', 'WARD', 'NAME']
  },
  'mayor-sanantonio': {
    kind: 'council',
    url: q('https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/CouncilDistricts/FeatureServer/0/query'),
    idFields: ['DISTRICT', 'District', 'NAME']
  }
};

function unitPrefix(kind) {
  return kind === 'wards' ? 'ward' : 'district';
}

function pickId(props, fields) {
  for (const key of fields) {
    if (props[key] != null && String(props[key]).trim() !== '') return String(props[key]);
  }
  for (const [key, value] of Object.entries(props)) {
    if (/district|ward|council/i.test(key) && value != null && String(value).trim() !== '') return String(value);
  }
  return null;
}

function normalizeFeature(feature, kind, fields, index) {
  const raw = pickId(feature.properties || {}, fields) || String(index + 1);
  const num = String(raw).replace(/\D+/g, '') || String(index + 1);
  const id = `${unitPrefix(kind)}-${num.padStart(2, '0')}`;
  return {
    type: 'Feature',
    properties: {
      unitId: id,
      name: kind === 'wards' ? `Ward ${num}` : `District ${num}`,
      kind
    },
    geometry: feature.geometry
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {Accept: 'application/json, application/geo+json, */*'},
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function simplify(inputPath, outputPath) {
  const result = spawnSync(
    'npx',
    ['--yes', 'mapshaper', inputPath, '-simplify', '12%', 'keep-shapes', '-o', 'format=geojson', 'precision=0.0001', outputPath],
    {encoding: 'utf8', shell: true}
  );
  if (result.status !== 0) {
    console.warn(result.stderr || result.stdout);
    writeFileSync(outputPath, readFileSync(inputPath));
  }
}

function dissolveOutline(subPath, outlinePath) {
  const result = spawnSync(
    'npx',
    ['--yes', 'mapshaper', subPath, '-dissolve', '-o', 'format=geojson', 'precision=0.0001', outlinePath],
    {encoding: 'utf8', shell: true}
  );
  if (result.status !== 0) {
    const fc = JSON.parse(readFileSync(subPath, 'utf8'));
    writeFileSync(outlinePath, JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {name: 'city'},
        geometry: {type: 'GeometryCollection', geometries: fc.features.map((f) => f.geometry).filter(Boolean)}
      }]
    }));
  } else {
    const outline = JSON.parse(readFileSync(outlinePath, 'utf8'));
    if (!outline.features?.length) throw new Error('empty outline');
    outline.features[0].properties = {name: 'city', ...(outline.features[0].properties || {})};
    writeFileSync(outlinePath, JSON.stringify(outline));
  }
}

const citiesMeta = JSON.parse(readFileSync('data/features/map-maker/cities-2027.json', 'utf8'));
const results = [];

for (const city of citiesMeta.cities) {
  const source = SOURCES[city.id];
  if (!source) {
    console.warn('No source for', city.id);
    continue;
  }
  const slug = city.id.replace(/^mayor-/, '');
  const rawPath = join(outDir, `${slug}-raw.geojson`);
  const subPath = join(outDir, `${slug}-subdivisions.geojson`);
  const outlinePath = join(outDir, `${slug}-outline.geojson`);
  try {
    let collection;
    if (source.local) {
      collection = JSON.parse(readFileSync(source.local, 'utf8'));
    } else {
      console.log('Fetching', city.id);
      collection = await fetchJson(source.url);
      if (!collection.features?.length && collection.layers) throw new Error('not a feature collection');
    }
    if (!collection.features?.length) throw new Error('no features');
    const normalized = {
      type: 'FeatureCollection',
      features: collection.features
        .filter((f) => f.geometry)
        .map((f, i) => normalizeFeature(f, source.kind, source.idFields, i))
    };
    writeFileSync(rawPath, JSON.stringify(normalized));
    simplify(rawPath, subPath);
    dissolveOutline(subPath, outlinePath);
    const count = JSON.parse(readFileSync(subPath, 'utf8')).features.length;
    city.subdivisionKind = source.kind;
    city.detailMode = source.kind === 'wards' ? 'wards' : 'council';
    city.subdivisionUrl = `/data/features/map-maker/cities/${slug}-subdivisions.geojson`;
    city.outlineUrl = `/data/features/map-maker/cities/${slug}-outline.geojson`;
    city.placeName = city.name;
    results.push({id: city.id, ok: true, count, kind: source.kind});
    console.log('OK', city.id, count, source.kind);
  } catch (err) {
    results.push({id: city.id, ok: false, error: String(err.message || err)});
    console.error('FAIL', city.id, err.message || err);
  }
}

writeFileSync('data/features/map-maker/cities-2027.json', JSON.stringify(citiesMeta, null, 2) + '\n');
writeFileSync(join(outDir, 'build-report.json'), JSON.stringify({builtAt: new Date().toISOString(), results}, null, 2) + '\n');
console.log('Done', results.filter((r) => r.ok).length, '/', results.length);
