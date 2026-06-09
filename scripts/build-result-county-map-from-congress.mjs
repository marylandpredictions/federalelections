// Rebuilds data/result-counties.geojson from the generated Census 119th
// district-within-county files. This gives statewide result maps county
// geometry for every state without adding a second national shapefile.
//
// Usage:
//   node scripts/build-result-county-map-from-congress.mjs

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const inputDir = resolve(root, "data", "maps", "congress", "119");
const outputPath = resolve(root, "data", "result-counties.geojson");

function cleanCountyName(value) {
  return String(value || "")
    .replace(/\s+(County|Parish|Borough|Census Area|Municipality|city and borough|city)$/i, "")
    .trim();
}

function addGeometry(target, geometry) {
  if (!geometry) return;
  if (geometry.type === "Polygon") {
    target.push(geometry.coordinates);
  } else if (geometry.type === "MultiPolygon") {
    target.push(...geometry.coordinates);
  }
}

const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const byCounty = new Map();

for (const file of files) {
  const collection = JSON.parse(await readFile(join(inputDir, file), "utf8"));
  for (const feature of collection.features || []) {
    const props = feature.properties || {};
    const state = String(props.STATEFP || "").padStart(2, "0");
    const county = String(props.COUNTYFP || "").padStart(3, "0");
    const fips = props.countyFips || `${state}${county}`;
    if (!state || !county || !fips || props.CD119FP === "ZZ") continue;
    if (!byCounty.has(fips)) {
      byCounty.set(fips, {
        type: "Feature",
        id: fips,
        properties: {
          GEO_ID: `0500000US${fips}`,
          STATE: state,
          STATEFP: state,
          COUNTY: county,
          COUNTYFP: county,
          GEOID: fips,
          NAME: cleanCountyName(props.countyName || ""),
          countyName: props.countyName || cleanCountyName(props.countyName || ""),
          state: props.state || "",
          stateName: props.stateName || "",
          LSAD: "County"
        },
        geometry: {
          type: "MultiPolygon",
          coordinates: []
        }
      });
    }
    addGeometry(byCounty.get(fips).geometry.coordinates, feature.geometry);
  }
}

const features = [...byCounty.values()]
  .filter((feature) => feature.geometry.coordinates.length)
  .sort((a, b) => String(a.id).localeCompare(String(b.id)));

const geojson = {
  type: "FeatureCollection",
  model: "FEA result county map from Census 119th district-within-county geometry",
  generatedAt: new Date().toISOString(),
  source: "data/maps/congress/119/*.json",
  features
};

await writeFile(outputPath, `${JSON.stringify(geojson)}\n`, "utf8");
console.log(`Wrote ${features.length} county features to ${outputPath}`);
