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

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((item) => Array.isArray(item) ? item : []);
}

function sourceRows(payload) {
  return [
    ...asArray(payload?.rows),
    ...asArray(payload?.rawRows),
    ...asArray(payload?.usableRows)
  ];
}

function upstreamSourceKind(row, payload, sourcePath) {
  const text = `${row?.sourceKind || ""} ${row?.source || ""} ${row?.sourceLabel || ""} ${payload?.source || ""} ${sourcePath}`.toLowerCase();
  if (text.includes("generated-forecast-output")) return "generated-forecast-output";
  if (/data\/(?:forecast|governor-forecast|house-forecast)\.json/.test(text) && !row?.sourceUrl && !row?.source) {
    return "generated-forecast-output";
  }
  if (text.includes("wikipedia")) return "wikipedia-upstream-cache";
  if (text.includes("manual")) return "manual-upstream-cache";
  return "upstream-cache";
}

export function ingestPollCache({ office, sourcePath, outputPath, rowType = null }) {
  const payload = readJson(sourcePath, {});
  const rows = sourceRows(payload).map((row, index) => ({
    ...row,
    office: row.office || office,
    cycle: row.cycle || payload.cycle || 2026,
    rowType: row.rowType || row.tableType || rowType || "INDIVIDUAL_GENERAL_ELECTION_POLL",
    sourceKind: upstreamSourceKind(row, payload, sourcePath),
    rawSourcePath: sourcePath,
    rawSourceIndex: index,
    upstreamIngestedAt: new Date().toISOString()
  }));
  const output = {
    schemaVersion: "2026.upstream-poll-raw.1",
    generatedAt: new Date().toISOString(),
    office,
    cycle: Number(payload.cycle || 2026),
    sourcePath,
    sourceStatus: payload.status || (payload.readError ? "READ_ERROR" : "OK"),
    sourceGeneratedAt: payload.generatedAt || null,
    rows
  };
  writeJson(outputPath, output);
  console.log(`Ingested ${rows.length} ${office} upstream poll rows to ${outputPath}`);
  return output;
}
