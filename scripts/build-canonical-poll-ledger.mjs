import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const POLL_CACHE_DIR = new URL("../data/cache/polls/", import.meta.url);
const OUTPUT_URL = new URL("../data/cache/polls/canonical-2026.json", import.meta.url);

const CACHE_FILES = [
  "upstream-canonical-2026.json"
];

function readJson(url) {
  try {
    if (!existsSync(url)) return null;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((item) => Array.isArray(item) ? item : []);
}

function sourceRows(payload) {
  return [
    ...asArray(payload?.rows),
    ...asArray(payload?.usableRows),
    ...asArray(payload?.quarantinedRows)
  ];
}

function rowTypeFor(row, cachePath) {
  const type = String(row?.rowType || row?.tableType || "").toUpperCase();
  if (type.includes("AVERAGE") || cachePath.includes("generic-ballot")) return "AVERAGE";
  if (type.includes("PRIMARY")) return "PRIMARY";
  if (type.includes("WIKIPEDIA")) return "INDIVIDUAL_GENERAL_ELECTION_POLL";
  return type.includes("POLL") || row?.pollster ? "INDIVIDUAL_GENERAL_ELECTION_POLL" : "OTHER";
}

function validationFor(row, cachePath, rowType) {
  const reasons = new Set((row?.rejectionReasons || []).map(String));
  const sourceText = `${row?.source || ""} ${row?.sourceKey || ""} ${row?.sourceTrust || ""} ${cachePath}`.toLowerCase();
  if (sourceText.includes("wikipedia")) return { status: "QUARANTINED", usedInModel: false, reason: "WIKIPEDIA_EXPERIMENTAL_DO_NOT_USE_IN_FORECAST" };
  if (sourceText.includes("legacy") || row?.legacy) return { status: "DIAGNOSTIC_ONLY", usedInModel: false, reason: "LEGACY_FALLBACK_EXCLUDED" };
  if (rowType === "AVERAGE") return { status: "DIAGNOSTIC_ONLY", usedInModel: false, reason: "POLLING_AVERAGE_NOT_RAW_POLL" };
  if (rowType !== "INDIVIDUAL_GENERAL_ELECTION_POLL") return { status: "DIAGNOSTIC_ONLY", usedInModel: false, reason: "NON_GENERAL_ELECTION_POLL_ROW" };
  if (row?.validationStatus === "QUARANTINED" || reasons.size) return { status: "QUARANTINED", usedInModel: false, reason: [...reasons].join(";") || row?.excludedReason || "QUARANTINED_BY_VALIDATION" };
  if (row?.validationStatus && !["USABLE", "VALID"].includes(row.validationStatus)) return { status: row.validationStatus, usedInModel: false, reason: row?.excludedReason || row.validationStatus };
  return { status: "VALID", usedInModel: row?.usedInModel !== false, reason: null };
}

function sourceTextTrust(row = {}, cachePath = "") {
  const text = `${row.sourceTrust || ""} ${row.sourceKey || ""} ${row.source || ""} ${cachePath}`.toLowerCase();
  if (text.includes("legacy")) return "LEGACY_FALLBACK";
  if (text.includes("wikipedia")) return "QUARANTINED";
  if (text.includes("manual")) return "MANUAL_VERIFIED";
  if (text.includes("270towin")) return "TRUSTED_SEMI_STRUCTURED";
  return row.sourceTrust || "CACHE_VALIDATED";
}

function officeUsedBy(office) {
  const normalized = String(office || "").toLowerCase();
  if (normalized === "generic-ballot") return "generic-ballot";
  if (["house", "senate", "governor"].includes(normalized)) return `${normalized}-forecast`;
  return "forecast";
}

function normalizeCandidates(row) {
  if (Array.isArray(row?.candidates)) {
    return row.candidates.map((candidate) => ({
      name: candidate.name || candidate.candidate || null,
      party: candidate.party || null,
      pct: Number.isFinite(Number(candidate.pct ?? candidate.share ?? candidate.percent)) ? Number(candidate.pct ?? candidate.share ?? candidate.percent) : null
    }));
  }
  const candidates = [];
  if (row?.demCandidate || row?.dem !== undefined) candidates.push({ name: row.demCandidate || "Democrat", party: "D", pct: Number.isFinite(Number(row.dem)) ? Number(row.dem) : null });
  if (row?.repCandidate || row?.rep !== undefined) candidates.push({ name: row.repCandidate || "Republican", party: "R", pct: Number.isFinite(Number(row.rep)) ? Number(row.rep) : null });
  return candidates;
}

function normalizeRow(row, context) {
  const rowType = rowTypeFor(row, context.cachePath);
  const validation = validationFor(row, context.cachePath, rowType);
  const candidates = normalizeCandidates(row);
  return {
    ledgerId: `${context.cachePath}:${context.index}`,
    office: row.office || context.office || null,
    cycle: Number(row.cycle || context.cycle || 2026),
    raceId: row.raceId || row.id || null,
    state: row.state || null,
    district: row.district || null,
    sourceKind: context.cachePath.includes("quarantine/") ? "quarantine-cache" : context.cachePath.includes("wikipedia") ? "wikipedia-cache" : "forecast-cache",
    sourceTrust: row.sourceTrust || (context.cachePath.includes("quarantine/") || context.cachePath.includes("wikipedia") ? "QUARANTINED" : sourceTextTrust(row, context.cachePath)),
    sourceName: row.sourceLabel || row.source || context.source || null,
    sourceUrl: row.sourceUrl || row.url || null,
    pollster: row.pollster || null,
    sponsor: row.sponsor || null,
    startDate: row.startDate || null,
    endDate: row.endDate || row.date || null,
    sampleSize: Number.isFinite(Number(row.sampleSize)) ? Number(row.sampleSize) : null,
    population: row.population || null,
    rowType,
    tableType: row.tableType || null,
    candidates,
    candidateMap: candidates,
    demShare: Number.isFinite(Number(row.dem)) ? Number(row.dem) : null,
    repShare: Number.isFinite(Number(row.rep)) ? Number(row.rep) : null,
    margin: Number.isFinite(Number(row.margin ?? row.pollMargin)) ? Number(row.margin ?? row.pollMargin) : null,
    rawValidationStatus: row.validationStatus || null,
    validationStatus: validation.status,
    usedInModel: validation.usedInModel,
    usedBy: validation.usedInModel ? [officeUsedBy(row.office || context.office)] : [],
    excludedReason: validation.reason,
    cachePath: context.cachePath,
    cacheGeneratedAt: context.generatedAt || null
  };
}

function dedupeRows(inputRows) {
  const byKey = new Map();
  for (const row of inputRows) {
    const candidateKey = JSON.stringify(row.candidateMap || row.candidates || []);
    const key = [
      row.office,
      row.raceId,
      row.state,
      row.district,
      row.pollster,
      row.endDate,
      row.sampleSize,
      row.margin,
      row.rowType,
      row.sourceName,
      candidateKey
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    existing.usedInModel = Boolean(existing.usedInModel || row.usedInModel);
    existing.usedBy = [...new Set([...(existing.usedBy || []), ...(row.usedBy || [])])];
    existing.validationStatus = existing.usedInModel ? "VALID" : existing.validationStatus;
    existing.excludedReason = existing.usedInModel ? null : existing.excludedReason;
    existing.sourceKind = row.sourceKind;
    existing.cachePath = existing.cachePath || row.cachePath;
  }
  return [...byKey.values()].map((row, index) => ({ ...row, ledgerId: `canonical-2026:${index + 1}` }));
}

const rows = [];
const sourceSummaries = [];

for (const cachePath of CACHE_FILES) {
  const url = new URL(cachePath, POLL_CACHE_DIR);
  const payload = readJson(url);
  if (!payload) continue;
  const rawRows = sourceRows(payload);
  sourceSummaries.push({
    cachePath,
    office: payload.office || (cachePath.includes("generic") ? "generic-ballot" : null),
    status: payload.status || (payload.readError ? "READ_ERROR" : "OK"),
    rowCount: rawRows.length,
    readError: payload.readError || null
  });
  rawRows.forEach((row, index) => {
    rows.push(normalizeRow(row, {
      index,
      cachePath,
      office: payload.office || (cachePath.includes("generic") ? "generic-ballot" : null),
      cycle: payload.cycle || 2026,
      source: payload.source || null,
      generatedAt: payload.generatedAt || null
    }));
  });
}

const canonicalRows = dedupeRows(rows);
if (canonicalRows.some((row) => row.sourceKind === "generated-forecast-output")) {
  throw new Error("Generated forecast output rows are not allowed in the canonical poll ledger.");
}

const counts = canonicalRows.reduce((acc, row) => {
  acc.total += 1;
  acc.byValidationStatus[row.validationStatus] = (acc.byValidationStatus[row.validationStatus] || 0) + 1;
  acc.usedInModel += row.usedInModel ? 1 : 0;
  acc.rawPollRows += row.rowType === "INDIVIDUAL_GENERAL_ELECTION_POLL" ? 1 : 0;
  return acc;
}, { total: 0, usedInModel: 0, rawPollRows: 0, byValidationStatus: {} });

mkdirSync(new URL("../data/cache/polls/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_URL, `${JSON.stringify({
  schemaVersion: "2026.canonical-poll-ledger.1",
  generatedAt: new Date().toISOString(),
  description: "Canonical poll provenance ledger. Only upstream cache rows may be used by forecast models; forecast output rows are never ingested.",
  counts,
  sourceSummaries,
  rows: canonicalRows
}, null, 2)}\n`);

console.log(`Wrote ${canonicalRows.length} poll ledger rows to ${OUTPUT_URL.pathname}`);
