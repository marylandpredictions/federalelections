import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePollRow } from "../normalize/normalize-poll-row.mjs";
import { validatePollRow, validationSummary } from "./validate-poll-row.mjs";

const ROOT = new URL("../../", import.meta.url);
const RAW_DIR = new URL("data/staging/polls/raw/", ROOT);

function readJson(path, fallback = null) {
  try {
    const url = path instanceof URL ? path : new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = path instanceof URL ? path : new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rawFiles() {
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR).filter((file) => file.endsWith(".json")).sort();
}

const allQuarantined = [];
const allValidated = [];
const officeSummaries = {};

for (const file of rawFiles()) {
  const payload = readJson(new URL(file, RAW_DIR), { rows: [] });
  const office = payload.office || file.replace(/-2026\.json$/, "");
  const normalizedRows = (payload.rows || []).map((row, index) => normalizePollRow(row, {
    office,
    cycle: payload.cycle || 2026,
    rawSourcePath: payload.sourcePath || `data/staging/polls/raw/${file}`,
    generatedAt: payload.generatedAt || null,
    ledgerId: `raw:${file}:${index + 1}`,
    sourceKind: row.sourceKind || "upstream-cache",
    sourceName: row.source || payload.sourcePath
  }));
  const validatedRows = normalizedRows.map((row) => validatePollRow(row, {
    office,
    requireStartDate: false,
    requireTableType: true
  }));
  const usableRows = validatedRows.filter((row) => row.usedInModel);
  const quarantinedRows = validatedRows.filter((row) => !row.usedInModel);
  allValidated.push(...usableRows);
  allQuarantined.push(...quarantinedRows);
  officeSummaries[office] = validationSummary(validatedRows);

  writeJson(`data/staging/polls/normalized/${file}`, {
    schemaVersion: "2026.upstream-poll-normalized.1",
    generatedAt: new Date().toISOString(),
    office,
    cycle: payload.cycle || 2026,
    rows: normalizedRows
  });
  writeJson(`data/staging/polls/validated/${file}`, {
    schemaVersion: "2026.upstream-poll-validated.1",
    generatedAt: new Date().toISOString(),
    office,
    cycle: payload.cycle || 2026,
    rows: usableRows,
    counts: validationSummary(usableRows)
  });
  writeJson(`data/staging/polls/quarantine/${file}`, {
    schemaVersion: "2026.upstream-poll-quarantine.1",
    generatedAt: new Date().toISOString(),
    office,
    cycle: payload.cycle || 2026,
    rows: quarantinedRows,
    counts: validationSummary(quarantinedRows)
  });
}

writeJson("data/staging/polls/quarantine-ledger-2026.json", {
  schemaVersion: "2026.upstream-poll-quarantine-ledger.1",
  generatedAt: new Date().toISOString(),
  description: "Rows rejected before canonical model input. Generated forecast output rows are never eligible for model use.",
  counts: {
    validatedRows: allValidated.length,
    quarantinedRows: allQuarantined.length,
    byOffice: officeSummaries
  },
  quarantinedRows: allQuarantined
});

console.log(`Validated ${allValidated.length} upstream rows; quarantined ${allQuarantined.length}.`);
