import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function bump(object, key, amount = 1) {
  object[key || "UNKNOWN"] = (object[key || "UNKNOWN"] || 0) + amount;
}

for (const office of OFFICES) {
  const ledger = readJson(`data/cache/polls/quarantine/${office}-2026.json`, { rawRows: [], quarantinedRows: [], usableRows: [] });
  const bySource = {};
  const bySourceTrust = {};
  const byRace = {};
  const byValidationStatus = {};
  const rejectionReasons = {};
  for (const row of ledger.rawRows || []) {
    bump(bySource, row.sourceLabel || row.source || row.sourceKey);
    bump(bySourceTrust, row.sourceTrust || row.validationTrust);
    bump(byRace, row.raceId || row.district || row.state);
    bump(byValidationStatus, row.validationStatus);
    for (const reason of row.rejectionReasons || []) bump(rejectionReasons, reason);
  }
  const payload = {
    office,
    generatedAt: new Date().toISOString(),
    rawRows: ledger.rawRows?.length || 0,
    usableRows: ledger.usableRows?.length || 0,
    quarantinedRows: ledger.quarantinedRows?.length || 0,
    bySource,
    bySourceTrust,
    byRace,
    byValidationStatus,
    rejectionReasons,
    matchedHousePollRows: office === "house" ? (ledger.usableRows || []).filter((row) => row.candidateMatchConfidence === "MATCHED").length : undefined,
    quarantinedHousePollRows: office === "house" ? (ledger.quarantinedRows || []).length : undefined,
    distinctDistrictsWithPolls: office === "house" ? new Set((ledger.usableRows || []).map((row) => row.district || row.raceId)).size : undefined
  };
  writeJson(`data/diagnostics/poll-validation-${office}-2026.json`, payload);
  console.log(`Wrote poll validation diagnostics for ${office}.`);
}

