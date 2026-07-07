import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readHouseFundamentalsCacheMap, sourceBackedHouseBaselines } from "./house-input-caches.mjs";
import { applyTrustToBaseline } from "./house-baseline-trust.mjs";

const OUTPUT_URL = new URL("../../data/model-config/current-map-baselines-2026.json", import.meta.url);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function districtKey(value) {
  return String(value || "").replace(/-2026$/, "").toUpperCase();
}

function baselineSourceFor(row) {
  if (row?.manualOverride || /manual/i.test(String(row?.source || ""))) return "manual_override";
  if (row?.houseMargin2024Comparable !== false && Number.isFinite(finite(row?.houseMargin2024 ?? row?.congressionalMargin))) {
    return "2024_house_on_current_map";
  }
  if (Number.isFinite(finite(row?.presidentialMargin2024 ?? row?.presidentialMargin))) return "estimated_from_presidential_2024";
  return "missing";
}

function confidenceFor(row, baselineSource) {
  const raw = String(row?.confidence || row?.sourceConfidence || row?.redistrictingConfidence || "").toUpperCase();
  if (baselineSource === "manual_override") return "VERIFIED";
  if (baselineSource === "2024_house_on_current_map" && ["HIGH", "VERIFIED", "MEDIUM"].includes(raw)) return "SOURCE_DECLARED";
  if (baselineSource === "estimated_from_presidential_2024") return "ESTIMATED";
  if (["CONFLICTING_SOURCES", "LOW", "UNKNOWN", "MISSING"].includes(raw)) return "UNVERIFIED";
  return baselineSource === "missing" ? "UNVERIFIED" : "ESTIMATED";
}

function geometryHash(parts) {
  return createHash("sha256").update(parts.filter((part) => part !== undefined && part !== null).join("|")).digest("hex").slice(0, 16);
}

export function buildCurrentMapBaselines({ mapHtml = "" } = {}) {
  const generated = sourceBackedHouseBaselines(mapHtml);
  const generatedByDistrict = new Map(generated.map((row) => [districtKey(row.district), row]));
  const fundamentals = readHouseFundamentalsCacheMap();
  const ids = new Set([
    ...generatedByDistrict.keys(),
    ...[...fundamentals.keys()].map(districtKey)
  ].filter(Boolean));

  const districts = [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((id) => {
    const generatedRow = generatedByDistrict.get(id) || {};
    const fundamentalsRow = fundamentals.get(id) || fundamentals.get(`${id}-2026`) || {};
    const row = { ...fundamentalsRow, ...generatedRow, district: id };
    const baselineSource = baselineSourceFor(row);
    const houseMargin = finite(row.houseMargin2024 ?? row.congressionalMargin);
    const presidentialMargin = finite(row.presidentialMargin2024 ?? row.presidentialMargin);
    const baselineMargin = baselineSource === "2024_house_on_current_map"
      ? houseMargin
      : baselineSource === "estimated_from_presidential_2024"
        ? presidentialMargin
        : finite(row.margin ?? row.fundamentalMargin);
    const confidence = confidenceFor(row, baselineSource);
    const mapVersion = row.mapVersion || "2025-current-congressional-map";
    const sourceDeclaredBaseline = {
      district: id,
      raceId: `${id}-2026`,
      state: id.slice(0, 2),
      baselineMargin: Number.isFinite(baselineMargin) ? Number(baselineMargin.toFixed(2)) : null,
      baselineParty: Number.isFinite(baselineMargin) ? (baselineMargin >= 0 ? "D" : "R") : null,
      baselineSource,
      mapVersion,
      confidence,
      sourceFields: {
        houseMargin2024: Number.isFinite(houseMargin) ? Number(houseMargin.toFixed(2)) : null,
        presidentialMargin2024: Number.isFinite(presidentialMargin) ? Number(presidentialMargin.toFixed(2)) : null,
        redistrictingConfidence: row.redistrictingConfidence || null,
        sources: row.sources || (row.source ? [row.source] : [])
      }
    };
    const trusted = applyTrustToBaseline(sourceDeclaredBaseline);
    return {
      ...trusted,
      geometryHash: geometryHash([
        id,
        mapVersion,
        baselineMargin,
        baselineSource,
        trusted.confidence,
        trusted.crosswalkAvailable,
        trusted.mapComparable,
        trusted.effectiveFor2026,
        trusted.baselineEffectiveWeight
      ])
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    description: "Current-map House baseline ledger generated from source-backed House fundamentals. Baselines with effectiveFor2026=false are diagnostics only.",
    districts
  };
}

export function readCurrentMapBaselineMap() {
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_URL, "utf8"));
    return new Map((parsed.districts || []).map((row) => [districtKey(row.district), row]));
  } catch {
    return new Map();
  }
}

export function currentMapBaselineForDistrict(districtId, map = readCurrentMapBaselineMap()) {
  return map.get(districtKey(districtId)) || null;
}

export function applyCurrentMapBaselineAnchor(anchor, baseline) {
  if (!baseline) return anchor;
  const trustFields = {
    crosswalkAvailable: baseline.crosswalkAvailable === true,
    mapComparable: baseline.mapComparable === true,
    useAsHistoricalContextOnly: baseline.useAsHistoricalContextOnly === true,
    baselineEffectiveWeight: Number.isFinite(Number(baseline.baselineEffectiveWeight)) ? Number(baseline.baselineEffectiveWeight) : null,
    trustReasons: baseline.trustReasons || [],
    trustPolicyVersion: baseline.trustPolicyVersion || null
  };
  if (baseline.effectiveFor2026 !== true) {
    return {
      ...anchor,
      currentMapBaseline: baseline,
      effectiveFor2026: false,
      confidence: baseline.confidence || anchor?.confidence || "UNVERIFIED",
      mapVersion: baseline.mapVersion || anchor?.mapVersion || null,
      baselineSource: baseline.baselineSource || anchor?.baselineSource || anchor?.source || null,
      ...trustFields
    };
  }
  const margin = finite(baseline.baselineMargin);
  const type = baseline.baselineSource === "2024_house_on_current_map"
    ? "CURRENT_MAP_HOUSE_2024"
    : baseline.baselineSource === "estimated_from_presidential_2024"
      ? "CURRENT_MAP_PRESIDENTIAL_2024"
      : "CURRENT_MAP_MANUAL";
  return {
    ...anchor,
    type,
    margin: Number.isFinite(margin) ? Number(margin.toFixed(2)) : anchor?.margin ?? null,
    source: baseline.baselineSource,
    baselineSource: baseline.baselineSource,
    mapVersion: baseline.mapVersion,
    effectiveFor2026: baseline.effectiveFor2026 === true,
    confidence: baseline.confidence || "UNVERIFIED",
    geometryHash: baseline.geometryHash || null,
    currentMapBaseline: baseline,
    ...trustFields
  };
}

export function writeCurrentMapBaselines() {
  const output = buildCurrentMapBaselines();
  mkdirSync(new URL("../../data/model-config/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT_URL, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = writeCurrentMapBaselines();
  console.log(`Wrote data/model-config/current-map-baselines-2026.json for ${output.districts.length} districts.`);
}
