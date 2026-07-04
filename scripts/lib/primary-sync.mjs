import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONFIG_URL = new URL("../../data/model-config/primary-sync-2026.json", import.meta.url);
const FILES = {
  senate: { url: new URL("../../data/forecast.json", import.meta.url), key: "races" },
  governor: { url: new URL("../../data/governor-forecast.json", import.meta.url), key: "races" },
  house: { url: new URL("../../data/house-forecast.json", import.meta.url), key: "districts" }
};

function readJson(url, fallback = null) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

function raceIdFor(office, race) {
  if (race?.raceId) return String(race.raceId);
  if (office === "senate" && race?.state) return `${race.state}-SEN-2026`;
  if (office === "governor" && race?.state) return `${race.state}-GOV-2026`;
  if (office === "house" && race?.id) return `${race.id}-2026`;
  return String(race?.id || race?.state || "");
}

export function loadPrimarySyncConfig() {
  const config = readJson(CONFIG_URL, { races: [], candidateQualityExceptions: {} });
  return {
    ...config,
    races: Array.isArray(config.races) ? config.races : []
  };
}

export function primarySyncMap(config = loadPrimarySyncConfig()) {
  return new Map((config.races || []).map((row) => [String(row.raceId || "").toUpperCase(), row]));
}

function applyCandidateSide(output, sync, side) {
  const nameKey = side === "D" ? "demNominee" : "repNominee";
  const statusKey = side === "D" ? "demStatus" : "repStatus";
  const candidateKeys = side === "D"
    ? ["dem", "demCandidate", "democraticCandidate"]
    : ["rep", "repCandidate", "republicanCandidate"];
  if (sync[nameKey]) {
    for (const key of candidateKeys) {
      if (Object.hasOwn(output, key)) output[key] = sync[nameKey];
    }
  }
  if (sync[statusKey]) output[statusKey] = sync[statusKey];
}

export function applyPrimarySyncToRace(race, office, configOrMap = loadPrimarySyncConfig()) {
  const map = configOrMap instanceof Map ? configOrMap : primarySyncMap(configOrMap);
  const id = raceIdFor(office, race).toUpperCase();
  const sync = map.get(id);
  if (!sync) return race;
  const output = { ...race };
  applyCandidateSide(output, sync, "D");
  applyCandidateSide(output, sync, "R");
  output.primaryDate = sync.primaryDate || output.primaryDate || output.primary?.date || null;
  output.primaryStatus = sync.primaryStatus || output.primaryStatus || "synced";
  output.primarySync = {
    raceId: sync.raceId,
    updatedAt: sync.updatedAt || null,
    source: sync.source || "FEA primary sync",
    demStatus: sync.demStatus || null,
    repStatus: sync.repStatus || null,
    applied: true
  };
  return output;
}

export function syncForecastFiles() {
  const config = loadPrimarySyncConfig();
  const map = primarySyncMap(config);
  const summary = {};
  for (const [office, file] of Object.entries(FILES)) {
    const data = readJson(file.url);
    if (!data || !Array.isArray(data[file.key])) {
      summary[office] = { status: "SKIPPED", reason: "forecast file missing or malformed", updated: 0 };
      continue;
    }
    let updated = 0;
    data[file.key] = data[file.key].map((race) => {
      const next = applyPrimarySyncToRace(race, office, map);
      if (next !== race) updated += 1;
      return next;
    });
    data.primarySync = {
      schemaVersion: config.schemaVersion || 1,
      updatedAt: config.updatedAt || null,
      appliedRows: updated,
      candidateQualityExceptions: config.candidateQualityExceptions || {}
    };
    writeFileSync(file.url, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    summary[office] = { status: "OK", updated };
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = syncForecastFiles();
  console.log(JSON.stringify({ status: "OK", summary }, null, 2));
}
