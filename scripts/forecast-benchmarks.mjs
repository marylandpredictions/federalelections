import { readFileSync } from "node:fs";

const BENCHMARK_URL = new URL("../data/forecast-benchmarks.json", import.meta.url);
const TOPLINE_URL = new URL("../data/forecast-topline-benchmarks.json", import.meta.url);
const HOUSE_RATINGS_CACHE_URL = new URL("../data/cache/ratings/house-2026.json", import.meta.url);
let cache;
let houseRatingsCache;

function inputs() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(BENCHMARK_URL, "utf8")); }
  catch { cache = { races: {} }; }
  return cache;
}

function houseRatingInputs() {
  if (houseRatingsCache) return houseRatingsCache;
  try { houseRatingsCache = JSON.parse(readFileSync(HOUSE_RATINGS_CACHE_URL, "utf8")); }
  catch { houseRatingsCache = { rows: [] }; }
  return houseRatingsCache;
}

function benchmarkFromHouseCache(raceId) {
  const row = (houseRatingInputs().rows || []).find((item) => item.raceId === raceId);
  if (!row || !row.rating) return null;
  const sources = row.sources && typeof row.sources === "object" ? row.sources : {};
  return {
    ...sources,
    consensusRating: row.rating,
    cacheMeta: {
      ratingSourceType: row.ratingSourceType || null,
      status: row.status || null,
      sourceCount: row.sourceCount || Object.keys(sources).length,
      baselineConfidence: row.baselineConfidence || null,
      asOf: row.asOf || null
    }
  };
}

export function benchmarkFor(raceId) {
  const manual = inputs().races?.[raceId] || null;
  const houseCache = /-(?:AL|\d{2})-2026$/.test(raceId) ? benchmarkFromHouseCache(raceId) : null;
  if (!houseCache) return manual;
  if (!manual) return houseCache;
  return {
    ...houseCache,
    ...manual,
    cacheMeta: {
      ...(houseCache.cacheMeta || {}),
      manualBenchmarkConfigured: true
    }
  };
}

export function benchmarkConfiguration() {
  const races = inputs().races || {};
  const houseRows = houseRatingInputs().rows || [];
  const houseSources = houseRows.flatMap((row) => Object.values(row.sources || {}));
  return {
    status: Object.keys(races).length || houseRows.length ? "CONFIGURED" : "EMPTY",
    updatedAt: inputs().updatedAt || null,
    configuredRaces: Object.keys(races).length,
    cachedHouseRatings: houseRows.length,
    cachedHouseExternalRatings: houseRows.filter((row) => row.ratingSourceType === "EXTERNAL_RATING").length,
    cachedHouseInferredSafeRatings: houseRows.filter((row) => row.ratingSourceType === "INFERRED_SAFE_RATING").length,
    cachedHouseVoteHubRatings: houseSources.filter((source) => source.sourceKey === "voteHub").length,
    cachedHouseAggregatorRatings: houseSources.filter((source) => source.sourceType === "AGGREGATOR_TABLE").length
  };
}

