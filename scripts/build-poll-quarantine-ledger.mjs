import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizePollingCache } from "./lib/poll-validation.mjs";
import { matchHousePollRowToDistrict } from "./lib/house-poll-matchers.mjs";

const ROOT = new URL("../", import.meta.url);
const OFFICES = ["house", "senate", "governor"];

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function enrichHouseRows(rows) {
  const forecast = readJson("data/house-forecast.json", {});
  const byId = new Map((forecast.districts || []).map((district) => [String(district.id || "").toUpperCase(), district]));
  return rows.map((row) => {
    const districtId = String(row.district || row.raceId || "").replace(/-2026$/i, "").toUpperCase();
    const district = byId.get(districtId);
    if (!district) return { ...row, unmatchedRace: true, aliasDebug: { reason: "DISTRICT_NOT_IN_FORECAST", district: districtId } };
    const match = matchHousePollRowToDistrict(row, district);
    return match.matched ? { ...row, candidateMatchConfidence: "MATCHED" } : {
      ...row,
      unmatchedRace: true,
      candidateMatchConfidence: "UNMATCHED",
      aliasDebug: match.aliasDebug,
      matchDiagnostics: match
    };
  });
}

for (const office of OFFICES) {
  const cache = readJson(`data/cache/polls/${office}-2026.json`, {});
  const wikipedia = readJson(`data/cache/polls/wikipedia-${office}-2026.json`, null);
  const primaryRows = Array.isArray(cache.rows) ? cache.rows : [];
  const rows = office === "house" ? enrichHouseRows(primaryRows) : primaryRows;
  const sanitized = sanitizePollingCache({ ...cache, office, rows }, { office, source: cache.source || `${office} polling cache` });
  const wikiSanitized = wikipedia ? sanitizePollingCache(
    { ...wikipedia, office, rows: wikipedia.rows || wikipedia.rawRows || [] },
    {
      office,
      source: wikipedia.source || "Wikipedia election polling tables",
      forceQuarantine: true,
      quarantineReason: "WIKIPEDIA_EXPERIMENTAL_DO_NOT_USE_IN_FORECAST"
    }
  ) : null;
  const rawRows = [
    ...(sanitized.rawRows || []),
    ...(wikiSanitized?.rawRows || [])
  ];
  const quarantinedRows = rawRows.filter((row) => row.validationStatus !== "USABLE" || row.usedInModel === false);
  const payload = {
    office,
    generatedAt: new Date().toISOString(),
    sourceCaches: [cache.source, wikipedia?.source].filter(Boolean),
    usableRows: sanitized.usableRows || [],
    quarantinedRows,
    rawRows,
    summary: {
      usableRows: sanitized.usableRows?.length || 0,
      quarantinedRows: quarantinedRows.length,
      wikipediaRows: wikiSanitized?.rawRows?.length || 0,
      validation: sanitized.pollingValidation || null,
      wikipediaValidation: wikiSanitized?.pollingValidation || null
    }
  };
  writeJson(`data/cache/polls/quarantine/${office}-2026.json`, payload);
  console.log(`Wrote poll quarantine ledger for ${office}: ${quarantinedRows.length} quarantined, ${payload.usableRows.length} usable.`);
}

