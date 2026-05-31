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
      const ring = points.slice(start, end);
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([...first]);
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

function modelDistrictId(record) {
  const state = FIPS_TO_STATE[String(record.STATEFP).padStart(2, "0")];
  const districtNumber = Number(record.DISTRICT);
  if (!state || !Number.isFinite(districtNumber)) return null;
  return `${state}-${districtNumber === 0 ? "AL" : String(districtNumber).padStart(2, "0")}`;
}

const records = readDbf(dbfPath);
const geometries = readShp(shpPath);
if (records.length !== geometries.length) {
  throw new Error(`DBF/SHP record mismatch: ${records.length} records, ${geometries.length} geometries.`);
}

const features = records.map((record, index) => {
  if (!record || !geometries[index]) return null;
  return {
    type: "Feature",
    properties: {
      id: modelDistrictId(record),
      state: FIPS_TO_STATE[String(record.STATEFP).padStart(2, "0")] || null,
      stateName: record.STATENAME,
      district: Number(record.DISTRICT),
      congress: Number(record.STARTCONG),
      sourceId: record.ID,
      sourceNote: record.NOTE,
      lastChange: record.LASTCHANGE
    },
    geometry: geometries[index]
  };
}).filter(Boolean);

const collection = {
  type: "FeatureCollection",
  name: "districts119",
  crs: {
    type: "name",
    properties: { name: "GCS_North_American_1983" }
  },
  generatedFrom: {
    shp: basename(shpPath),
    dbf: basename(dbfPath)
  },
  features
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(collection)}\n`);
console.log(`Wrote ${features.length} district shapes to ${outputPath}`);
