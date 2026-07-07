import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

const VARIANTS = [
  "polls_off",
  "ratings_off",
  "ratings_half",
  "ratings_full",
  "baseline_observed_only",
  "baseline_translated_only",
  "elasticity_half",
  "elasticity_full",
  "market_off",
  "correlation_low",
  "correlation_medium",
  "correlation_high"
];

function readJson(path, fallback = null) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function officeSnapshot(office, path, key) {
  const payload = readJson(path, {});
  const rows = payload?.[key] || [];
  return {
    office,
    path,
    generatedAt: payload.generatedAt || null,
    races: rows.length,
    demControlProbability: payload.demControlProbability ?? payload.demWinProbability ?? null,
    demSeats: payload.demSeats ?? payload.demMedianSeats ?? null,
    competitive: rows.filter((row) => Math.abs(Number(row.margin ?? row.probabilityEngineMargin ?? 99)) <= 5).length,
    noPolling: rows.filter((row) => !row.usablePollCount).length
  };
}

const base = [
  officeSnapshot("senate", "data/forecast.json", "races"),
  officeSnapshot("house", "data/house-forecast.json", "districts"),
  officeSnapshot("governor", "data/governor-forecast.json", "races")
];

const output = {
  schemaVersion: "2026.sensitivity-experiments-v2.1",
  generatedAt: new Date().toISOString(),
  mode: process.env.RUN_FULL_EXPERIMENTS === "1" ? "configured-for-full-rerun" : "shadow-plan",
  note: "This framework records pipeline-level variants and baseline snapshots. Set RUN_FULL_EXPERIMENTS=1 after generator variant hooks are enabled to execute full model re-runs.",
  variants: VARIANTS.map((variant) => ({
    variant,
    status: process.env.RUN_FULL_EXPERIMENTS === "1" ? "READY_FOR_RERUN" : "PLANNED",
    rerunCommands: [
      `FORECAST_CORE_V2=1 FORECAST_EXPERIMENT_VARIANT=${variant} node scripts/generate-forecast.mjs --core=v2`,
      `FORECAST_CORE_V2=1 FORECAST_EXPERIMENT_VARIANT=${variant} node scripts/generate-house-forecast.mjs --core=v2`,
      `FORECAST_CORE_V2=1 FORECAST_EXPERIMENT_VARIANT=${variant} node scripts/generate-governor-forecast.mjs --core=v2`
    ],
    base
  }))
};

writeJson("data/diagnostics/sensitivity-experiments-v2-2026.json", output);
console.log(`Wrote v2 sensitivity experiment framework with ${VARIANTS.length} variants.`);
