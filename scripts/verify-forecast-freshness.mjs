import { readdirSync, readFileSync } from "node:fs";

const DATA_URL = new URL("../data/", import.meta.url);
const MODEL_TIME_ZONE = "America/Chicago";

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
  return JSON.parse(readFileSync(new URL(file, DATA_URL), "utf8"));
}

function fileDate(data) {
  return data.modelDate || data.date || data.runDate || "";
}

const expectedKey = todayKey();
const expectedLabel = todayLabel();
const failures = [];

for (const [label, file] of [
  ["Senate", "forecast.json"],
  ["House", "house-forecast.json"],
  ["Governors", "governor-forecast.json"],
  ["President aggregate", "president-forecast.json"]
]) {
  const data = readJson(file);
  const value = fileDate(data);
  if (value !== expectedKey && value !== expectedLabel) {
    failures.push(`${label} ${file} is stale: ${value || "missing date"}; expected ${expectedKey} / ${expectedLabel}`);
  }
}

const presidentFiles = readdirSync(DATA_URL)
  .filter((file) => /^president-forecast-[a-z]+-[a-z]+\.json$/.test(file))
  .sort();

if (presidentFiles.length !== 30) {
  failures.push(`President matchup count is ${presidentFiles.length}; expected 30`);
}

for (const file of presidentFiles) {
  const data = readJson(file);
  const value = fileDate(data);
  if (value !== expectedKey && value !== expectedLabel) {
    failures.push(`${file} is stale: ${value || "missing date"}; expected ${expectedKey} / ${expectedLabel}`);
  }
}

if (failures.length) {
  console.error("Forecast freshness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Forecast freshness check passed for ${expectedLabel}.`);
