import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// Regenerate with:
//   node scripts/build-district-county-maps.mjs C:\Users\zydlo\Downloads\cb_2025_us_county_within_cd119_500k.zip
//
// The input is the Census "119th Congressional District within Current County
// and Equivalent Entities" shapefile ZIP. Output is split by district for
// browser performance and geometry-cycle versioning.

const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
  "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
  "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY"
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

const zipPath = resolve(process.argv[2] || "C:/Users/zydlo/Downloads/cb_2025_us_county_within_cd119_500k.zip");
const congress = String(process.argv[3] || "119").replace(/\D/g, "") || "119";
const outputRoot = resolve(process.argv[4] || `data/maps/congress/${congress}`);
const workDir = resolve(".tmp/district-county-map-build");

function readDbf(path) {
  const buffer = readFileSync(path);
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) break;
    fields.push({
      name: buffer.subarray(offset, offset + 11).toString("ascii").replace(/\0.*$/, "").trim(),
      type: String.fromCharCode(buffer[offset + 11]),
      length: buffer[offset + 16]
    });
  }

  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    const deleted = String.fromCharCode(buffer[headerLength + (index * recordLength)]);
    if (deleted === "*") {
      records.push(null);
      continue;
    }
    let offset = headerLength + (index * recordLength) + 1;
    const record = {};
    for (const field of fields) {
      const raw = buffer.subarray(offset, offset + field.length).toString("utf8").trim();
      offset += field.length;
      record[field.name] = field.type === "N" ? Number(raw) : raw;
    }
    records.push(record);
  }
  return records;
}

function readShp(path) {
  const buffer = readFileSync(path);
  const fileShapeType = buffer.readInt32LE(32);
  if (![5, 15].includes(fileShapeType)) {
    throw new Error(`Unsupported shapefile type ${fileShapeType}; expected Polygon or PolygonZ.`);
  }

  const geometries = [];
  let offset = 100;
  while (offset < buffer.length) {
    const recordNumber = buffer.readInt32BE(offset);
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const shapeType = buffer.readInt32LE(contentOffset);
    if (shapeType === 0) {
      geometries.push(null);
      offset += 8 + contentLength;
      continue;
    }
    if (![5, 15].includes(shapeType)) {
      throw new Error(`Unsupported record ${recordNumber} shape type ${shapeType}.`);
    }

    const partsCount = buffer.readInt32LE(contentOffset + 36);
    const pointCount = buffer.readInt32LE(contentOffset + 40);
    const parts = [];
    for (let index = 0; index < partsCount; index += 1) {
      parts.push(buffer.readInt32LE(contentOffset + 44 + (index * 4)));
    }

    const pointsOffset = contentOffset + 44 + (partsCount * 4);
    const points = [];
    for (let index = 0; index < pointCount; index += 1) {
      const pointOffset = pointsOffset + (index * 16);
      points.push([
        roundCoord(buffer.readDoubleLE(pointOffset)),
        roundCoord(buffer.readDoubleLE(pointOffset + 8))
      ]);
    }

    const polygons = parts.map((start, index) => {
      const end = parts[index + 1] ?? points.length;
      let ring = points.slice(start, end);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
      ring = rewindForGeoJson(ring);
      return [ring];
    }).filter((polygon) => polygon[0].length >= 4);

    geometries.push({
      type: polygons.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: polygons.length === 1 ? polygons[0] : polygons
    });
    offset += 8 + contentLength;
  }
  return geometries;
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    sum += (ring[previous][0] * ring[index][1]) - (ring[index][0] * ring[previous][1]);
  }
  return sum / 2;
}

function rewindForGeoJson(ring) {
  return ringArea(ring) < 0 ? [...ring].reverse() : ring;
}

