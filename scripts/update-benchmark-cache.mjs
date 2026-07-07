import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TOPLINE_URL = new URL("../data/forecast-topline-benchmarks.json", import.meta.url);
const RACE_BENCHMARK_URL = new URL("../data/forecast-benchmarks.json", import.meta.url);
const HOUSE_RATINGS_URL = new URL("../data/cache/ratings/house-2026.json", import.meta.url);
const OUTPUT_URL = new URL("../data/cache/benchmarks/public-models-2026.json", import.meta.url);

const FORECAST_FILES = {
  house: new URL("../data/house-forecast.json", import.meta.url),
  senate: new URL("../data/forecast.json", import.meta.url),
  governor: new URL("../data/governor-forecast.json", import.meta.url)
};

function readJson(url, fallback = {}) {
  try {
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { ...fallback, readError: error.message };
  }
}

function daysSince(dateLike) {
  const time = new Date(dateLike || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return null;
  return (Date.now() - time) / 86400000;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sourceProbabilities(office, sources) {
  return Object.entries(sources || {}).map(([sourceKey, source]) => {
    const dem = Number(source.demControlProbability ?? source.demHouseProbability);
    const rep = Number(source.repControlProbability);
    const demProbability = Number.isFinite(dem) ? dem : Number.isFinite(rep) ? 1 - rep : null;
    return {
      sourceKey,
      source: source.source || sourceKey,
      asOf: source.asOf || null,
      demProbability: Number.isFinite(demProbability) ? Number(demProbability.toFixed(4)) : null,
      staleDays: daysSince(source.asOf || null),
      raw: source
    };
  }).filter((row) => Number.isFinite(row.demProbability));
}

function modelProbability(office) {
  const model = readJson(FORECAST_FILES[office], null);
  if (!model) return null;
  const dem = Number(model.demControlProbability ?? model.demProbability ?? model.demFavoredProbability);
  const rep = Number(model.repControlProbability ?? model.repProbability ?? model.repFavoredProbability);
  if (Number.isFinite(dem)) return dem;
  if (Number.isFinite(rep)) return 1 - rep;
  return null;
}

function releaseGate(office, modelDemProbability, benchmarkDemProbability, sources) {
  const staleSources = sources.filter((source) => Number.isFinite(source.staleDays) && source.staleDays > 30);
  const missingBenchmark = !Number.isFinite(benchmarkDemProbability);
  const missingModel = !Number.isFinite(modelDemProbability);
  const difference = Number.isFinite(modelDemProbability) && Number.isFinite(benchmarkDemProbability)
    ? modelDemProbability - benchmarkDemProbability
    : null;
  const blockThreshold = office === "senate" ? 0.12 : 0.15;
  const warnThreshold = office === "senate" ? 0.08 : 0.10;
  const reasons = [];
  if (missingBenchmark) reasons.push("NO_PUBLIC_TOPLINE_BENCHMARK");
  if (missingModel) reasons.push("NO_LOCAL_MODEL_TOPLINE");
  if (staleSources.length) reasons.push("PUBLIC_BENCHMARK_STALE_GT_30_DAYS");
  if (Number.isFinite(difference) && Math.abs(difference) >= blockThreshold) reasons.push("MODEL_PUBLIC_BENCHMARK_DIVERGENCE_BLOCK");
  else if (Number.isFinite(difference) && Math.abs(difference) >= warnThreshold) reasons.push("MODEL_PUBLIC_BENCHMARK_DIVERGENCE_WARN");
  const releaseStatus = reasons.some((reason) => reason.includes("BLOCK") || reason.includes("STALE") || reason.includes("NO_PUBLIC"))
    ? "BLOCK_REVIEW"
    : reasons.length
      ? "WARN_REVIEW"
      : "OK";
  return {
    releaseStatus,
    difference: Number.isFinite(difference) ? Number(difference.toFixed(4)) : null,
    reasons,
    thresholds: { warn: warnThreshold, block: blockThreshold }
  };
}

const topline = readJson(TOPLINE_URL, {});
const raceBenchmarks = readJson(RACE_BENCHMARK_URL, {});
const houseRatings = readJson(HOUSE_RATINGS_URL, { rows: [] });
const offices = ["house", "senate", "governor"];
const toplineRows = {};

for (const office of offices) {
  const sources = sourceProbabilities(office, topline[office] || {});
  const benchmarkDemProbability = median(sources.map((source) => source.demProbability));
  const localModelDemProbability = modelProbability(office);
  toplineRows[office] = {
    office,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: topline.updatedAt || null,
    sourceCount: sources.length,
    sources,
    benchmarkMedianProbability: Number.isFinite(benchmarkDemProbability) ? Number(benchmarkDemProbability.toFixed(4)) : null,
    localModelDemProbability: Number.isFinite(localModelDemProbability) ? Number(localModelDemProbability.toFixed(4)) : null,
    releaseGate: releaseGate(office, localModelDemProbability, benchmarkDemProbability, sources)
  };
}

const raceCount = Object.keys(raceBenchmarks.races || {}).length;
mkdirSync(new URL("../data/cache/benchmarks/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_URL, `${JSON.stringify({
  schemaVersion: "2026.public-model-benchmark-cache.1",
  generatedAt: new Date().toISOString(),
  sourceFiles: {
    topline: "data/forecast-topline-benchmarks.json",
    raceBenchmarks: "data/forecast-benchmarks.json",
    houseRatings: "data/cache/ratings/house-2026.json"
  },
  sourceUpdatedAt: {
    topline: topline.updatedAt || null,
    raceBenchmarks: raceBenchmarks.updatedAt || null,
    houseRatings: houseRatings.generatedAt || houseRatings.updatedAt || null
  },
  releasePolicy: {
    staleBenchmarkDays: 30,
    houseBlockDifference: 0.15,
    senateBlockDifference: 0.12,
    governorBlockDifference: 0.15
  },
  topline: toplineRows,
  raceBenchmarkCount: raceCount,
  cachedHouseRatings: (houseRatings.rows || []).length
}, null, 2)}\n`);

console.log(`Wrote public benchmark cache to ${OUTPUT_URL.pathname}`);
