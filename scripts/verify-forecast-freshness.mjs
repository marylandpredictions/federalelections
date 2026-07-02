import { readdirSync, readFileSync } from "node:fs";

const DATA_URL = new URL("../data/", import.meta.url);
const MODEL_TIME_ZONE = "America/New_York";

function todayKey(date = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(process.env.MODEL_DATE || "")) return process.env.MODEL_DATE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function todayLabel(date = new Date()) {
  const modelDate = process.env.MODEL_DATE;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(modelDate || "") ? new Date(`${modelDate}T12:00:00`) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(source);
}

function readJson(file) {
  const text = readFileSync(new URL(file, DATA_URL), "utf8");
  if (/^\s*(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    failures.push(`${file} contains unresolved Git conflict markers`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${file} is not valid JSON: ${error.message}`);
    return {};
  }
}

function fileDate(data) {
  return data.modelDate || data.date || data.runDate || "";
}

const expectedKey = todayKey();
const expectedLabel = todayLabel();
const failures = [];
const MAX_FORECAST_AGE_MS = 48 * 60 * 60 * 1000;

function generatedAtMs(data) {
  const generatedAt = data.generatedAt || data.lastGeneratedAt || data.updatedAt || "";
  const date = new Date(generatedAt);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function assertFreshGeneratedAt(label, file, data) {
  const generatedAt = generatedAtMs(data);
  if (!generatedAt) {
    failures.push(`${label} ${file} is missing generatedAt`);
    return;
  }
  const ageMs = Date.now() - generatedAt;
  if (ageMs > MAX_FORECAST_AGE_MS) {
    failures.push(`${label} ${file} is stale: generatedAt ${new Date(generatedAt).toISOString()} is older than 48 hours`);
  }
}

for (const [label, file] of [
  ["Senate", "forecast.json"],
  ["House", "house-forecast.json"],
  ["Governors", "governor-forecast.json"],
  ["President aggregate", "president-forecast.json"]
]) {
  const data = readJson(file);
  assertFreshGeneratedAt(label, file, data);
}

const presidentFiles = readdirSync(DATA_URL)
  .filter((file) => /^president-forecast-[a-z]+-[a-z]+\.json$/.test(file))
  .sort();

if (presidentFiles.length !== 30) {
  failures.push(`President matchup count is ${presidentFiles.length}; expected 30`);
}

for (const file of presidentFiles) {
  const data = readJson(file);
  assertFreshGeneratedAt(file, file, data);
}

if (failures.length) {
  console.error("Forecast freshness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Forecast freshness check passed: generatedAt values are within 48 hours of ${expectedLabel} (${expectedKey}).`);