function loadCountyNames() {
  const path = resolve("data/result-county-descriptions.json");
  if (!existsSync(path)) return new Map();
  const data = JSON.parse(readFileSync(path, "utf8"));
  const lookup = new Map();
  for (const row of data.rows || []) {
    if (row.fips && row.county) lookup.set(String(row.fips).padStart(5, "0"), row.county);
  }
  return lookup;
}

function districtId(state, districtCode) {
  const district = String(districtCode || "").padStart(2, "0");
  if (district === "00") return `${state}-AL`;
  return `${state}-${district}`;
}

function validDistrictCode(value) {
  return /^\d{2}$/.test(String(value || "")) && String(value) !== "ZZ";
}

function extractZip() {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  execFileSync("tar", ["-xf", zipPath, "-C", workDir], { stdio: "inherit" });
  const base = "cb_2025_us_county_within_cd119_500k";
  return {
    shp: join(workDir, `${base}.shp`),
    dbf: join(workDir, `${base}.dbf`)
  };
}

const countyNames = loadCountyNames();
const { shp, dbf } = extractZip();
const records = readDbf(dbf);
const geometries = readShp(shp);
if (records.length !== geometries.length) {
  throw new Error(`DBF/SHP record mismatch: ${records.length} records, ${geometries.length} geometries.`);
}

const byDistrict = new Map();
for (let index = 0; index < records.length; index += 1) {
  const record = records[index];
  const geometry = geometries[index];
  if (!record || !geometry) continue;
  const stateFp = String(record.STATEFP || "").padStart(2, "0");
  const countyFp = String(record.COUNTYFP || "").padStart(3, "0");
  const cdFp = String(record.CD119FP || "").padStart(2, "0");
  const state = FIPS_TO_STATE[stateFp];
  if (!state || !validDistrictCode(cdFp)) continue;
  const id = districtId(state, cdFp);
  const countyFips = `${stateFp}${countyFp}`;
  const feature = {
    type: "Feature",
    properties: {
      STATEFP: stateFp,
      COUNTYFP: countyFp,
      CD119FP: cdFp,
      GEOID: String(record.GEOID || ""),
      PARTFLG: String(record.PARTFLG || ""),
      ALAND: Number(record.ALAND || 0),
      AWATER: Number(record.AWATER || 0),
      state,
      stateName: STATE_NAMES[state] || state,
      district: cdFp === "00" ? 0 : Number(cdFp),
      districtId: id,
      countyFips,
      countyName: countyNames.get(countyFips) || `${countyFips} County`,
      partialCounty: String(record.PARTFLG || "").toUpperCase() === "Y",
      geometryCycle: Number(congress)
    },
    geometry
  };
  if (!byDistrict.has(id)) byDistrict.set(id, []);
  byDistrict.get(id).push(feature);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const manifest = {
  model: "congressional district county-breakdown maps",
  congress: Number(congress),
  generatedAt: new Date().toISOString(),
  source: {
    zip: basename(zipPath),
    description: "Census 119th Congressional District within Current County and Equivalent Entities, 500k cartographic boundary file"
  },
  fieldsPreserved: ["STATEFP", "COUNTYFP", "CD119FP", "GEOID", "PARTFLG", "ALAND", "AWATER"],
  districts: []
};

for (const [id, features] of [...byDistrict.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const [state, district] = id.split("-");
  const collection = {
    type: "FeatureCollection",
    model: "congressional district county-breakdown map",
    congress: Number(congress),
    geometryCycle: Number(congress),
    districtId: id,
    state,
    district,
    generatedAt: manifest.generatedAt,
    source: manifest.source,
    features
  };
  writeFileSync(join(outputRoot, `${id}.json`), `${JSON.stringify(collection)}\n`);
  manifest.districts.push({
    id,
    state,
    district,
    featureCount: features.length,
    partialCountyCount: features.filter((feature) => feature.properties.partialCounty).length
  });
}

writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(workDir, { recursive: true, force: true });
console.log(`Wrote ${manifest.districts.length} district county-breakdown maps to ${outputRoot}`);
