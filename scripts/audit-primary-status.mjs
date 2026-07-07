import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NOMINATION_STATUSES, nominationStatusFor } from "./lib/candidate-freshness.mjs";
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

const RESOLVED_STATUSES = new Set([
  NOMINATION_STATUSES.VERIFIED_NOMINEE,
  NOMINATION_STATUSES.PROJECTED_NOMINEE,
  NOMINATION_STATUSES.PRESUMPTIVE_NOMINEE,
  NOMINATION_STATUSES.ADVANCED_TOP_TWO
]);
const EXCEPTION_STATUSES = new Set([
  NOMINATION_STATUSES.RUNOFF_PENDING
]);

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
  const demNominationStatus = race.primarySync?.demNominationStatus || nominationStatusFor(`${primaryStatus || ""} ${demStatus || ""}`, demName);
  const repNominationStatus = race.primarySync?.repNominationStatus || nominationStatusFor(`${primaryStatus || ""} ${repStatus || ""}`, repName);
  const flags = [];
  const anyResolved = RESOLVED_STATUSES.has(demNominationStatus) || RESOLVED_STATUSES.has(repNominationStatus);
  const anyException = EXCEPTION_STATUSES.has(demNominationStatus) || EXCEPTION_STATUSES.has(repNominationStatus);

  if (!primaryDate) {
    flags.push({ severity: "info", type: "PRIMARY_DATE_MISSING", message: "Primary date is not present in this forecast row." });
  }
  if (primaryPassed && !anyResolved && !anyException) {
    flags.push({ severity: "warning", type: "PRIMARY_PASSED_UNRESOLVED", message: "Primary date has passed but nominee/presumptive status is not resolved." });
  }
  if (primaryPassed && isGenericCandidate(demName) && !RESOLVED_STATUSES.has(demNominationStatus) && !EXCEPTION_STATUSES.has(demNominationStatus)) {
    flags.push({ severity: "warning", type: "DEMOCRATIC_CANDIDATE_GENERIC_AFTER_PRIMARY", message: "Democratic candidate remains generic after the primary date." });
  }
  if (primaryPassed && isGenericCandidate(repName) && !RESOLVED_STATUSES.has(repNominationStatus) && !EXCEPTION_STATUSES.has(repNominationStatus)) {
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
    demNominationStatus,
    repNominationStatus,
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
