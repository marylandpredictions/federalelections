import { readFileSync } from "node:fs";

const URL = new URL("../data/forecast-benchmarks.json", import.meta.url);
let cache;

function inputs() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(URL, "utf8")); }
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