export function benchmarkWarnings(benchmark, modelMargin, demProbability) {
  if (!benchmark) return ["no-external-benchmark-sources"];
  const warnings = [];
  const sources = Object.entries(benchmark)
    .filter(([key, value]) => key !== "cacheMeta" && value && typeof value === "object")
    .map(([, value]) => value);
  if (!sources.length) warnings.push("no-external-benchmark-sources");
  const numericMargins = sources.map((source) => Number(source.margin)).filter(Number.isFinite);
  const numericProbabilities = sources.map((source) => Number(source.demProbability ?? source.probability)).filter(Number.isFinite);
  if (numericMargins.length && Math.abs(modelMargin - numericMargins.reduce((sum, value) => sum + value, 0) / numericMargins.length) >= 5) warnings.push("model-margin-differs-from-benchmark-consensus");
  if (numericProbabilities.length && Math.abs(demProbability - numericProbabilities.reduce((sum, value) => sum + value, 0) / numericProbabilities.length) >= .15) warnings.push("model-probability-differs-from-benchmark-consensus");
  const modelRating = ratingFromMargin(modelMargin);
  for (const source of sources) {
    if (!source.rating) continue;
    const externalRating = normalizeRating(source.rating);
    if (!externalRating) continue;
    const model = normalizeRating(modelRating);
    const opposite = model.party && externalRating.party && model.party !== externalRating.party;
    const categoryGap = Math.abs(model.rank - externalRating.rank);
    if ((opposite && (model.rank >= 2 || externalRating.rank >= 2)) || categoryGap >= 2) {
      warnings.push(`rating-divergence:${modelRating}:${source.rating}`);
    }
  }
  if (sources.some((source) => source.asOf && (Date.now() - new Date(source.asOf).getTime()) / 86400000 > 30)) warnings.push("external-benchmark-stale");
  return warnings;
}

function ratingFromMargin(margin) {
  if (!Number.isFinite(modelMarginValue(margin))) return "Toss-up";
  const value = modelMarginValue(margin);
  const party = value >= 0 ? "D" : "R";
  const abs = Math.abs(value);
  return `${abs >= 14 ? "Safe" : abs >= 7 ? "Likely" : abs >= 3 ? "Lean" : abs >= 1 ? "Tilt" : "Toss-up"}${abs < 1 ? "" : ` ${party}`}`;
}

function modelMarginValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRating(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("toss")) return { rank: 0, party: null };
  const party = /\b(d|dem|blue)\b/.test(text) ? "D" : /\b(r|rep|red)\b/.test(text) ? "R" : null;
  const rank = text.includes("safe") || text.includes("solid") ? 4 : text.includes("likely") ? 3 : text.includes("lean") ? 2 : text.includes("tilt") ? 1 : 0;
  return party || rank === 0 ? { rank, party } : null;
}

export function toplineBenchmark(office, model = {}) {
  try {
    const inputs = JSON.parse(readFileSync(TOPLINE_URL, "utf8"));
    const sources = inputs[office] || {};
    const demProbabilities = Object.values(sources)
      .map((source) => Number(source.demControlProbability ?? source.demHouseProbability))
      .filter(Number.isFinite);
    const repProbabilities = Object.values(sources)
      .map((source) => Number(source.repControlProbability))
      .filter(Number.isFinite);
    const benchmarkDemProbability = demProbabilities.length ? demProbabilities.reduce((sum, value) => sum + value, 0) / demProbabilities.length
      : repProbabilities.length ? 1 - repProbabilities.reduce((sum, value) => sum + value, 0) / repProbabilities.length : null;
    const modelDemProbability = Number(model.demControlProbability);
    const difference = Number.isFinite(benchmarkDemProbability) && Number.isFinite(modelDemProbability)
      ? modelDemProbability - benchmarkDemProbability : null;
    const warning = Number.isFinite(difference) && Math.abs(difference) >= (office === "senate" ? .10 : .15)
      ? `${office === "house" ? "House" : office === "senate" ? "Senate" : "Governor"} model diverges sharply from public benchmarks.` : null;
    return {
      status: Object.keys(sources).length ? "CONFIGURED" : "NOT_CONFIGURED",
      updatedAt: inputs.updatedAt || null,
      sources,
      benchmarkDemProbability: Number.isFinite(benchmarkDemProbability) ? Number(benchmarkDemProbability.toFixed(4)) : null,
      modelDemProbability: Number.isFinite(modelDemProbability) ? Number(modelDemProbability.toFixed(4)) : null,
      difference: Number.isFinite(difference) ? Number(difference.toFixed(4)) : null,
      warning
    };
  } catch {
    return { status: "NOT_CONFIGURED", sources: {}, benchmarkDemProbability: null, modelDemProbability: null, difference: null, warning: null };
  }
}
