import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const activeFiles = [
  { key: "senate", office: "senate", file: "data/predictions/2026-senate-predictions.json", title: "2026 Senate FEA Ratings" },
  { key: "house", office: "house", file: "data/predictions/2026-house-predictions.json", title: "2026 House FEA Ratings" },
  { key: "governor", office: "governor", file: "data/predictions/2026-governor-predictions.json", title: "2026 Governor FEA Ratings" }
];

export const allowedRatings = [
  "Safe Democratic",
  "Likely Democratic",
  "Lean Democratic",
  "Tossup",
  "Lean Republican",
  "Likely Republican",
  "Safe Republican"
];

const ratingAliases = new Map([
  ["safe d", "Safe Democratic"],
  ["safe dem", "Safe Democratic"],
  ["safe democratic", "Safe Democratic"],
  ["solid d", "Safe Democratic"],
  ["solid dem", "Safe Democratic"],
  ["solid democratic", "Safe Democratic"],
  ["likely d", "Likely Democratic"],
  ["likely dem", "Likely Democratic"],
  ["likely democratic", "Likely Democratic"],
  ["lean d", "Lean Democratic"],
  ["lean dem", "Lean Democratic"],
  ["lean democratic", "Lean Democratic"],
  ["tilt d", "Lean Democratic"],
  ["tilt dem", "Lean Democratic"],
  ["tilt democratic", "Lean Democratic"],
  ["toss-up", "Tossup"],
  ["toss up", "Tossup"],
  ["tossup", "Tossup"],
  ["tie", "Tossup"],
  ["safe r", "Safe Republican"],
  ["safe rep", "Safe Republican"],
  ["safe republican", "Safe Republican"],
  ["solid r", "Safe Republican"],
  ["solid rep", "Safe Republican"],
  ["solid republican", "Safe Republican"],
  ["likely r", "Likely Republican"],
  ["likely rep", "Likely Republican"],
  ["likely republican", "Likely Republican"],
  ["lean r", "Lean Republican"],
  ["lean rep", "Lean Republican"],
  ["lean republican", "Lean Republican"],
  ["tilt r", "Lean Republican"],
  ["tilt rep", "Lean Republican"],
  ["tilt republican", "Lean Republican"],
  ["safe i", "Tossup"],
  ["likely i", "Tossup"],
  ["lean i", "Tossup"],
  ["tilt i", "Tossup"]
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function normalizeRating(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Tossup";
  if (allowedRatings.includes(raw)) return raw;
  return ratingAliases.get(raw.toLowerCase()) || "Tossup";
}

function partyFromRating(rating) {
  if (rating.includes("Democratic")) return "D";
  if (rating.includes("Republican")) return "R";
  return "Tossup";
}

function cleanObject(value, blockedKeys) {
  if (Array.isArray(value)) return value.map((item) => cleanObject(item, blockedKeys)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (blockedKeys.has(key)) continue;
    const cleaned = cleanObject(child, blockedKeys);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function cleanCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const kept = {
    name: candidate.name || "",
    party: candidate.party || "",
    incumbent: Boolean(candidate.incumbent),
    status: candidate.status || "",
    headshotUrl: candidate.headshotUrl || candidate.photo || candidate.image || "",
    color: candidate.color || candidate.accentColor || ""
  };
  Object.keys(kept).forEach((key) => {
    if (kept[key] === "" || kept[key] === null || kept[key] === undefined) delete kept[key];
  });
  return kept.name ? kept : null;
}

function cleanCandidates(candidates) {
  const out = {};
  for (const [key, candidate] of Object.entries(candidates || {})) {
    const cleaned = cleanCandidate(candidate);
    if (cleaned) out[key] = cleaned;
  }
  return out;
}

function cleanNotes(notes) {
  if (!notes || typeof notes !== "object") return {};
  const cleaned = cleanObject(notes, new Set(["modelSignal", "modelReference", "displayPercentages", "projectedMargin", "mapValue"]));
  return cleaned && typeof cleaned === "object" ? cleaned : {};
}

function cleanRace(race, fallbackOffice) {
  const rating = normalizeRating(race?.prediction?.rating || race?.rating || race?.feaRating);
  return {
    raceId: race.raceId,
    office: race.office || fallbackOffice,
    cycle: String(race.cycle || "2026"),
    state: race.state || "",
    district: race.district ?? null,
    displayName: race.displayName || race.raceName || race.label || "",
    prediction: {
      rating,
      status: race?.prediction?.status || race.status || "published"
    },
    candidates: cleanCandidates(race.candidates),
    notes: cleanNotes(race.notes),
    sources: Array.isArray(race.sources) ? race.sources : [],
    lastEdited: race.lastEdited || "",
    lastEditedBy: race.lastEditedBy || ""
  };
}

export function summarizeRatings(races, existingSummary = {}) {
  const counts = { D: 0, R: 0, Tossup: 0, Uncalled: 0 };
  const ratings = Object.fromEntries(allowedRatings.map((rating) => [rating, 0]));
  for (const race of races) {
    const rating = normalizeRating(race?.prediction?.rating);
    ratings[rating] += 1;
    const party = partyFromRating(rating);
    if (party === "D") counts.D += 1;
    else if (party === "R") counts.R += 1;
    else counts.Tossup += 1;
  }
  const summary = {
    counts,
    ratings,
    raceCount: races.length
  };
  if (existingSummary?.notUpSeats) summary.notUpSeats = existingSummary.notUpSeats;
  if (existingSummary?.incumbentsNotUp) summary.incumbentsNotUp = existingSummary.incumbentsNotUp;
  return summary;
}

export function normalizePayload(data, meta = {}) {
  const races = Array.isArray(data.races) ? data.races.map((race) => cleanRace(race, meta.office || data.office || meta.key)).filter((race) => race.raceId) : [];
  return {
    schemaVersion: "fea-ratings-v1",
    key: meta.key || data.key || "",
    office: meta.office || data.office || meta.key || "",
    cycle: String(data.cycle || "2026"),
    title: meta.title || data.title || "FEA Ratings",
    pageStatus: data.pageStatus || "Published",
    generatedAt: data.generatedAt || new Date().toISOString(),
    lastPublishedAt: data.lastPublishedAt || data.generatedAt || new Date().toISOString(),
    summary: summarizeRatings(races, data.summary || {}),
    notes: {
      publicSummary: "FEA Ratings are categorical team ratings informed by polling, race context, public evidence, and model diagnostics."
    },
    races
  };
}

function normalizeFile(relativePath, meta) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) return false;
  const normalized = normalizePayload(readJson(filePath), meta);
  writeJson(filePath, normalized);
  return true;
}

function normalizeExistingSnapshots() {
  const snapshotRoot = path.join(rootDir, "data", "predictions", "rating-snapshots");
  for (const meta of activeFiles) {
    const dir = path.join(snapshotRoot, meta.key);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      normalizeFile(path.relative(rootDir, path.join(dir, file)), meta);
    }
  }
}

function main() {
  const changed = [];
  for (const meta of activeFiles) {
    if (normalizeFile(meta.file, meta)) changed.push(meta.file);
  }
  normalizeExistingSnapshots();
  console.log(`Normalized ${changed.length} active FEA Ratings file(s).`);
  changed.forEach((file) => console.log(`- ${file}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
