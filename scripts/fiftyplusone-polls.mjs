import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { markDisabled, markNoRows, markParseFailed } from "./forecast-source-health.mjs";
import { dedupePollRows } from "./poll-ledger.mjs";

const FILE_BY_OFFICE = {
  senate: "senate_general.csv",
  house: "house_general.csv",
  governor: "governor_general.csv",
  president: "generic.csv"
};

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < String(text).length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(cell.trim()); cell = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const headers = (rows.shift() || []).map((header) => header.trim().toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function readCsv(root, name) {
  const file = join(root, name);
  return existsSync(file) ? csvRows(readFileSync(file, "utf8")) : [];
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function field(row, ...keys) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== "") return row[key];
  return "";
}

function party(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^(D|DEM|DEMOCRAT)/.test(normalized) ? "D" : /^(R|REP|GOP|REPUBLICAN)/.test(normalized) ? "R" : normalized;
}

function raceCatalog(root) {
  return new Map(readCsv(root, "races.csv").map((row) => [field(row, "race_id", "id"), row]));
}

function pollsterCatalog(root) {
  return new Map(readCsv(root, "pollsters.csv").map((row) => [field(row, "pollster_id", "id"), row]));
}

function normalizeWide(row, races, pollsters) {
  const race = races.get(field(row, "race_id")) || {};
  const dem = number(field(row, "dem", "dem_pct", "democrat"));
  const rep = number(field(row, "rep", "rep_pct", "republican", "gop"));
  const state = String(field(row, "state", "state_po", "state_code") || field(race, "state", "state_po")).toUpperCase();
  const districtRaw = field(row, "district", "cd") || field(race, "district", "cd");
  const endDate = field(row, "end_date", "enddate", "field_end", "date");
  const pollsterRow = pollsters.get(field(row, "pollster_id")) || {};
  if (!Number.isFinite(dem) || !Number.isFinite(rep) || !state || !endDate) return null;
  return {
    state,
    district: districtRaw ? `${state}-${String(districtRaw).padStart(2, "0")}` : null,
    margin: dem - rep,
    dem,
    rep,
    pollster: field(row, "pollster", "pollster_name") || field(pollsterRow, "name", "pollster") || "FiftyPlusOne",
    sponsor: field(row, "sponsor"),
    endDate,
    sampleSize: number(field(row, "sample_size", "n")),
    population: field(row, "population", "sample_type") || "unknown",
    source: "FiftyPlusOne",
    candidateMatchConfidence: "EXACT"
  };
}

function normalizeLong(rows, races, pollsters) {
  const grouped = new Map();
  for (const row of rows) {
    const pollId = field(row, "poll_id", "id");
    if (!pollId) continue;
    const bucket = grouped.get(pollId) || [];
    bucket.push(row);
    grouped.set(pollId, bucket);
  }
  const polls = [];
  for (const rowsForPoll of grouped.values()) {
    const first = rowsForPoll[0];
    const race = races.get(field(first, "race_id")) || {};
    const candidates = rowsForPoll.map((row) => ({ party: party(field(row, "party")), pct: number(field(row, "pct", "percent", "share")), name: field(row, "candidate_name", "candidate") }));
    const dem = candidates.find((candidate) => candidate.party === "D")?.pct;
    const rep = candidates.find((candidate) => candidate.party === "R")?.pct;
    const state = String(field(first, "state", "state_po") || field(race, "state", "state_po")).toUpperCase();
    const districtRaw = field(first, "district", "cd") || field(race, "district", "cd");
    const pollsterRow = pollsters.get(field(first, "pollster_id")) || {};
    const endDate = field(first, "end_date", "enddate", "field_end", "date");
    if (!Number.isFinite(dem) || !Number.isFinite(rep) || !state || !endDate) continue;
    polls.push({
      state,
      district: districtRaw ? `${state}-${String(districtRaw).padStart(2, "0")}` : null,
      margin: dem - rep,
      dem, rep, candidates,
      pollster: field(first, "pollster", "pollster_name") || field(pollsterRow, "name", "pollster") || "FiftyPlusOne",
      sponsor: field(first, "sponsor"), endDate,
      sampleSize: number(field(first, "sample_size", "n")),
      population: field(first, "population", "sample_type") || "unknown",
      source: "FiftyPlusOne", candidateMatchConfidence: "EXACT"
    });
  }
  return polls;
}

// Optional adapter: FIFTYPLUSONE_PATH must point to an authorized export.
// It supports normal wide rows plus candidate-row exports, and never turns an
// unavailable credentialed source into a generator failure.
export function loadFiftyPlusOnePolls(office, status) {
  const label = `fiftyPlusOne${office[0].toUpperCase()}${office.slice(1)}`;
  const root = process.env.FIFTYPLUSONE_PATH;
  if (!root) {
    markDisabled(status, label, "Set FIFTYPLUSONE_PATH to an authorized FiftyPlusOne export directory.");
    return { polls: [], source: "FiftyPlusOne", enabled: false, usedPolls: 0 };
  }
  const file = join(root, FILE_BY_OFFICE[office] || `${office}_general.csv`);
  if (!existsSync(file)) {
    markDisabled(status, label, "Authorized export is configured but the office CSV is absent.", { file });
    return { polls: [], source: "FiftyPlusOne", enabled: true, usedPolls: 0 };
  }
  try {
    const rows = csvRows(readFileSync(file, "utf8"));
    const races = raceCatalog(root);
    const pollsters = pollsterCatalog(root);
    const longFormat = rows.some((row) => field(row, "poll_id") && field(row, "party") && field(row, "pct", "percent", "share"));
    const polls = dedupePollRows(longFormat ? normalizeLong(rows, races, pollsters) : rows.map((row) => normalizeWide(row, races, pollsters)).filter(Boolean));
    if (!polls.length) markNoRows(status, label, { file, rows: rows.length, format: longFormat ? "long" : "wide" });
    else status[label] = { health: "OK_PARSED", ok: true, status: "OK_PARSED", file, rows: rows.length, usablePolls: polls.length, format: longFormat ? "long" : "wide" };
    return { polls, source: "FiftyPlusOne", enabled: true, usedPolls: polls.length };
  } catch (error) {
    markParseFailed(status, label, error, { file });
    return { polls: [], source: "FiftyPlusOne", enabled: true, usedPolls: 0 };
  }
}
