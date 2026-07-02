import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const CACHE_FRESHNESS_DAYS = {
  genericBallot: 7,
  racePolls: 14,
  ratings: 21,
  finance: 30,
  fundamentals: 365,
  forecast: 2
};

const DEFAULT_CACHE_ROOT = new URL("../data/cache/", import.meta.url);

export function cacheEnvelope({ source, office, cycle = 2026, rows = [], status = "OK_PARSED", asOf = null, warnings = [], generatedAt = new Date().toISOString(), meta = {} }) {
  return {
    schemaVersion: 1,
    source,
    office,
    cycle,
    generatedAt,
    asOf: asOf || generatedAt,
    status,
    rows: Array.isArray(rows) ? rows : [],
    warnings: Array.isArray(warnings) ? warnings : [],
    meta
  };
}

export function writeCacheFile(relativePath, payload) {
  const url = new URL(relativePath.replaceAll("\\", "/"), DEFAULT_CACHE_ROOT);
  mkdirSync(new URL("./", url), { recursive: true });
  writeFileSync(url, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return url;
}

export function readJsonIfExists(urlOrPath) {
  try {
    const url = typeof urlOrPath === "string"
      ? new URL(urlOrPath.replaceAll("\\", "/"), new URL("../", import.meta.url))
      : urlOrPath;
    if (!existsSync(url)) return null;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return null;
  }
}

export function cacheFreshnessRecord(label, cacheOrPath, maxAgeDays) {
  const cache = typeof cacheOrPath === "string" || cacheOrPath instanceof URL
    ? readJsonIfExists(cacheOrPath)
    : cacheOrPath;
  if (!cache) {
    return { label, status: "MISSING", maxAgeDays, ageDays: null, asOf: null, generatedAt: null };
  }
  const asOf = cache.asOf || cache.generatedAt || null;
  const ageDays = asOf ? (Date.now() - new Date(asOf).getTime()) / 86400000 : null;
  const stale = !Number.isFinite(ageDays) || ageDays > maxAgeDays;
  return {
    label,
    source: cache.source || null,
    status: stale ? "STALE" : "FRESH",
    cacheStatus: cache.status || "UNKNOWN",
    maxAgeDays,
    ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(2)) : null,
    asOf,
    generatedAt: cache.generatedAt || null,
    rowCount: Array.isArray(cache.rows) ? cache.rows.length : 0,
    warnings: Array.isArray(cache.warnings) ? cache.warnings : []
  };
}

export function forecastInputCacheFreshness(paths = {}) {
  const checks = [
    ["genericBallot", paths.genericBallot, CACHE_FRESHNESS_DAYS.genericBallot],
    ["racePolls", paths.polls, CACHE_FRESHNESS_DAYS.racePolls],
    ["ratings", paths.ratings, CACHE_FRESHNESS_DAYS.ratings],
    ["fundamentals", paths.fundamentals, CACHE_FRESHNESS_DAYS.fundamentals],
    ["finance", paths.finance, CACHE_FRESHNESS_DAYS.finance]
  ]
    .filter(([, path]) => Boolean(path))
    .map(([label, path, maxAge]) => cacheFreshnessRecord(label, path, maxAge));

  const staleInputWarnings = checks
    .filter((record) => record.status !== "FRESH")
    .map((record) => ({
      severity: record.status === "MISSING" ? "warning" : "review",
      type: "STALE_INPUTS",
      input: record.label,
      message: `${record.label} cache is ${record.status.toLowerCase()}${record.ageDays === null ? "" : ` (${record.ageDays} days old)`}.`
    }));

  const dated = checks
    .filter((record) => record.asOf)
    .sort((a, b) => new Date(a.asOf) - new Date(b.asOf));

  return {
    inputCacheFreshness: Object.fromEntries(checks.map((record) => [record.label, record])),
    oldestCriticalInput: dated[0] || null,
    staleInputWarnings
  };
}

export function marginDescriptor(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin)) return { value: null, party: null, display: "--" };
  const party = margin >= 0 ? "D" : "R";
  return {
    value: Number(margin.toFixed(2)),
    party,
    display: `${party}+${Math.abs(margin).toFixed(1)}`
  };
}

export function marginSplit(projectedResultMargin, probabilityMargin, ratingMargin = projectedResultMargin) {
  return {
    projectedResultMargin: marginDescriptor(projectedResultMargin),
    probabilityMargin: marginDescriptor(probabilityMargin),
    ratingMargin: marginDescriptor(ratingMargin)
  };
}

export function buildInputBalance(weights = {}) {
  const entries = Object.entries(weights)
    .map(([input, value]) => [input, Math.max(0, Number(value) || 0)])
    .filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const shares = Object.fromEntries(entries.map(([input, value]) => [input, total ? Number((value / total).toFixed(3)) : 0]));
  const rawWeights = Object.fromEntries(entries.map(([input, value]) => [input, Number(value.toFixed(3))]));
  const dominantInput = entries.sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    shares,
    rawWeights,
    dominantInput,
    fundamentalsWeight: shares.fundamentals || 0,
    nationalEnvironmentWeight: shares.nationalEnvironment || 0,
    pollingWeight: shares.polling || 0,
    ratingsWeight: shares.ratings || 0,
    financeWeight: shares.finance || 0,
    candidateWeight: shares.candidate || 0,
    ratingsHeavy: (shares.ratings || 0) >= 0.25
  };
}
