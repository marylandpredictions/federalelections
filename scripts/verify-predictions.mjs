import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const predictionDir = resolve(root, "data/predictions");
const validRatings = new Set([
  "Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up",
  "Tilt R", "Lean R", "Likely R", "Safe R",
  "Safe I", "Likely I", "Lean I", "Tilt I"
]);
const validWinners = new Set(["D", "R", "I", "Toss-up", "Uncalled"]);
const validConfidence = new Set(["low", "medium", "high"]);
const validStatus = new Set(["draft", "reviewed", "published", "needs-review", "updating"]);
const errors = [];

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  if (/[<]{5,}|[>]{5,}|[=]{5,}/.test(text)) {
    throw new Error(`${filePath} contains Git conflict markers.`);
  }
  return JSON.parse(text);
}

function fail(message) {
  errors.push(message);
}

function isFiniteOrNull(value) {
  return value === null || value === undefined || Number.isFinite(Number(value));
}

function validateRace(file, race) {
  const id = race.raceId || "(missing raceId)";
  if (!race.raceId) fail(`${file}: race missing raceId`);
  if (!race.office) fail(`${file}: ${id} missing office`);
  if (!race.state) fail(`${file}: ${id} missing state`);
  const prediction = race.prediction || {};
  if (!validRatings.has(prediction.rating)) fail(`${file}: ${id} invalid rating ${prediction.rating}`);
  if (!validWinners.has(prediction.winner)) fail(`${file}: ${id} invalid winner ${prediction.winner}`);
  if (!isFiniteOrNull(prediction.projectedMargin)) fail(`${file}: ${id} invalid projectedMargin ${prediction.projectedMargin}`);
  if (!validConfidence.has(prediction.confidence)) fail(`${file}: ${id} invalid confidence ${prediction.confidence}`);
  if (!validStatus.has(prediction.status || "published")) fail(`${file}: ${id} invalid status ${prediction.status}`);
  for (const party of ["D", "R"]) {
    if (!race.candidates?.[party]?.name) fail(`${file}: ${id} missing ${party} candidate name`);
  }
}

function validateCounty(file, row) {
  const id = row.countyFips || row.county || "(missing county)";
  if (!/^\d{5}$/.test(String(row.countyFips || ""))) fail(`${file}: ${id} invalid countyFips`);
  if (!row.state) fail(`${file}: ${id} missing state`);
  if (!row.county) fail(`${file}: ${id} missing county`);
  const prediction = row.prediction || {};
  if (!validRatings.has(prediction.rating)) fail(`${file}: ${id} invalid county rating ${prediction.rating}`);
  if (!validWinners.has(prediction.winner)) fail(`${file}: ${id} invalid county winner ${prediction.winner}`);
  if (!isFiniteOrNull(prediction.projectedMargin)) fail(`${file}: ${id} invalid county projectedMargin`);
  if (!validConfidence.has(prediction.confidence)) fail(`${file}: ${id} invalid county confidence ${prediction.confidence}`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function validatePredictionFiles() {
  const files = (await readdir(predictionDir).catch(() => []))
    .filter((file) => file.endsWith("-predictions.json"))
    .map((file) => join(predictionDir, file));
  if (!files.length) fail("No published prediction files found. Run npm run build:prediction-adapter.");
  for (const filePath of files) {
    const data = await readJson(filePath);
    const file = filePath.replace(`${root}\\`, "").replaceAll("\\", "/");
    if (data.schemaVersion !== "team-predictions-v1") fail(`${file}: invalid schemaVersion`);
    if (!Array.isArray(data.races) || !data.races.length) fail(`${file}: races must be a non-empty array`);
    for (const race of data.races || []) validateRace(file, race);
  }
}

async function validateCountyFiles() {
  const countyRoot = join(predictionDir, "county-predictions");
  const files = (await walk(countyRoot)).filter((file) => file.endsWith(".json"));
  for (const filePath of files) {
    const data = await readJson(filePath);
    const rows = Array.isArray(data) ? data : data.counties;
    const file = filePath.replace(`${root}\\`, "").replaceAll("\\", "/");
    if (!Array.isArray(rows)) {
      fail(`${file}: county prediction file must be an array or contain counties[]`);
      continue;
    }
    rows.forEach((row) => validateCounty(file, row));
  }
}

async function scanPublicStrings() {
  const files = [
    "predictions.html",
    "predictions-methodology.html",
    "predictions/methodology/index.html",
    "assets/predictions.js",
    "assets/predictions.css",
    "assets/model-lab.js",
    "assets/admin-predictions.js"
  ].map((file) => resolve(root, file));
  const htmlRoots = [
    "predictions/2026/senate.html",
    "predictions/2026/house.html",
    "predictions/2026/governor.html",
    "model-lab.html",
    "model-lab/2026/senate.html",
    "model-lab/2026/house.html",
    "model-lab/2026/governor.html",
    "model-lab/2028/president.html",
    "admin/predictions.html"
  ].map((file) => resolve(root, file));
  for (const filePath of [...files, ...htmlRoots]) {
    if (!existsSync(filePath)) {
      fail(`${filePath.replace(`${root}\\`, "")}: required prediction page asset missing`);
      continue;
    }
    const text = await readFile(filePath, "utf8");
    if (text.includes("[object Object]")) fail(`${filePath}: contains [object Object]`);
    if (/\bNaN\b/.test(text)) fail(`${filePath}: contains NaN`);
  }
}

async function main() {
  await validatePredictionFiles();
  await validateCountyFiles();
  await scanPublicStrings();
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
  }
  console.log("Prediction verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
