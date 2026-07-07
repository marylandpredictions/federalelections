import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

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

const source = readJson("data/model-config/current-map-baselines-2026.json", { districts: [] });
const districts = Array.isArray(source.districts) ? source.districts : [];
const auditRows = districts.map((district) => {
  const comparable = district.crosswalkAvailable === true || district.mapComparable === true || district.effectiveFor2026 === true;
  const verified = comparable && !["UNVERIFIED", "LOW_CONFIDENCE"].includes(String(district.confidence || "").toUpperCase());
  const effectiveWeight = verified ? 1 : comparable ? 0.35 : 0;
  return {
    district: district.district,
    raceId: district.raceId || `${district.district}-2026`,
    state: district.state || String(district.district || "").slice(0, 2),
    mapVersion: district.mapVersion || null,
    baselineSourceType: district.baselineSource || null,
    baselineObservedYear: district.baselineObservedYear || district.sourceFields?.year || 2024,
    baselineMargin: Number.isFinite(Number(district.baselineMargin)) ? Number(district.baselineMargin) : null,
    translationMethod: district.translationMethod || (district.crosswalkAvailable ? "source-current-map-crosswalk" : "historical-context-only"),
    translationConfidence: district.confidence || null,
    comparableFor2026: comparable,
    effectiveWeight,
    verificationStatus: verified ? "VERIFIED_CURRENT_MAP" : comparable ? "PARTIAL_TRANSLATED_CURRENT_MAP" : "DIAGNOSTIC_ONLY",
    mapChangeFlags: district.mapChangeFlags || district.trustReasons || [],
    geometryHash: district.geometryHash || null,
    notes: district.notes || null,
    baselineSource: district.baselineSource || null,
    confidence: district.confidence || null,
    crosswalkAvailable: Boolean(district.crosswalkAvailable),
    mapComparable: Boolean(district.mapComparable),
    verified,
    effectiveFor2026: effectiveWeight > 0,
    baselineEffectiveWeight: effectiveWeight,
    reasons: [
      ...(district.trustReasons || []),
      ...(verified ? ["verified-current-map-baseline"] : comparable ? ["partial-current-map-comparability"] : ["not-current-map-comparable"])
    ]
  };
});

const counts = auditRows.reduce((acc, row) => {
  acc.total += 1;
  if (row.verified) acc.verified += 1;
  if (row.effectiveFor2026) acc.effective += 1;
  if (!row.effectiveFor2026) acc.historicalOnly += 1;
  return acc;
}, { total: 0, verified: 0, effective: 0, historicalOnly: 0 });

const output = {
  schemaVersion: "2026.house-baseline-audit-v2.1",
  generatedAt: new Date().toISOString(),
  source: "data/model-config/current-map-baselines-2026.json",
  counts,
  rows: auditRows
};

writeJson("data/staging/baselines/house-current-map-baseline-audit-v2.json", output);
writeJson("data/diagnostics/house-baseline-audit-v2-2026.json", output);

console.log(`Audited House baselines: ${counts.verified} verified, ${counts.effective} model-effective, ${counts.historicalOnly} historical-only.`);
