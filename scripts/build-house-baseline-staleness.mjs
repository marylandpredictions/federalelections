import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHouseBaselineAudit } from "./lib/house-baseline-audit.mjs";

const ROOT = new URL("../", import.meta.url);

function readJson(path, fallback = null) {
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

const forecast = readJson("data/house-forecast.json", {});
const audit = buildHouseBaselineAudit(forecast.districts || [], { generatedAt: new Date().toISOString() });
writeJson("data/diagnostics/house-baseline-staleness-2026.json", {
  ...audit,
  districtCount: audit.summary?.districts || 0,
  note: "A district is VERIFIED only when the baseline is source-backed and same-shape/current-map or a high-confidence documented crosswalk."
});
console.log(`Wrote House baseline staleness diagnostics for ${audit.summary?.districts || 0} districts.`);
