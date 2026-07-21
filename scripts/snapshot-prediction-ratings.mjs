import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePayload, normalizeRating, summarizeRatings } from "./normalize-ratings-data.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const predictionFiles = [
  { key: "senate", office: "senate", file: "data/predictions/2026-senate-predictions.json", title: "2026 Senate FEA Ratings" },
  { key: "house", office: "house", file: "data/predictions/2026-house-predictions.json", title: "2026 House FEA Ratings" },
  { key: "governor", office: "governor", file: "data/predictions/2026-governor-predictions.json", title: "2026 Governor FEA Ratings" }
];

const snapshotRoot = path.join(rootDir, "data", "predictions", "rating-snapshots");
const indexPath = path.join(snapshotRoot, "index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  copy.setUTCDate(copy.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}

function parseArgDate() {
  const explicit = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) throw new Error("--date must use YYYY-MM-DD.");
    return explicit;
  }
  return toIsoDate(mondayOfUtcWeek(new Date()));
}

function ratingSignature(snapshot) {
  return (snapshot.races || [])
    .map((race) => `${race.raceId}:${normalizeRating(race?.prediction?.rating)}`)
    .sort()
    .join("|");
}

function latestSnapshotFor(key) {
  const dir = path.join(snapshotRoot, key);
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const latest = entries.at(-1);
  return latest ? readJson(path.join(dir, latest)) : null;
}

function buildSnapshot(activeData, meta, snapshotDate) {
  const normalized = normalizePayload(activeData, meta);
  return {
    schemaVersion: "fea-rating-snapshot-v1",
    snapshotDate,
    generatedAt: new Date().toISOString(),
    key: meta.key,
    office: meta.office,
    cycle: normalized.cycle,
    title: normalized.title,
    summary: summarizeRatings(normalized.races, normalized.summary || {}),
    notes: {
      publicSummary: "Weekly read-only FEA Ratings snapshot. Earlier snapshots are preserved for the ratings timeline."
    },
    races: normalized.races.map((race) => ({
      raceId: race.raceId,
      office: race.office,
      cycle: race.cycle,
      state: race.state,
      district: race.district ?? null,
      displayName: race.displayName,
      prediction: {
        rating: normalizeRating(race?.prediction?.rating),
        status: race?.prediction?.status || "published"
      },
      candidates: race.candidates || {},
      notes: race.notes || {}
    }))
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
  const skipped = [];
  for (const meta of predictionFiles) {
    const activePath = path.join(rootDir, meta.file);
    const snapshot = buildSnapshot(readJson(activePath), meta, snapshotDate);
    const outputPath = path.join(snapshotRoot, meta.key, `${snapshotDate}.json`);
    if (fs.existsSync(outputPath)) {
      skipped.push(`${meta.key}: ${snapshotDate} already exists`);
      continue;
    }
    const previous = latestSnapshotFor(meta.key);
    if (previous && ratingSignature(previous) === ratingSignature(snapshot)) {
      skipped.push(`${meta.key}: unchanged since ${previous.snapshotDate || "previous snapshot"}`);
      continue;
    }
    writeJson(outputPath, snapshot);
    written.push(path.relative(rootDir, outputPath));
  }
  rebuildIndex();
  if (written.length) {
    console.log(`Created ${written.length} weekly FEA Ratings snapshot(s):`);
    written.forEach((file) => console.log(`- ${file}`));
  }
  if (skipped.length) {
    console.log("Skipped:");
    skipped.forEach((entry) => console.log(`- ${entry}`));
  }
}

main();
