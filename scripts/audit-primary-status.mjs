import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applyPrimarySyncToRace, loadPrimarySyncConfig, primarySyncMap } from "./lib/primary-sync.mjs";

const OUTPUT_URL = new URL("../data/diagnostics/primary-status-audit-2026.json", import.meta.url);
const AUDIT_DATE = new Date(process.env.AUDIT_DATE || new Date().toISOString());
const PRIMARY_SYNC_CONFIG = loadPrimarySyncConfig();
const PRIMARY_SYNC_MAP = primarySyncMap(PRIMARY_SYNC_CONFIG);

const SOURCES = [
  { model: "senate", url: new URL("../data/forecast.json", import.meta.url), type: "races" },
  { model: "governor", url: new URL("../data/governor-forecast.json", import.meta.url), type: "races" },
  { model: "house", url: new URL("../data/house-forecast.json", import.meta.url), type: "districts" }
];

function readJson(url) {
  try {
    return { data: JSON.parse(readFileSync(url, "utf8")), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

function auditRace(model, race) {
  const primaryDate = race.primaryDate || race.primary?.date || null;
  const primaryTime = primaryDate ? new Date(`${primaryDate}T23:59:59`) : null;
  const primaryPassed = primaryTime instanceof Date && Number.isFinite(primaryTime.getTime()) && primaryTime < AUDIT_DATE;
  const primaryStatus = String(race.primaryStatus || race.primary || "").trim() || null;
  const demStatus = String(race.demStatus || "").trim() || null;
  const repStatus = String(race.repStatus || "").trim() || null;
  const demName = race.dem || race.demCandidate || "Democrat";
  const repName = race.rep || race.repCandidate || "Republican";
  const flags = [];
  const statusText = `${primaryStatus || ""} ${demStatus || ""} ${repStatus || ""}`.toLowerCase();

  if (!primaryDate) {
    flags.push({ severity: "info", type: "PRIMARY_DATE_MISSING", message: "Primary date is not present in this forecast row." });
  }
  if (primaryPassed && !/(resolved|nominee|presumptive|advanced|winner)/.test(statusText)) {
    flags.push({ severity: "warning", type: "PRIMARY_PASSED_UNRESOLVED", message: "Primary date has passed but nominee/presumptive status is not resolved." });
  }
  if (primaryPassed && isGenericCandidate(demName) && !/nominee|presumptive/.test(String(demStatus).toLowerCase())) {
    flags.push({ severity: "warning", type: "DEMOCRATIC_CANDIDATE_GENERIC_AFTER_PRIMARY", message: "Democratic candidate remains generic after the primary date." });
  }
  if (primaryPassed && isGenericCandidate(repName) && !/nominee|presumptive/.test(String(repStatus).toLowerCase())) {
    flags.push({ severity: "warning", type: "REPUBLICAN_CANDIDATE_GENERIC_AFTER_PRIMARY", message: "Republican candidate remains generic after the primary date." });
  }
  if (race.matchupStatus && /unknown|provisional|pending/i.test(String(race.matchupStatus))) {
    flags.push({ severity: "info", type: "MATCHUP_STATUS_PROVISIONAL", message: "Forecast matchup is still marked provisional or pending." });
  }

  return {
    model,
    id: race.id || race.state || race.displayName || race.name,
    state: race.state || null,
    race: race.displayName || race.name || race.id || race.state,
    primaryDate,
    primaryPassed,
    primaryStatus,
    primarySyncApplied: Boolean(race.primarySync?.applied),
    primarySyncRaceId: race.primarySync?.raceId || null,
    demCandidate: demName,
    repCandidate: repName,
    demStatus,
    repStatus,
    matchupStatus: race.matchupStatus || null,
    reviewRequired: flags.some((flag) => flag.severity !== "info"),
    flags
  };
}

function isGenericCandidate(value) {
  return /^(democrat|democratic field|republican|republican field|democratic nominee|republican nominee)$/i.test(String(value || "").trim());
}

const fileErrors = [];
const rows = [];
let primarySyncApplied = 0;
for (const source of SOURCES) {
  const { data, error } = readJson(source.url);
  if (error) {
    fileErrors.push({ model: source.model, file: source.url.pathname, error });
    continue;
  }
  const items = Array.isArray(data?.[source.type]) ? data[source.type] : [];
  rows.push(...items.map((race) => {
    const synced = applyPrimarySyncToRace(race, source.model, PRIMARY_SYNC_MAP);
    if (synced !== race) primarySyncApplied += 1;
    return auditRace(source.model, synced);
  }));
}

const output = {
  generatedAt: new Date().toISOString(),
  auditDate: AUDIT_DATE.toISOString(),
  schemaVersion: "2026.primary-status-audit.1",
  summary: {
    rows: rows.length,
    reviewRequired: rows.filter((row) => row.reviewRequired).length,
    warnings: rows.reduce((sum, row) => sum + row.flags.filter((flag) => flag.severity === "warning").length, 0),
    primarySyncApplied,
    primarySyncRowsConfigured: PRIMARY_SYNC_CONFIG.races.length,
    fileErrors: fileErrors.length
  },
  fileErrors,
  rows
};

mkdirSync(new URL("../data/diagnostics/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_URL, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote data/diagnostics/primary-status-audit-2026.json with ${output.summary.reviewRequired} rows requiring review.`);
