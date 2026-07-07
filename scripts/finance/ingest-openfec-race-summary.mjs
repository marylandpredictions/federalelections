import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

function readJson(path, fallback = null) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function summarizeOffice(office) {
  const legacy = readJson(`data/cache/finance/${office}-2026.json`, {});
  const rows = [];
  const sourceRows = Array.isArray(legacy?.rows)
    ? legacy.rows
    : Object.entries(legacy?.races || legacy?.byRace || legacy || {})
      .filter(([key, value]) => key !== "__national" && value && typeof value === "object")
      .map(([raceId, value]) => ({ raceId, ...value }));

  for (const row of sourceRows) {
    rows.push({
      raceId: row.raceId || row.id || row.state || row.district || null,
      office,
      totalReceipts: Number.isFinite(Number(row.totalReceipts)) ? Number(row.totalReceipts) : null,
      cashOnHand: Number.isFinite(Number(row.cashOnHand)) ? Number(row.cashOnHand) : null,
      disbursements: Number.isFinite(Number(row.disbursements)) ? Number(row.disbursements) : null,
      lastReportDate: row.lastReportDate || row.reportDate || null,
      committeeCoverage: row.committeeCoverage || row.coverage || (row.committees ? "PARTIAL" : "UNKNOWN"),
      sourceFreshness: row.sourceFreshness || legacy.generatedAt || legacy.updatedAt || null,
      source: row.source || `data/cache/finance/${office}-2026.json`
    });
  }

  const status = rows.length ? "OK" : (office === "governor" ? "UNAVAILABLE" : "NO_ROWS");
  return {
    schemaVersion: "2026.finance-race-summary-v2.1",
    generatedAt: new Date().toISOString(),
    office,
    status,
    note: status === "UNAVAILABLE" ? "Governor finance is not available through OpenFEC; do not treat missing rows as zero finance." : null,
    source: `data/cache/finance/${office}-2026.json`,
    counts: { rows: rows.length, withReceipts: rows.filter((row) => row.totalReceipts !== null).length },
    rows
  };
}

for (const office of ["house", "senate", "governor"]) {
  const output = summarizeOffice(office);
  writeJson(`data/cache/finance/${office}-2026-v2.json`, output);
  console.log(`Wrote ${office} finance v2 summary: ${output.counts.rows} rows (${output.status}).`);
}
