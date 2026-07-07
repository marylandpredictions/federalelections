import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const POLL_CACHE_DIR = new URL("../data/cache/polls/", import.meta.url);
const OUTPUT_URL = new URL("../data/cache/polls/canonical-2026.json", import.meta.url);

const CACHE_FILES = [
  "generic-ballot-2026.json",
  "senate-2026.json",
  "governor-2026.json",
  "house-2026.json",
  "wikipedia-senate-2026.json",
  "wikipedia-governor-2026.json",
  "wikipedia-house-2026.json",
  "quarantine/senate-2026.json",
  "quarantine/governor-2026.json",
  "quarantine/house-2026.json"
];

const GENERATED_FORECAST_FILES = [
  { path: "../data/forecast.json", office: "senate", racesKey: "races" },
  { path: "../data/governor-forecast.json", office: "governor", racesKey: "races" },
  { path: "../data/house-forecast.json", office: "house", racesKey: "districts" }
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
  if (row?.validationStatus && row.validationStatus !== "USABLE") return { status: row.validationStatus, usedInModel: false, reason: row?.excludedReason || row.validationStatus };
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

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractHref(value) {
  const match = String(value || "").match(/href=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parsePollResultCandidates(poll) {
  const result = String(poll?.result || "");
  if (!result) return [];
  return result
    .split("/")
    .map((piece) => piece.trim())
    .map((piece) => {
      const match = piece.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);
      if (!match) return null;
      return {
        name: match[1].trim(),
        party: null,
        pct: Number(match[2])
      };
    })
    .filter(Boolean);
}

function generatedRaceId(race, office) {
  if (race?.raceId) return race.raceId;
  if (race?.id) return race.id;
  const state = race?.state || "US";
  if (office === "senate") return `${state}-SEN-2026`;
  if (office === "governor") return `${state}-GOV-2026`;
  const district = race?.district || race?.districtId || "AL";
  return `${state}-${String(district).padStart(2, "0")}`;
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

function normalizeGeneratedPoll(poll, context) {
  const candidates = parsePollResultCandidates(poll);
  return {
    ledgerId: `generated:${context.office}:${context.raceId}:${context.index}`,
    office: context.office,
    cycle: 2026,
    raceId: context.raceId,
    state: context.state || null,
    district: context.district || null,
    sourceKind: "generated-forecast-output",
    sourceTrust: sourceTextTrust(poll, "generated-forecast-output"),
    sourceName: poll.source || null,
    sourceUrl: poll.sourceUrl || extractHref(poll.pollster),
    pollster: stripHtml(poll.pollster) || null,
    sponsor: poll.sponsor || null,
    startDate: poll.startDate || null,
    endDate: poll.endDate || poll.date || null,
    sampleSize: Number.isFinite(Number(poll.sampleSize)) ? Number(poll.sampleSize) : null,
    population: poll.population || null,
    rowType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
    tableType: null,
    candidates,
    candidateMap: candidates,
    demShare: null,
    repShare: null,
    margin: Number.isFinite(Number(poll.margin)) ? Number(poll.margin) : null,
    rawValidationStatus: "USABLE",
    validationStatus: "VALID",
    usedInModel: true,
    usedBy: [officeUsedBy(context.office)],
    excludedReason: null,
    cachePath: context.cachePath,
    cacheGeneratedAt: context.generatedAt || null,
    sourceRaceTitle: poll.title || null,
    sourceResultText: poll.result || null,
    sourceSpreadText: poll.spread || null,
    modelWeight: Number.isFinite(Number(poll.weight)) ? Number(poll.weight) : null
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
    existing.sourceKind = existing.sourceKind === "generated-forecast-output" ? existing.sourceKind : row.sourceKind;
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

for (const forecastFile of GENERATED_FORECAST_FILES) {
  const payload = readJson(new URL(forecastFile.path, import.meta.url));
  if (!payload) continue;
  const races = Array.isArray(payload?.[forecastFile.racesKey]) ? payload[forecastFile.racesKey] : [];
  let generatedRows = 0;
  for (const race of races) {
    const polls = Array.isArray(race?.polls) ? race.polls : [];
    polls.forEach((poll, index) => {
      rows.push(normalizeGeneratedPoll(poll, {
        office: forecastFile.office,
        raceId: generatedRaceId(race, forecastFile.office),
        state: race.state,
        district: race.district || race.districtId || null,
        index,
        cachePath: forecastFile.path,
        generatedAt: payload.generatedAt || payload.lastUpdated || null
      }));
      generatedRows += 1;
    });
  }
  sourceSummaries.push({
    cachePath: forecastFile.path,
    office: forecastFile.office,
    status: payload.readError ? "READ_ERROR" : "OK_GENERATED_FORECAST",
    rowCount: generatedRows,
    readError: payload.readError || null
  });
}

const canonicalRows = dedupeRows(rows);

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
  description: "Canonical poll provenance ledger. Only VALID raw-poll rows may be used by forecast models; Wikipedia, legacy fallback, and polling-average rows are diagnostic-only or quarantined.",
  counts,
  sourceSummaries,
  rows: canonicalRows
}, null, 2)}\n`);

console.log(`Wrote ${canonicalRows.length} poll ledger rows to ${OUTPUT_URL.pathname}`);
