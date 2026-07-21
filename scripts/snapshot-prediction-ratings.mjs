import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const predictionFiles = [
  { key: "senate", file: "data/predictions/2026-senate-predictions.json" },
  { key: "house", file: "data/predictions/2026-house-predictions.json" },
  { key: "governor", file: "data/predictions/2026-governor-predictions.json" }
];

const snapshotRoot = path.join(rootDir, "data", "predictions", "rating-snapshots");
const indexPath = path.join(snapshotRoot, "index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonIfMissing(filePath, value) {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return true;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function mondayOfUtcWeek(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

function parseArgDate() {
  const explicit = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
      throw new Error("--date must use YYYY-MM-DD.");
    }
    return explicit;
  }
  return toIsoDate(mondayOfUtcWeek(new Date()));
}

function pickCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  return {
    name: candidate.name || "",
    party: candidate.party || "",
    incumbent: Boolean(candidate.incumbent),
    status: candidate.status || ""
  };
}

function pickCandidates(candidates) {
  const out = {};
  Object.entries(candidates || {}).forEach(([key, candidate]) => {
    const picked = pickCandidate(candidate);
    if (picked) out[key] = picked;
  });
  return out;
}

function pickCountyPredictions(countyPredictions) {
  const out = {};
  Object.entries(countyPredictions || {}).forEach(([countyKey, value]) => {
    if (!value || typeof value !== "object") return;
    const picked = {};
    ["rating", "feaRating", "winner", "note"].forEach((field) => {
      if (value[field] !== undefined && value[field] !== null && value[field] !== "") {
        picked[field] = value[field];
      }
    });
    if (Object.keys(picked).length) out[countyKey] = picked;
  });
  return out;
}

function pickPrediction(prediction) {
  return {
    rating: prediction?.rating || "Toss-up",
    winner: prediction?.winner || "",
    confidence: prediction?.confidence || "",
    status: prediction?.status || "published"
  };
}

function sanitizeRace(race) {
  const out = {
    raceId: race.raceId,
    office: race.office || "",
    cycle: race.cycle || "",
    state: race.state || "",
    district: race.district || null,
    displayName: race.displayName || race.raceName || "",
    prediction: pickPrediction(race.prediction),
    candidates: pickCandidates(race.candidates)
  };
  const countyPredictions = pickCountyPredictions(race.countyPredictions);
  if (Object.keys(countyPredictions).length) out.countyPredictions = countyPredictions;
  return out;
}

function sanitizeSummary(summary, races) {
  const out = {
    counts: summary?.counts || {},
    ratings: summary?.ratings || {},
    raceCount: Number.isFinite(Number(summary?.raceCount)) ? Number(summary.raceCount) : races.length
  };
  if (summary?.notUpSeats) out.notUpSeats = summary.notUpSeats;
  if (summary?.incumbentsNotUp) out.incumbentsNotUp = summary.incumbentsNotUp;
  return out;
}

function buildSnapshot(data, key, snapshotDate) {
  const races = (data.races || []).map(sanitizeRace);
  return {
    schemaVersion: "fea-rating-snapshot-v1",
    snapshotDate,
    generatedAt: new Date().toISOString(),
    key,
    office: data.office || key,
    cycle: data.cycle || "2026",
    title: data.title || `2026 ${key} ratings`,
    summary: sanitizeSummary(data.summary || {}, races),
    notes: {
      publicSummary: "Weekly FEA Ratings snapshot. Earlier snapshots are preserved for the ratings timeline."
    },
    races
  };
}

function rebuildIndex() {
  const snapshots = {};
  for (const { key } of predictionFiles) {
    const dir = path.join(snapshotRoot, key);
    const entries = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
      : [];
    snapshots[key] = entries.map((name) => {
      const snapshot = readJson(path.join(dir, name));
      return {
        snapshotDate: snapshot.snapshotDate || name.replace(/\.json$/, ""),
        file: `data/predictions/rating-snapshots/${key}/${name}`,
        generatedAt: snapshot.generatedAt || null
      };
    });
  }
  writeJson(indexPath, {
    schemaVersion: "fea-rating-snapshot-index-v1",
    generatedAt: new Date().toISOString(),
    snapshots
  });
}

function main() {
  const snapshotDate = parseArgDate();
  const written = [];
  for (const { key, file } of predictionFiles) {
    const inputPath = path.join(rootDir, file);
    const data = readJson(inputPath);
    const snapshot = buildSnapshot(data, key, snapshotDate);
    const outputPath = path.join(snapshotRoot, key, `${snapshotDate}.json`);
    if (writeJsonIfMissing(outputPath, snapshot)) written.push(path.relative(rootDir, outputPath));
  }
  rebuildIndex();
  if (written.length) {
    console.log(`Created ${written.length} weekly FEA Ratings snapshot(s):`);
    written.forEach((file) => console.log(`- ${file}`));
  } else {
    console.log(`Weekly FEA Ratings snapshot ${snapshotDate} already exists; index refreshed only.`);
  }
}

main();
