import { readFileSync } from "node:fs";

const OFFICES = ["house", "senate", "governor"];
let failures = 0;

for (const office of OFFICES) {
  const path = new URL(`../data/diagnostics/benchmark-diff-${office}-2026.json`, import.meta.url);
  let payload;
  try {
    payload = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Missing benchmark diagnostics for ${office}: ${error.message}`);
    failures += 1;
    continue;
  }
  if (!Array.isArray(payload.rows)) {
    console.error(`Benchmark diagnostics for ${office} has malformed rows.`);
    failures += 1;
  }
}

try {
  const payload = JSON.parse(readFileSync(new URL("../data/cache/benchmarks/public-models-2026.json", import.meta.url), "utf8"));
  if (!payload.topline || typeof payload.topline !== "object") {
    console.error("Public benchmark cache is missing topline rows.");
    failures += 1;
  }
  for (const office of OFFICES) {
    const row = payload.topline?.[office];
    if (!row) {
      console.error(`Public benchmark cache is missing ${office}.`);
      failures += 1;
      continue;
    }
    if (!row.releaseGate || !["OK", "WARN_REVIEW", "BLOCK_REVIEW"].includes(row.releaseGate.releaseStatus)) {
      console.error(`Public benchmark cache has malformed release gate for ${office}.`);
      failures += 1;
    }
  }
} catch (error) {
  console.error(`Missing public benchmark cache: ${error.message}`);
  failures += 1;
}

if (failures) process.exit(1);
console.log("Benchmark alignment diagnostics are present and well-formed.");

