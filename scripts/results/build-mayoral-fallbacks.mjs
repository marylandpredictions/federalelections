import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const outDir = 'data/features/map-maker/cities';
mkdirSync(outDir, {recursive: true});

const FALLBACKS = [
  {id: 'mayor-denver', slug: 'denver', state: '08', county: '031', nom: '_nom-denver.geojson'},
  {id: 'mayor-nashville', slug: 'nashville', state: '47', county: '037', nom: '_nom-nashville.geojson'},
  {id: 'mayor-memphis', slug: 'memphis', state: '47', county: '157', nom: '_nom-memphis.geojson'},
  {id: 'mayor-tucson', slug: 'tucson', state: '04', county: '019', nom: '_nom-tucson.geojson'},
  {id: 'mayor-kansascity', slug: 'kansascity', state: '29', county: '095', nom: '_nom-kansascity.geojson'},
  {id: 'mayor-coloradosprings', slug: 'coloradosprings', state: '08', county: '041', nom: '_nom-coloradosprings.geojson'},
  {id: 'mayor-aurora', slug: 'aurora', state: '08', county: '001', nom: '_nom-aurora.geojson'}
];

function mapshaper(args) {
  const result = spawnSync('npx', ['--yes', 'mapshaper', ...args], {encoding: 'utf8'});
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'mapshaper failed').slice(-500));
  }
  return result;
}

function toOutline(nomPath, name) {
  const nom = JSON.parse(readFileSync(join(outDir, nomPath), 'utf8'));
  const feature = nom.features?.[0];
  if (!feature?.geometry) throw new Error('missing nominatim geometry');
  return {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {name, unitId: 'city'}, geometry: feature.geometry}]
  };
}

async function ensureZip(state) {
  const zipPath = join(outDir, `_tl_2023_${state}_tract.zip`);
  if (existsSync(zipPath)) return zipPath;
  const url = `https://www2.census.gov/geo/tiger/TIGER2023/TRACT/tl_2023_${state}_tract.zip`;
  console.log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tract zip ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  return zipPath;
}

const meta = JSON.parse(readFileSync('data/features/map-maker/cities-2027.json', 'utf8'));

for (const city of FALLBACKS) {
  try {
    const outlinePath = join(outDir, `${city.slug}-outline.geojson`);
    writeFileSync(outlinePath, JSON.stringify(toOutline(city.nom, city.slug)));
    mapshaper([outlinePath, '-simplify', '15%', 'keep-shapes', '-o', 'force', outlinePath]);

    const zip = await ensureZip(city.state);
    const tractRaw = join(outDir, `${city.slug}-tracts-raw.geojson`);
    const clipped = join(outDir, `${city.slug}-subdivisions.geojson`);
    mapshaper([zip, '-filter', `COUNTYFP=='${city.county}'`, '-proj', 'wgs84', '-o', 'format=geojson', tractRaw]);
    try {
      mapshaper([
        tractRaw,
        '-clip', outlinePath,
        '-each', `unitId='tract-'+TRACTCE, name='Tract '+TRACTCE, kind='tract'`,
        '-simplify', '12%', 'keep-shapes',
        '-o', 'format=geojson', 'precision=0.0001', clipped
      ]);
    } catch {
      mapshaper([
        tractRaw,
        '-each', `unitId='tract-'+TRACTCE, name='Tract '+TRACTCE, kind='tract'`,
        '-simplify', '12%', 'keep-shapes',
        '-o', 'format=geojson', 'precision=0.0001', clipped
      ]);
    }
    const count = JSON.parse(readFileSync(clipped, 'utf8')).features.length;
    const row = meta.cities.find((c) => c.id === city.id);
    if (row) {
      row.subdivisionKind = 'tracts';
      row.detailMode = 'tracts';
      row.subdivisionUrl = `/data/features/map-maker/cities/${city.slug}-subdivisions.geojson`;
      row.outlineUrl = `/data/features/map-maker/cities/${city.slug}-outline.geojson`;
      row.placeName = row.name;
      row.subdivisionNote = 'Census tracts clipped to city limits (council-district open data unavailable).';
    }
    console.log('OK', city.id, count, 'tracts');
  } catch (err) {
    console.error('FAIL', city.id, err.message || err);
  }
}

writeFileSync('data/features/map-maker/cities-2027.json', JSON.stringify(meta, null, 2) + '\n');
console.log('done', meta.cities.filter((c) => c.outlineUrl).length, '/', meta.cities.length);
