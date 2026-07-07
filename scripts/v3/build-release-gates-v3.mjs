import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const BENCHMARK_BLOCK_THRESHOLD = Number(process.env.V3_BENCHMARK_BLOCK_THRESHOLD || 0.15);

function readJson(path, fallback = {}) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { ...fallback, readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function gate(name, status, details = {}) {
  return { name, status, ...details };
}

function pass(name, details = {}) {
  return gate(name, "PASS", details);
}

function fail(name, details = {}) {
  return gate(name, "FAIL", details);
}

function review(name, details = {}) {
  return gate(name, "REVIEW", details);
}

function benchmarkReleaseStatus(forecast) {
  const comparison = forecast.benchmarkComparison || forecast.benchmarkDivergenceWarning || forecast.benchmarkDiffSummary?.toplineComparison || {};
  const releaseStatus = String(comparison.releaseStatus || comparison.releaseGate?.releaseStatus || "OK").toUpperCase();
  const rawDiff = comparison.difference ?? comparison.releaseGate?.difference;
  const diff = rawDiff === null || rawDiff === undefined ? null : Number(rawDiff);
  return {
    releaseStatus,
    difference: Number.isFinite(diff) ? diff : null,
    absoluteDifference: Number.isFinite(diff) ? Math.abs(diff) : null,
    reasons: comparison.releaseGate?.reasons || [],
    warning: comparison.warning || null
  };
}

function forecastDates() {
  return {
    senate: readJson("data/forecast.json").generatedAt || null,
    house: readJson("data/house-forecast.json").generatedAt || null,
    governor: readJson("data/governor-forecast.json").generatedAt || null
  };
}

function noPollRaceCount(rows) {
  return rows.filter((row) => !row.usablePollCount).length;
}

export function main() {
  const senate = readJson("data/forecast.json", { races: [] });
  const house = readJson("data/house-forecast.json", { districts: [] });
  const governor = readJson("data/governor-forecast.json", { races: [] });
  const pollLedger = readJson("data/staging/polls/live-general-ledger-v3.json", { counts: {}, rows: [] });
  const baselineLedger = readJson("data/staging/baselines/house-baseline-ledger-v3.json", { counts: {}, mode: null, rows: [] });
  const financeLedger = readJson("data/staging/finance/race-finance-ledger-v3.json", { counts: {}, rows: [] });
  const houseSanity = readJson("data/diagnostics/house-probability-sanity-v3-2026.json", {});
  const senateProvenance = readJson("data/diagnostics/senate-provenance-consistency-v3-2026.json", {});
  const governorProvenance = readJson("data/diagnostics/governor-provenance-consistency-v3-2026.json", {});
  const sensitivity = readJson("data/diagnostics/sensitivity-experiments-v3-2026.json", { variants: [] });

  const benchmark = {
    senate: benchmarkReleaseStatus(senate),
    house: benchmarkReleaseStatus(house),
    governor: benchmarkReleaseStatus(governor)
  };
  const houseBaselineModeSafe = house.currentMode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES"
    && house.forecastStatus === "REVIEW_RATINGS_FIRST_NO_CURRENT_MAP_BASELINES";
  const allSensitivityExecuted = sensitivity.variants?.length >= 12
    && sensitivity.variants.every((variant) => variant.status === "EXECUTED");
  const financePlaceholdersInactive = (financeLedger.counts?.activeRaceLevelRows || 0) === 0
    && (financeLedger.rows || []).every((row) => row.v3Active !== true || row.effect === "AVAILABLE_RACE_LEVEL_CANDIDATE_FINANCE");
  const benchmarkGates = Object.entries(benchmark).map(([office, item]) => {
    if (item.releaseStatus.includes("BLOCK") || (item.absoluteDifference !== null && item.absoluteDifference > BENCHMARK_BLOCK_THRESHOLD)) {
      return fail(`${office}-benchmark-divergence`, {
        releaseStatus: item.releaseStatus,
        difference: item.difference,
        threshold: BENCHMARK_BLOCK_THRESHOLD,
        reasons: item.reasons,
        warning: item.warning
      });
    }
    return pass(`${office}-benchmark-divergence`, {
      releaseStatus: item.releaseStatus,
      difference: item.difference,
      threshold: BENCHMARK_BLOCK_THRESHOLD
    });
  });

  const gates = [
    pass("v3-output-readable", {
      forecastGeneratedAt: forecastDates(),
      raceCounts: {
        senate: (senate.races || []).length,
        house: (house.districts || []).length,
        governor: (governor.races || []).length
      }
    }),
    senateProvenance.status === "PASS"
      ? pass("senate-poll-provenance", { validatedRows: senateProvenance.validatedSenatePollRows, noPollRaces: noPollRaceCount(senate.races || []) })
      : fail("senate-poll-provenance", senateProvenance),
    governorProvenance.status === "PASS"
      ? pass("governor-poll-provenance", { validatedRows: governorProvenance.validatedGovernorPollRows, pollRaces: governorProvenance.governorRacesWithValidatedPolls, noPollRaces: noPollRaceCount(governor.races || []) })
      : fail("governor-poll-provenance", governorProvenance),
    houseBaselineModeSafe
      ? review("house-current-map-baseline-coverage", {
        mode: house.currentMode,
        verifiedCurrentMapBaselineCount: baselineLedger.counts?.verifiedCurrentMapBaselineCount || 0,
        total: baselineLedger.counts?.total || 0,
        note: "Coverage is effectively zero, but v3 is explicitly running in ratings-first no-current-map-baselines mode."
      })
      : fail("house-current-map-baseline-coverage", {
        mode: house.currentMode,
        verifiedCurrentMapBaselineCount: baselineLedger.counts?.verifiedCurrentMapBaselineCount || 0,
        total: baselineLedger.counts?.total || 0,
        requiredMode: "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES"
      }),
    houseSanity.status === "PASS"
      ? pass("house-probability-calibration", {
        expectedDemSeatsFromDistrictProbabilities: houseSanity.expectedDemSeatsFromDistrictProbabilities,
        simulatorExpectedDemSeats: houseSanity.simulatorExpectedDemSeats,
        unsafeSafeSeats: houseSanity.unsafeSafeSeats?.length || 0
      })
      : fail("house-probability-calibration", houseSanity),
    financePlaceholdersInactive
      ? pass("finance-placeholder-suppression", {
        activeRaceLevelRows: financeLedger.counts?.activeRaceLevelRows || 0,
        inactiveRows: financeLedger.counts?.inactiveRows || 0
      })
      : fail("finance-placeholder-suppression", financeLedger.counts || {}),
    allSensitivityExecuted
      ? pass("sensitivity-experiments-executed", { variants: sensitivity.variants.length })
      : fail("sensitivity-experiments-executed", { variants: sensitivity.variants?.length || 0 }),
    ...benchmarkGates
  ];
  const hasFail = gates.some((item) => item.status === "FAIL");
  const hasReview = gates.some((item) => item.status === "REVIEW");
  const output = {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    status: hasFail ? "FAIL" : hasReview ? "REVIEW" : "PASS",
    releaseRecommendation: hasFail
      ? "BLOCK_PUBLISH_REVIEW_REQUIRED"
      : hasReview ? "ALLOW_INTERNAL_REVIEW_ONLY" : "ALLOW_PUBLISH",
    pollLedgerCounts: pollLedger.counts || {},
    baselineLedgerMode: baselineLedger.mode,
    financeLedgerCounts: financeLedger.counts || {},
    benchmarkDivergenceSummary: benchmark,
    gates
  };
  writeJson("data/diagnostics/release-gates-v3-2026.json", output);
  console.log(`Release gates v3: ${output.status} (${output.releaseRecommendation})`);
  if (process.env.STRICT_RELEASE_GATES === "1" && output.status === "FAIL") process.exitCode = 1;
}

main();
