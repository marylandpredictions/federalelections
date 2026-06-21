import { readFileSync } from "node:fs";

const BENCHMARK_URL = new URL("../data/forecast-benchmarks.json", import.meta.url);
const TOPLINE_URL = new URL("../data/forecast-topline-benchmarks.json", import.meta.url);
let cache;

function inputs() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(BENCHMARK_URL, "utf8")); }
  catch { cache = { races: {} }; }
  return cache;
}

export function benchmarkFor(raceId) {
  return inputs().races?.[raceId] || null;
}

export function benchmarkWarnings(benchmark, modelMargin, demProbability) {
  if (!benchmark) return ["no-external-benchmark-sources"];
  const warnings = [];
  const sources = Object.values(benchmark).filter((value) => value && typeof value === "object");
  if (!sources.length) warnings.push("no-external-benchmark-sources");
  const numericMargins = sources.map((source) => Number(source.margin)).filter(Number.isFinite);
  const numericProbabilities = sources.map((source) => Number(source.demProbability ?? source.probability)).filter(Number.isFinite);
  if (numericMargins.length && Math.abs(modelMargin - numericMargins.reduce((sum, value) => sum + value, 0) / numericMargins.length) >= 5) warnings.push("model-margin-differs-from-benchmark-consensus");
  if (numericProbabilities.length && Math.abs(demProbability - numericProbabilities.reduce((sum, value) => sum + value, 0) / numericProbabilities.length) >= .15) warnings.push("model-probability-differs-from-benchmark-consensus");
  if (sources.some((source) => source.asOf && (Date.now() - new Date(source.asOf).getTime()) / 86400000 > 30)) warnings.push("external-benchmark-stale");
  return warnings;
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
