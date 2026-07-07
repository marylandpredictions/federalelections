import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const GENERATED_SOURCE = "generated-forecast-output";
const HOUSE_BASELINE_THRESHOLD = Number(process.env.HOUSE_BASELINE_COVERAGE_THRESHOLD || 0.65);
const BENCHMARK_DIVERGENCE_THRESHOLD = Number(process.env.BENCHMARK_DIVERGENCE_THRESHOLD || 8);

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

function gate(name, passed, details = {}) {
  return { name, status: passed ? "PASS" : "FAIL", ...details };
}

function upstreamCounts() {
  const counts = {};
  for (const office of ["senate", "house", "governor", "generic-ballot"]) {
    const ledger = readJson(`data/cache/polls/upstream-canonical-${office}-2026.json`, { rows: [] });
    counts[office] = {
      rows: Array.isArray(ledger.rows) ? ledger.rows.length : 0,
      usedInModel: Array.isArray(ledger.rows) ? ledger.rows.filter((row) => row.usedInModel !== false).length : 0,
      generatedAt: ledger.generatedAt || null
    };
  }
  return counts;
}

function forecastDates() {
  return {
    senate: readJson("data/forecast.json", {})?.generatedAt || null,
    house: readJson("data/house-forecast.json", {})?.generatedAt || null,
    governor: readJson("data/governor-forecast.json", {})?.generatedAt || null
  };
}

function benchmarkDivergence(payload) {
  const comparison = payload?.benchmarkComparison || payload?.benchmarkDiffSummary?.toplineComparison || {};
  const values = [
    comparison.demControlDifference,
    comparison.controlProbabilityDifference,
    comparison.demSeatDifference,
    comparison.demFavoredRaceDifference,
    Number.isFinite(Number(comparison.difference)) ? Number(comparison.difference) * 100 : null,
    Number.isFinite(Number(comparison.releaseGate?.difference)) ? Number(comparison.releaseGate.difference) * 100 : null
  ].map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values.map(Math.abs)) : null;
}

function benchmarkReleaseStatus(payload) {
  const comparison = payload?.benchmarkComparison || payload?.benchmarkDiffSummary?.toplineComparison || {};
  return String(comparison.releaseStatus || comparison.releaseGate?.releaseStatus || "OK").toUpperCase();
}

function manualReviewRows() {
  const rows = [];
  for (const [office, path, key] of [
    ["senate", "data/forecast.json", "races"],
    ["house", "data/house-forecast.json", "districts"],
    ["governor", "data/governor-forecast.json", "races"]
  ]) {
    const payload = readJson(path, {});
    for (const race of payload?.[key] || []) {
      const warnings = [
        ...(race.modelWarnings || []),
        ...(race.dataQualityWarnings || []),
        ...(race.sanityWarnings || [])
      ];
      const benchmark = race.benchmarkComparison?.status === "REVIEW" || race.benchmarkComparison?.warning;
      const source = race.raceSourceHealth?.status === "DEGRADED" || race.pollingStatus === "SOURCE_FAILURE";
      if (warnings.length || benchmark || source || race.historicalComparison?.needsReview) {
        rows.push({
          office,
          raceId: race.id || race.state || race.district,
          state: race.state || null,
          severity: warnings.some((warning) => warning.severity === "high") ? "high" : "review",
          reasons: [
            ...warnings.map((warning) => warning.type || warning.message || "warning"),
            ...(benchmark ? ["benchmark-divergence"] : []),
            ...(source ? ["degraded-source-health"] : []),
            ...(race.historicalComparison?.needsReview ? ["historical-margin-discrepancy"] : [])
          ].filter(Boolean)
        });
      }
    }
  }
  return rows.slice(0, 15);
}

