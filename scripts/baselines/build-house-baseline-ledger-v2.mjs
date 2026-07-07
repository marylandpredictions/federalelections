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

const audit = readJson("data/staging/baselines/house-current-map-baseline-audit-v2.json", { rows: [] });
const rows = (audit.rows || []).map((row) => ({
  raceId: row.raceId,
  district: row.district,
  state: row.state,
  mapVersion: row.mapVersion,
  baselineSourceType: row.baselineSourceType,
  baselineObservedYear: row.baselineObservedYear,
  baselineMargin: row.baselineMargin,
  marginType: "current-map-house-baseline",
  translationMethod: row.translationMethod,
  translationConfidence: row.translationConfidence,
  comparableFor2026: row.comparableFor2026,
  effectiveWeight: row.effectiveWeight ?? row.baselineEffectiveWeight,
  effectiveFor2026: row.effectiveFor2026,
  verificationStatus: row.verificationStatus,
  mapChangeFlags: row.mapChangeFlags || [],
  geometryHash: row.geometryHash,
  notes: row.notes,
  historicalContextOnly: !row.effectiveFor2026,
  verified: row.verified,
  confidence: row.confidence,
  reasons: row.reasons
}));

writeJson("data/staging/baselines/house-baseline-ledger-v2.json", {
  schemaVersion: "2026.house-baseline-ledger-v2.1",
  generatedAt: new Date().toISOString(),
  source: "data/staging/baselines/house-current-map-baseline-audit-v2.json",
  counts: {
    total: rows.length,
    effectiveFor2026: rows.filter((row) => row.effectiveFor2026).length,
    historicalContextOnly: rows.filter((row) => row.historicalContextOnly).length
  },
  rows
});

console.log(`Wrote House baseline ledger v2 with ${rows.length} districts.`);
