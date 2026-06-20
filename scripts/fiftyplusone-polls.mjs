import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { markDisabled, markNoRows, markParseFailed } from "./forecast-source-health.mjs";

const FILE_BY_OFFICE = {
  senate: "senate_general.csv",
  house: "house_general.csv",
  governor: "governor_general.csv",
  president: "generic.csv"
};

function csvRows(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() || "").split(",").map((header) => header.trim());
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ""]));
  });
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// Optional adapter: point FIFTYPLUSONE_PATH at an authorized download folder.
// It deliberately does nothing without explicit local access, rather than
// treating a credentialed source as absent polling.
export function loadFiftyPlusOnePolls(office, status) {
  const label = `fiftyPlusOne${office[0].toUpperCase()}${office.slice(1)}`;
  const root = process.env.FIFTYPLUSONE_PATH;
  if (!root) {
    markDisabled(status, label, "Set FIFTYPLUSONE_PATH to an authorized FiftyPlusOne CSV export directory.");
    return { polls: [], source: "FiftyPlusOne", enabled: false };
  }
  const file = join(root, FILE_BY_OFFICE[office] || `${office}_general.csv`);
  if (!existsSync(file)) {
    markDisabled(status, label, `Authorized export directory is configured but ${FILE_BY_OFFICE[office] || `${office}_general.csv`} is absent.`, { file });
    return { polls: [], source: "FiftyPlusOne", enabled: true };
  }
  try {
    const rows = csvRows(readFileSync(file, "utf8"));
    const polls = rows.map((row) => {
      const dem = number(row.dem ?? row.dem_pct ?? row.democrat);
      const rep = number(row.rep ?? row.rep_pct ?? row.republican ?? row.gop);
      const state = String(row.state ?? row.state_po ?? "").toUpperCase();
      const district = String(row.district ?? row.cd ?? "").toUpperCase();
      const endDate = row.end_date ?? row.endDate ?? row.field_end ?? "";
      if (!Number.isFinite(dem) || !Number.isFinite(rep) || !state || !endDate) return null;
      return {
        state,
        district: district ? `${state}-${district.padStart(2, "0")}` : null,
        margin: dem - rep,
        dem,
        rep,
        pollster: row.pollster || row.pollster_name || "FiftyPlusOne",
        sponsor: row.sponsor || null,
        endDate,
        sampleSize: number(row.sample_size ?? row.n),
        population: row.population || row.sample_type || "unknown",
        source: "FiftyPlusOne",
        candidateMatchConfidence: "EXACT"
      };
    }).filter(Boolean);
    if (!polls.length) markNoRows(status, label, { file, rows: rows.length });
    else status[label] = { health: "OK_PARSED", ok: true, status: "OK_PARSED", file, rows: rows.length, usablePolls: polls.length };
    return { polls, source: "FiftyPlusOne", enabled: true };
  } catch (error) {
    markParseFailed(status, label, error, { file });
    return { polls: [], source: "FiftyPlusOne", enabled: true };
  }
}
