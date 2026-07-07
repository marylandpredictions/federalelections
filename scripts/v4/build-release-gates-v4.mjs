import {
  artifactRunProblems,
  canonicalToplineProblems,
  readJson,
  readLatestManifestOrCreate,
  validateReviewHashes,
  writeJson,
  artifactHeader
} from "./shared/v4-core.mjs";

const RELEASE_ARTIFACTS = [
  "houseForecast",
  "senateForecast",
  "governorForecast",
  "houseDiagnostics",
  "senateDiagnostics",
  "governorDiagnostics",
  "diagnosticsSummary",
  "houseReview",
  "senateReview",
  "governorReview",
  "houseSimulation",
  "houseCurrentMapBaselineLedger",
  "houseRedistrictingStatusLedger",
  "houseBenchmarks",
  "senateBenchmarks",
  "governorBenchmarks",
  "benchmarkSummary"
];

function reasonCode(problem) {
  return String(problem).split(":")[0];
}

function addUnique(target, problem) {
  if (!target.includes(problem)) target.push(problem);
}

export function evaluateReleaseGatesV4(manifest = readLatestManifestOrCreate()) {
  const problems = [];
  const artifacts = {};
  for (const key of RELEASE_ARTIFACTS) {
    const path = manifest.artifacts[key];
    const artifact = readJson(path);
    artifacts[key] = artifact;
    for (const problem of artifactRunProblems(manifest, artifact, path)) addUnique(problems, problem);
  }

  for (const key of ["houseForecast", "senateForecast", "governorForecast"]) {
    for (const problem of canonicalToplineProblems(artifacts[key])) addUnique(problems, problem);
  }

  for (const [forecastKey, reviewKey] of [
    ["houseForecast", "houseReview"],
    ["senateForecast", "senateReview"],
    ["governorForecast", "governorReview"]
  ]) {
    for (const problem of validateReviewHashes(artifacts[forecastKey], artifacts[reviewKey])) addUnique(problems, problem);
  }

  const baselineLedger = readJson("data/v4/house/current-map-baseline-ledger.json");
  if (!baselineLedger || (baselineLedger.counts?.verifiedCurrentMapAnchors || 0) === 0) {
    addUnique(problems, "HOUSE_NO_CURRENT_MAP_BASELINES");
  }
  const benchmarkSummary = artifacts.benchmarkSummary;
  if (!benchmarkSummary || Object.values(benchmarkSummary.chamberStatus || {}).some((status) => status === "BENCHMARK_UNAVAILABLE")) {
    addUnique(problems, "BENCHMARK_FIELD_MISSING");
  }
  if (artifacts.houseForecast?.houseMode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES") {
    addUnique(problems, "INTERNAL_QA_ONLY_HOUSE_MODE");
  }

  const blockingReasons = [...new Set(problems.map(reasonCode))].filter((code) => code !== "INTERNAL_QA_ONLY_HOUSE_MODE");
  const publishStatus = blockingReasons.length > 0 ? "BLOCK_PUBLISH" : problems.includes("INTERNAL_QA_ONLY_HOUSE_MODE") ? "INTERNAL_QA_ONLY" : "PASS";
  return {
    ...artifactHeader(manifest, "release-gate-summary"),
    publishStatus,
    blockingReasons,
    detailedProblems: problems,
    evaluatedArtifacts: Object.fromEntries(RELEASE_ARTIFACTS.map((key) => [key, manifest.artifacts[key]]))
  };
}

export function buildReleaseGatesV4(manifest = readLatestManifestOrCreate()) {
  const summary = evaluateReleaseGatesV4(manifest);
  writeJson("data/v4/release-gates/release-gate-summary.json", summary);
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const summary = buildReleaseGatesV4();
  console.log(`v4 release gate: ${summary.publishStatus}`);
}
