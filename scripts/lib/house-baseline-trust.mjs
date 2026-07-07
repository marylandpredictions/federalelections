import { readFileSync } from "node:fs";

const CONFIG_URL = new URL("../../data/model-config/house-baseline-trust-2026.json", import.meta.url);

const DEFAULT_CONFIG = {
  schemaVersion: "2026.house-baseline-trust.1",
  defaultPolicy: {
    crosswalkUnavailableIsHistoricalOnly: true,
    unverifiedBaselineEffectiveWeight: 0,
    lowConfidenceBaselineEffectiveWeight: 0.15,
    verifiedBaselineEffectiveWeight: 1
  },
  signals: {
    crosswalkUnavailable: ["crosswalk unavailable", "no current-map crosswalk", "pre-redistrict", "old district"],
    explicitlyVerified: ["manual override", "block-level", "precinct-level", "current-map certified", "same-shape", "unchanged district"],
    materialUncertainty: ["estimated", "reconstructed", "low confidence", "unknown"]
  },
  districtOverrides: {}
};

let configCache = null;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function districtKey(value) {
  return String(value || "").replace(/-2026$/i, "").toUpperCase();
}

function normalizeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    defaultPolicy: { ...DEFAULT_CONFIG.defaultPolicy, ...(config.defaultPolicy || {}) },
    signals: { ...DEFAULT_CONFIG.signals, ...(config.signals || {}) },
    districtOverrides: { ...DEFAULT_CONFIG.districtOverrides, ...(config.districtOverrides || {}) }
  };
}

export function loadHouseBaselineTrustConfig() {
  if (configCache) return configCache;
  try {
    configCache = normalizeConfig(JSON.parse(readFileSync(CONFIG_URL, "utf8")));
  } catch {
    configCache = normalizeConfig(DEFAULT_CONFIG);
  }
  return configCache;
}

function signalRegex(values = []) {
  const escaped = values
    .filter(Boolean)
    .map((value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return escaped.length ? new RegExp(escaped.join("|"), "i") : /$a/;
}

function trustText(row = {}) {
  return [
    row.district,
    row.baselineSource,
    row.source,
    row.mapVersion,
    row.confidence,
    row.sourceConfidence,
    row.redistrictingConfidence,
    row.crosswalkSource,
    row.geometrySource,
    ...(Array.isArray(row.sources) ? row.sources : []),
    ...(Array.isArray(row.sourceFields?.sources) ? row.sourceFields.sources : [])
  ].filter(Boolean).join(" ");
}

function overrideFor(row, config) {
  const keys = [
    districtKey(row.district),
    districtKey(row.raceId),
    String(row.raceId || "").toUpperCase()
  ].filter(Boolean);
  for (const key of keys) {
    if (config.districtOverrides?.[key]) return config.districtOverrides[key];
  }
  return null;
}

export function baselineTrustFor(row = {}, config = loadHouseBaselineTrustConfig()) {
  const text = trustText(row);
  const baselineSource = String(row.baselineSource || "").toLowerCase();
  const redistrictingConfidence = String(row.redistrictingConfidence || row.sourceFields?.redistrictingConfidence || "").toUpperCase();
  const hasMargin = finite(row.baselineMargin ?? row.margin) !== null;
  const override = overrideFor(row, config);
  const unavailableRegex = signalRegex(config.signals?.crosswalkUnavailable);
  const verifiedRegex = signalRegex(config.signals?.explicitlyVerified);
  const uncertaintyRegex = signalRegex(config.signals?.materialUncertainty);
  const crosswalkUnavailable = unavailableRegex.test(text);
  const explicitlyVerified = Boolean(override?.explicitlyVerified || verifiedRegex.test(text) || baselineSource === "manual_override");
  const materialUncertainty = Boolean(
    uncertaintyRegex.test(text)
    || /CONFLICT|SCENARIO|LITIGATION|PRE[-_ ]?REDISTRICT|OLD[_ -]?DISTRICT/i.test(`${text} ${redistrictingConfidence}`)
  );
  const missing = baselineSource === "missing" || !hasMargin;
  const reasons = [];

  if (missing) reasons.push("baseline-missing");
  if (crosswalkUnavailable) reasons.push("current-map-crosswalk-unavailable");
  if (materialUncertainty) reasons.push("material-map-or-source-uncertainty");
  if (explicitlyVerified) reasons.push("explicit-current-map-verification");

  if (override) {
    const confidence = String(override.confidence || "VERIFIED").toUpperCase();
    const effectiveFor2026 = override.effectiveFor2026 !== false && !missing;
    return {
      crosswalkAvailable: override.crosswalkAvailable !== false,
      mapComparable: override.mapComparable !== false,
      effectiveFor2026,
      confidence,
      useAsHistoricalContextOnly: !effectiveFor2026,
      baselineEffectiveWeight: Number(override.baselineEffectiveWeight ?? (effectiveFor2026 ? config.defaultPolicy.verifiedBaselineEffectiveWeight : 0)),
      trustReasons: [...reasons, "district-override"],
      trustPolicyVersion: config.schemaVersion
    };
  }

  if (missing) {
    return {
      crosswalkAvailable: false,
      mapComparable: false,
      effectiveFor2026: false,
      confidence: "UNVERIFIED",
      useAsHistoricalContextOnly: true,
      baselineEffectiveWeight: Number(config.defaultPolicy.unverifiedBaselineEffectiveWeight ?? 0),
      trustReasons: reasons,
      trustPolicyVersion: config.schemaVersion
    };
  }

  if (explicitlyVerified && !crosswalkUnavailable && !materialUncertainty) {
    return {
      crosswalkAvailable: true,
      mapComparable: true,
      effectiveFor2026: true,
      confidence: "VERIFIED",
      useAsHistoricalContextOnly: false,
      baselineEffectiveWeight: Number(config.defaultPolicy.verifiedBaselineEffectiveWeight ?? 1),
      trustReasons: reasons,
      trustPolicyVersion: config.schemaVersion
    };
  }

  if (crosswalkUnavailable || materialUncertainty) {
    return {
      crosswalkAvailable: false,
      mapComparable: false,
      effectiveFor2026: false,
      confidence: "LOW_CONFIDENCE",
      useAsHistoricalContextOnly: true,
      baselineEffectiveWeight: Number(config.defaultPolicy.lowConfidenceBaselineEffectiveWeight ?? 0.15),
      trustReasons: reasons,
      trustPolicyVersion: config.schemaVersion
    };
  }

  return {
    crosswalkAvailable: false,
    mapComparable: false,
    effectiveFor2026: false,
    confidence: "UNVERIFIED",
    useAsHistoricalContextOnly: true,
    baselineEffectiveWeight: Number(config.defaultPolicy.unverifiedBaselineEffectiveWeight ?? 0),
    trustReasons: [...reasons, "no-explicit-current-map-verification"],
    trustPolicyVersion: config.schemaVersion
  };
}

export function applyTrustToBaseline(row = {}, config = loadHouseBaselineTrustConfig()) {
  const trust = baselineTrustFor(row, config);
  return {
    ...row,
    ...trust,
    confidence: trust.confidence,
    effectiveFor2026: trust.effectiveFor2026
  };
}
