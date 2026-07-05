import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateFreshnessSummary } from "./lib/candidate-freshness.mjs";

const ROOT = new URL("../", import.meta.url);

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const senate = readJson("data/forecast.json");
const house = readJson("data/house-forecast.json");
const governor = readJson("data/governor-forecast.json");
const payload = {
  generatedAt: new Date().toISOString(),
  senate: candidateFreshnessSummary(senate.races || []),
  house: candidateFreshnessSummary(house.districts || []),
  governor: candidateFreshnessSummary(governor.races || [])
};
writeJson("data/diagnostics/candidate-freshness-2026.json", payload);
console.log("Wrote candidate freshness diagnostics.");

