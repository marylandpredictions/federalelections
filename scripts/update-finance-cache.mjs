import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { raceFinanceStatus } from "./lib/openfec-finance.mjs";

const ROOT = new URL("../", import.meta.url);

function readJson(path, fallback = {}) {
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

function financeRows(model, collectionName, office) {
  return (model[collectionName] || []).map((race) => {
    const records = race.sourceInputs?.finance?.candidateRecords || race.finance?.candidateRecords || race.fecRecords || [];
    const status = raceFinanceStatus(records);
    return {
      office,
      raceId: race.id || race.state || race.district || null,
      state: race.state || null,
      ...status
    };
  });
}

const senate = readJson("data/forecast.json");
const house = readJson("data/house-forecast.json");
const governor = readJson("data/governor-forecast.json");
const asOf = new Date().toISOString();
const senateRows = financeRows(senate, "races", "senate");
const houseRows = financeRows(house, "districts", "house");
const governorRows = (governor.races || []).map((race) => ({
  office: "governor",
  raceId: race.id || race.state,
  state: race.state,
  financeStatus: "DISABLED_OR_UNAVAILABLE",
  usedInModel: false,
  records: []
}));

writeJson("data/cache/finance/senate-2026.json", { source: "official race-level finance records when present", office: "senate", asOf, rows: senateRows, status: senateRows.some((row) => row.usedInModel) ? "OK_PARSED" : "OK_NO_RACE_LEVEL_ROWS" });
writeJson("data/cache/finance/house-2026.json", { source: "official race-level finance records when present", office: "house", asOf, rows: houseRows, status: houseRows.some((row) => row.usedInModel) ? "OK_PARSED" : "OK_NO_RACE_LEVEL_ROWS" });
writeJson("data/cache/finance/governor-2026.json", { source: "governor finance disabled unless state portal records are normalized", office: "governor", asOf, rows: governorRows, status: "PLACEHOLDER_DISABLED" });
writeJson("data/diagnostics/finance-integration-2026.json", {
  generatedAt: asOf,
  senate: { activeRaceLevel: senateRows.filter((row) => row.usedInModel).length, total: senateRows.length },
  house: { activeRaceLevel: houseRows.filter((row) => row.usedInModel).length, total: houseRows.length },
  governor: { activeRaceLevel: 0, total: governorRows.length, note: "Governor finance is explicitly disabled until race-level public finance records are loaded." }
});
console.log("Wrote finance cache diagnostics.");