const canonical = readJson("data/cache/polls/canonical-2026.json", { rows: [] });
const upstream = readJson("data/cache/polls/upstream-canonical-2026.json", { rows: [] });
const baseline = readJson("data/staging/baselines/house-baseline-ledger-v2.json", { rows: [], counts: {} });
const senate = readJson("data/forecast.json", {});
const house = readJson("data/house-forecast.json", {});
const governor = readJson("data/governor-forecast.json", {});
const candidateSync = readJson("data/diagnostics/candidate-primary-sync-v2-2026.json", { counts: {} });

const generatedRows = [...(canonical.rows || []), ...(upstream.rows || [])].filter((row) => row.sourceKind === GENERATED_SOURCE);
const baselineCoverage = baseline.rows?.length ? (baseline.counts?.effectiveFor2026 || 0) / baseline.rows.length : 0;
const divergences = {
  senate: benchmarkDivergence(senate),
  house: benchmarkDivergence(house),
  governor: benchmarkDivergence(governor)
};
const benchmarkStatuses = {
  senate: benchmarkReleaseStatus(senate),
  house: benchmarkReleaseStatus(house),
  governor: benchmarkReleaseStatus(governor)
};

const gates = [
  gate("upstream-polls-only", generatedRows.length === 0, { generatedForecastRows: generatedRows.length }),
  gate("canonical-ledger-provenance", Array.isArray(upstream.rows) && upstream.rows.every((row) => row.sourceName && row.raceId), { rows: upstream.rows?.length || 0 }),
  gate("house-current-map-baseline-coverage", baselineCoverage >= HOUSE_BASELINE_THRESHOLD, { coverage: Number(baselineCoverage.toFixed(4)), threshold: HOUSE_BASELINE_THRESHOLD, effectiveFor2026: baseline.counts?.effectiveFor2026 || 0, total: baseline.rows?.length || 0 }),
  gate("candidate-primary-freshness", (candidateSync.counts?.candidates || 0) > 0, { candidates: candidateSync.counts?.candidates || 0, reviewRequired: candidateSync.counts?.reviewRequired || 0 }),
  gate("senate-benchmark-divergence", !benchmarkStatuses.senate.includes("BLOCK") && (divergences.senate === null || divergences.senate <= BENCHMARK_DIVERGENCE_THRESHOLD), { maxDivergence: divergences.senate, threshold: BENCHMARK_DIVERGENCE_THRESHOLD, releaseStatus: benchmarkStatuses.senate }),
  gate("house-benchmark-divergence", !benchmarkStatuses.house.includes("BLOCK") && (divergences.house === null || divergences.house <= BENCHMARK_DIVERGENCE_THRESHOLD), { maxDivergence: divergences.house, threshold: BENCHMARK_DIVERGENCE_THRESHOLD, releaseStatus: benchmarkStatuses.house }),
  gate("governor-benchmark-divergence", !benchmarkStatuses.governor.includes("BLOCK") && (divergences.governor === null || divergences.governor <= BENCHMARK_DIVERGENCE_THRESHOLD), { maxDivergence: divergences.governor, threshold: BENCHMARK_DIVERGENCE_THRESHOLD, releaseStatus: benchmarkStatuses.governor })
];

const output = {
  schemaVersion: "2026.release-gates-v2.1",
  generatedAt: new Date().toISOString(),
  status: gates.every((item) => item.status === "PASS") ? "PASS" : "FAIL",
  forecastGeneratedAt: forecastDates(),
  upstreamPollCounts: upstreamCounts(),
  houseVerifiedCurrentMapBaselineCoverage: Number(baselineCoverage.toFixed(4)),
  benchmarkDivergenceSummary: divergences,
  benchmarkReleaseStatus: benchmarkStatuses,
  gates,
  manualReviewTop15: manualReviewRows()
};

writeJson("data/diagnostics/release-gates-2026.json", output);
console.log(`Release gates v2: ${output.status}`);
if (process.env.STRICT_RELEASE_GATES === "1" && output.status !== "PASS") {
  process.exitCode = 1;
}
