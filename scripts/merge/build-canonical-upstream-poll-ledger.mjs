import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const VALIDATED_DIR = new URL("data/staging/polls/validated/", ROOT);

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

function validatedFiles() {
  if (!existsSync(VALIDATED_DIR)) return [];
  return readdirSync(VALIDATED_DIR).filter((file) => file.endsWith(".json")).sort();
}

function dedupe(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.sourceKind === "generated-forecast-output") {
      throw new Error(`Generated forecast output row reached canonical upstream ledger: ${row.ledgerId || row.raceId || "unknown row"}`);
    }
    const key = [
      row.office,
      row.raceId,
      row.state,
      row.district,
      row.pollster,
      row.endDate,
      row.sampleSize,
      row.margin,
      JSON.stringify(row.candidateMap || row.candidates || [])
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()].map((row, index) => ({
    ...row,
    ledgerId: `upstream-canonical-2026:${index + 1}`,
    sourceKind: row.sourceKind || "upstream-cache",
    validationStatus: "VALID",
    usedInModel: true
  }));
}

const sourceSummaries = [];
const rows = [];
for (const file of validatedFiles()) {
  const payload = readJson(new URL(file, VALIDATED_DIR), { rows: [] });
  const fileRows = Array.isArray(payload.rows) ? payload.rows : [];
  rows.push(...fileRows);
  sourceSummaries.push({
    file: `data/staging/polls/validated/${file}`,
    office: payload.office || null,
    rowCount: fileRows.length,
    readError: payload.readError || null
  });
}

const canonicalRows = dedupe(rows);
const byOffice = canonicalRows.reduce((acc, row) => {
  const office = row.office || "unknown";
  acc[office] = (acc[office] || 0) + 1;
  return acc;
}, {});

const output = {
  schemaVersion: "2026.canonical-upstream-poll-ledger.1",
  generatedAt: new Date().toISOString(),
  description: "Canonical upstream-only poll ledger. This file is the only v2 polling source for forecast models.",
  counts: {
    total: canonicalRows.length,
    usedInModel: canonicalRows.length,
    byOffice
  },
  sourceSummaries,
  rows: canonicalRows
};

writeJson("data/cache/polls/upstream-canonical-2026.json", output);
writeJson("data/cache/polls/canonical-2026.json", {
  ...output,
  description: "Canonical v2 poll ledger. Upstream-only rows; generated forecast outputs are prohibited."
});
for (const office of ["senate", "house", "governor", "generic-ballot"]) {
  const officeRows = canonicalRows.filter((row) => row.office === office);
  writeJson(`data/cache/polls/upstream-canonical-${office}-2026.json`, {
    ...output,
    office,
    counts: {
      total: officeRows.length,
      usedInModel: officeRows.length,
      byOffice: { [office]: officeRows.length }
    },
    rows: officeRows
  });
}

console.log(`Wrote ${canonicalRows.length} upstream canonical poll rows.`);
