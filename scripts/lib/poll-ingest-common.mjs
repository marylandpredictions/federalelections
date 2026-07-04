import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CACHE_ROOT = new URL("../../data/cache/polls/", import.meta.url);

export function htmlToLines(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function normalizeOffice(value) {
  const text = String(value || "").toLowerCase();
  if (/governor|gubernatorial/.test(text)) return "governor";
  if (/house|congress|district/.test(text)) return "house";
  if (/senate|sen\./.test(text)) return "senate";
  return null;
}

export function normalizeDistrictId(state, district) {
  if (!state || !district) return null;
  const suffix = String(district).toUpperCase() === "AL" ? "AL" : String(Number(district)).padStart(2, "0");
  if (suffix !== "AL" && suffix === "NaN") return null;
  return `${String(state).toUpperCase()}-${suffix}`;
}

export function parsePollDate(lines, start) {
  for (let index = start; index < Math.min(lines.length, start + 20); index += 1) {
    const match = lines[index].match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:,?\s*20\d{2})?\b/i);
    if (!match) continue;
    const year = /20\d{2}/.test(match[0]) ? "" : " 2026";
    const normalized = match[0].replace(/\s*[-–]\s*\d{1,2}/, "") + year;
    const date = new Date(normalized);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

export function cacheUrlForOffice(office) {
  return new URL(`${office}-2026.json`, CACHE_ROOT);
}

export function readPollingCache(office) {
  try {
    return JSON.parse(readFileSync(cacheUrlForOffice(office), "utf8"));
  } catch {
    return { office, rows: [], rawRows: [], status: "MISSING" };
  }
}

export function writeMergedPollingCache(office, rows, sourceKey, metadata = {}) {
  const cache = readPollingCache(office);
  const existingRows = Array.isArray(cache.rows) ? cache.rows : [];
  const retained = existingRows.filter((row) => String(row.sourceKey || row.source || "").toLowerCase() !== String(sourceKey).toLowerCase());
  const merged = [...retained, ...rows];
  const output = {
    ...cache,
    office,
    source: cache.source || "trusted polling cache",
    status: rows.length ? "OK_PARSED" : (cache.status || "OK_NO_ROWS"),
    updatedAt: new Date().toISOString(),
    rows: merged,
    rawRows: merged,
    usableRows: merged.filter((row) => row.usedInModel === true),
    pollingValidation: {
      ...(cache.pollingValidation || {}),
      trustedIngest: {
        sourceKey,
        rows: rows.length,
        retainedRows: retained.length,
        ...metadata
      }
    }
  };
  mkdirSync(CACHE_ROOT, { recursive: true });
  writeFileSync(cacheUrlForOffice(office), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

export async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 FEA forecast poll cache" } });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}
