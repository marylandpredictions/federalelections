import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

function unitId(fips) {
  const id = String(fips || "");
  if (/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id) || id === "AK-OA") return id;
  if (/^\d{5}$/.test(id)) return id;
  if (/^\d{10}$/.test(id)) return id.slice(0, 5);
  return "";
}

function fold(by, detail, names) {
  for (const county of detail?.counties || []) {
    const fips = unitId(county?.fips);
    if (!fips) continue;
    const row = by.get(fips) || {
      fips,
      name: names.get(fips) || county.name || fips,
      D: 0,
      R: 0,
      other: 0
    };
    if (names.get(fips)) row.name = names.get(fips);
    else if (/^\d{5}$/.test(String(county.fips)) && county.name) row.name = county.name;
    else if (/^AK-HD-/.test(fips) && county.name) row.name = county.name;
    for (const candidate of county.candidates || []) {
      const votes = Number(candidate.votes);
      if (!Number.isSafeInteger(votes) || votes < 0) continue;
      const code = String(candidate.partyCode || candidate.party || "").toUpperCase();
      row[code === "D" || code === "R" ? code : "other"] += votes;
    }
    by.set(fips, row);
  }
}

const root = resolve(process.cwd());
const assets = JSON.parse(await readFile(resolve(root, "data/results/map-assets.json"), "utf8"));
const names = new Map();

for (const path of Object.values(assets.counties || {})) {
  const geo = JSON.parse(gunzipSync(await readFile(resolve(root, path))).toString());
  for (const feature of geo.features || []) {
    const id = String(feature.id || feature.properties?.GEOID || "").padStart(5, "0");
    names.set(id, feature.properties?.NAME || feature.properties?.NAMELSAD || id);
  }
}

const akPath = assets.legislativeDistricts?.["02"]?.path;
if (akPath) {
  const geo = JSON.parse(gunzipSync(await readFile(resolve(root, akPath))).toString());
  for (const feature of geo.features || []) {
    const id = String(feature.id || feature.properties?.reportingUnitId || feature.properties?.GEOID || "");
    if (!id) continue;
    names.set(id, feature.properties?.NAME || feature.properties?.NAMELSAD || id);
  }
}

const by = new Map();
let withCounties = 0;
let missing = 0;
const files = (await readdir(resolve(root, "data/live-results-races")))
  .filter((name) => name.startsWith("house-") && name.endsWith(".json"));

for (const file of files) {
  const detail = JSON.parse(await readFile(resolve(root, "data/live-results-races", file), "utf8"));
  if (!detail?.counties?.length) {
    missing++;
    continue;
  }
  withCounties++;
  fold(by, detail, names);
}

const payload = {
  state: null,
  counties: [...by.values()],
  racesWithCounties: withCounties,
  racesMissingCounties: missing,
  hydratedThisPass: 0,
  updatedAt: new Date().toISOString(),
  version: `static-house-counties:${withCounties}:${by.size}`
};
const encoded = JSON.stringify(payload);
await writeFile(resolve(root, "data/election-night-house-counties.json"), encoded);
await writeFile(resolve(root, "data/election-night-house-counties.json.gz"), gzipSync(Buffer.from(encoded)));

const ne = [...by.values()].filter((row) => /^(09|23|25|33|44|50)/.test(row.fips));
console.log(JSON.stringify({
  total: by.size,
  withCounties,
  missing,
  neNamed: ne.filter((row) => row.name !== row.fips).length,
  neTotal: ne.length,
  ak: [...by.keys()].filter((key) => String(key).startsWith("AK-")).length,
  sanBernardino: by.get("06071"),
  cumberland: by.get("23005")
}, null, 2));
