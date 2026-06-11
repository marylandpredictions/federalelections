import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
  "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM",
  "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY"
};

const defaultBase = "C:/Users/zydlo/Downloads/districts119";
const shpPath = resolve(process.argv[2] || `${defaultBase} (1).shp`);
const dbfPath = resolve(process.argv[3] || `${defaultBase} (2).dbf`);
const outputPath = resolve(process.argv[4] || "data/house-districts-119.geojson");
const mergeInputPath = process.argv[5] ? resolve(process.argv[5]) : null;

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
      points.push([buffer.readDoubleLE(pointOffset), buffer.readDoubleLE(pointOffset + 8)]);
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

function modelDistrictId(record) {
  const state = FIPS_TO_STATE[String(record.STATEFP).padStart(2, "0")];
  const rawDistrict = record.DISTRICT ?? record.CD119FP ?? record.CD118FP ?? record.CD120FP;
  const districtNumber = Number(rawDistrict);
  if (!state || !Number.isFinite(districtNumber)) return null;
  return `${state}-${districtNumber === 0 ? "AL" : String(districtNumber).padStart(2, "0")}`;
}

function modelDistrictNumber(record) {
  const rawDistrict = record.DISTRICT ?? record.CD119FP ?? record.CD118FP ?? record.CD120FP;
  const districtNumber = Number(rawDistrict);
  return Number.isFinite(districtNumber) ? districtNumber : null;
}

function modelCongressNumber(record) {
  const rawCongress = record.STARTCONG ?? record.CDSESSN;
  const congress = Number(rawCongress);
  return Number.isFinite(congress) ? congress : null;
}

const records = readDbf(dbfPath);
const geometries = readShp(shpPath);
if (records.length !== geometries.length) {
  throw new Error(`DBF/SHP record mismatch: ${records.length} records, ${geometries.length} geometries.`);
}

const features = records.map((record, index) => {
  if (!record || !geometries[index]) return null;
  const state = FIPS_TO_STATE[String(record.STATEFP).padStart(2, "0")] || null;
  const district = modelDistrictNumber(record);
  const congress = modelCongressNumber(record);
  return {
    type: "Feature",
    properties: {
      id: modelDistrictId(record),
      state,
      stateName: record.STATENAME || (state ? `${state}` : null),
      district,
      congress,
      sourceId: record.ID || record.GEOID || null,
      sourceNote: record.NOTE || `TIGER/Line ${record.NAMELSAD || "congressional district"}`,
      lastChange: record.LASTCHANGE || null,
      stateFp: record.STATEFP || null,
      cd119Fp: record.CD119FP || null,
      geoid: record.GEOID || null,
      geoidFq: record.GEOIDFQ || null,
      namelsad: record.NAMELSAD || null,
      aland: record.ALAND ?? null,
      awater: record.AWATER ?? null
    },
    geometry: geometries[index]
  };
}).filter(Boolean);

let outputFeatures = features;
let mergeNote = null;
if (mergeInputPath) {
  const existing = JSON.parse(readFileSync(mergeInputPath, "utf8"));
  const replacementStates = new Set(features.map((feature) => feature.properties.state).filter(Boolean));
  outputFeatures = [
    ...(existing.features || []).filter((feature) => !replacementStates.has(feature.properties?.state)),
    ...features
  ].sort((a, b) => String(a.properties?.id || "").localeCompare(String(b.properties?.id || "")));
  mergeNote = {
    mergedInto: basename(mergeInputPath),
    replacedStates: [...replacementStates]
  };
}

const collection = {
  type: "FeatureCollection",
  name: "districts119",
  crs: {
    type: "name",
    properties: { name: "GCS_North_American_1983" }
  },
  generatedFrom: {
    shp: basename(shpPath),
    dbf: basename(dbfPath),
    merge: mergeNote
  },
  features: outputFeatures
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(collection)}\n`);
console.log(`Wrote ${outputFeatures.length} district shapes to ${outputPath}`);
