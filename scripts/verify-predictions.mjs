import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const predictionDir = resolve(root, "data/predictions");
const validRatings = new Set([
  "Safe Democratic",
  "Likely Democratic",
  "Lean Democratic",
  "Tilt Democratic",
  "Tossup",
  "Tilt Independent",
  "Lean Independent",
  "Likely Independent",
  "Safe Independent",
  "Tilt Republican",
  "Lean Republican",
  "Likely Republican",
  "Safe Republican"
]);
const validStatus = new Set(["draft", "reviewed", "published", "needs-review", "updating"]);
const removedPredictionKeys = [
  "winner",
  "projectedMargin",
  "probability",
  "confidence",
  "mapValue",
  "displayPercentages",
  "countyPredictions",
  "modelReference",
  "modelSignal"
];
const requiredPredictionFiles = new Set([
  "2026-senate-predictions.json",
  "2026-house-predictions.json",
  "2026-governor-predictions.json"
]);
const errors = [];

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  if (/^\s*(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    throw new Error(`${filePath} contains Git conflict markers.`);
  }
  return JSON.parse(text);
}

function fail(message) {
  errors.push(message);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else files.push(entryPath);
  }
  return files;
}

function validateRace(file, race) {
  const id = race.raceId || "(missing raceId)";
  if (!race.raceId) fail(`${file}: race missing raceId`);
  if (!race.office) fail(`${file}: ${id} missing office`);
  if (!race.state) fail(`${file}: ${id} missing state`);
  const prediction = race.prediction || {};
  if (!validRatings.has(prediction.rating)) fail(`${file}: ${id} invalid rating ${prediction.rating}`);
  if (!validStatus.has(prediction.status || "published")) fail(`${file}: ${id} invalid status ${prediction.status}`);
  for (const key of removedPredictionKeys) {
    if (key in prediction || key in race) {
      fail(`${file}: ${id} contains retired numeric prediction field ${key}`);
    }
  }
}

async function validatePredictionFiles() {
  const files = (await readdir(predictionDir).catch(() => []))
    .filter((file) => file.endsWith("-predictions.json"));
  for (const required of requiredPredictionFiles) {
    if (!files.includes(required)) fail(`Missing published FEA Ratings file ${required}. Run npm run normalize:ratings.`);
  }
  for (const file of files) {
    if (!requiredPredictionFiles.has(file)) fail(`Unexpected prediction file remains: data/predictions/${file}`);
    const filePath = join(predictionDir, file);
    const data = await readJson(filePath);
    const displayFile = filePath.replace(`${root}\\`, "").replaceAll("\\", "/");
    if (data.schemaVersion !== "fea-ratings-v1") fail(`${displayFile}: invalid schemaVersion`);
    if (!Array.isArray(data.races) || !data.races.length) fail(`${displayFile}: races must be a non-empty array`);
    for (const race of data.races || []) validateRace(displayFile, race);
  }
}

async function validateRetiredCountyPredictions() {
  const countyRoot = join(predictionDir, "county-predictions");
  const files = (await walk(countyRoot)).filter((file) => file.endsWith(".json"));
  for (const filePath of files) {
    fail(`${filePath.replace(`${root}\\`, "").replaceAll("\\", "/")}: county-level prediction files are retired from the FEA Ratings system`);
  }
}

async function scanPublicStrings() {
  const files = [
    "predictions.html",
    "assets/predictions.js",
    "assets/prediction-map-utils.js",
    "assets/predictions.css",
    "assets/admin-predictions.js",
    "predictions/2026/senate.html",
    "predictions/2026/house.html",
    "predictions/2026/governor.html",
    "admin/predictions.html"
  ].map((file) => resolve(root, file));
  for (const filePath of files) {
    if (!existsSync(filePath)) {
      fail(`${filePath.replace(`${root}\\`, "")}: required ratings page asset missing`);
      continue;
    }
    const text = await readFile(filePath, "utf8");
    if (text.includes("[object Object]")) fail(`${filePath}: contains [object Object]`);
    if (/\bNaN\b/.test(text)) fail(`${filePath}: contains NaN`);
  }
}

async function main() {
  await validatePredictionFiles();
  await validateRetiredCountyPredictions();
  await scanPublicStrings();
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
  }
  console.log("FEA Ratings verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
