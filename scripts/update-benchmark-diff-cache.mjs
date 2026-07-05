import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const MODELS = [
  ["house", "data/house-forecast.json", "districts"],
  ["senate", "data/forecast.json", "races"],
  ["governor", "data/governor-forecast.json", "races"]
];

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

for (const [office, path, collection] of MODELS) {
  const forecast = readJson(path);
  const rows = (forecast[collection] || []).map((race) => ({
    raceId: race.id || race.state || null,
    modelRating: race.modelRating || race.rating || null,
    probabilityEngineMargin: race.probabilityEngineMargin ?? null,
    projectedResultMargin: race.projectedResultMargin?.value ?? race.projectedResultMargin ?? race.margin ?? null,
    benchmarkOutlier: Boolean(race.benchmarkOutlier || race.benchmarkComparison?.benchmarkOutlier || race.benchmarkComparison?.warnings?.length),
    warnings: race.benchmarkComparison?.warnings || []
  }));
  const payload = {
    office,
    generatedAt: new Date().toISOString(),
    status: rows.some((row) => row.benchmarkOutlier) ? "REVIEW_OUTLIERS" : "OK",
    summary: {
      races: rows.length,
      benchmarkOutliers: rows.filter((row) => row.benchmarkOutlier).length,
      noPollingRows: rows.filter((row) => row.warnings.some((warning) => /poll/i.test(warning.message || warning.type || ""))).length
    },
    rows
  };
  writeJson(`data/diagnostics/benchmark-diff-${office}-2026.json`, payload);
  console.log(`Wrote benchmark diff diagnostics for ${office}.`);
}

