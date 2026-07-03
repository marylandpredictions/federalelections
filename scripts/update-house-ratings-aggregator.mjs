import { mkdirSync, writeFileSync } from "node:fs";
import { normalizeRating } from "./lib/rating-priors.mjs";

const OUTPUT_URL = new URL("../data/cache/ratings/house-aggregator-2026.json", import.meta.url);
const DEFAULT_URL = process.env.HOUSE_RATINGS_AGGREGATOR_URL || "";

function htmlToText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRows(html) {
  const rows = [];
  for (const table of String(html || "").matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const tableHtml = table[0];
    const headerCells = [...(tableHtml.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || "").matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)]
      .map((cell) => htmlToText(cell[1]));
    const sourceColumns = headerCells
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => /cook|inside|sabat|crystal|split|race\s*to\s*the\s*wh|economist|votehub|rating/i.test(header));
    for (const rowMatch of tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...rowMatch[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => htmlToText(cell[1]));
      const districtText = cells.find((cell) => /\b[A-Z]{2}-(?:AL|\d{1,2})\b/.test(cell));
      const district = districtText?.match(/\b([A-Z]{2})-(AL|\d{1,2})\b/)?.[0];
      if (!district || district === "DC-AL") continue;
      const sources = {};
      for (const { header, index } of sourceColumns) {
        const parsed = normalizeRating(cells[index]);
        if (!parsed) continue;
        const sourceKey = header.toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()
          .replace(/\s+([a-z0-9])/g, (_, char) => char.toUpperCase());
        sources[sourceKey || "aggregatorTable"] = {
          rating: parsed.normalized,
          source: header,
          sourceType: "AGGREGATOR_TABLE",
          url: DEFAULT_URL
        };
      }
      if (Object.keys(sources).length) {
        rows.push({
          raceId: `${district.replace(/-(\d)$/, "-0$1")}-2026`,
          district: district.replace(/-(\d)$/, "-0$1"),
          sources,
          url: DEFAULT_URL
        });
      }
    }
  }
  return rows;
}

function writeCache(payload) {
  mkdirSync(new URL("../data/cache/ratings/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT_URL, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const generatedAt = new Date().toISOString();
  if (!DEFAULT_URL) {
    writeCache({
      source: "Optional public House ratings aggregator table",
      status: "MANUAL_NOT_CONFIGURED",
      generatedAt,
      url: "",
      rows: [],
      note: "Set HOUSE_RATINGS_AGGREGATOR_URL to parse a public House ratings table. Absence is not a forecast failure."
    });
    return;
  }

  try {
    const response = await fetch(DEFAULT_URL, { headers: { "user-agent": "Federal Elections Analysis data updater" } });
    const html = await response.text();
    const rows = response.ok ? parseTableRows(html) : [];
    writeCache({
      source: "Optional public House ratings aggregator table",
      status: response.ok ? (rows.length ? "OK_PARSED" : "OK_NO_ROWS") : `HTTP_${response.status}`,
      generatedAt,
      url: DEFAULT_URL,
      rows,
      warnings: rows.length ? [] : ["No parseable House rating rows found."]
    });
  } catch (error) {
    writeCache({
      source: "Optional public House ratings aggregator table",
      status: "FETCH_FAILED",
      generatedAt,
      url: DEFAULT_URL,
      rows: [],
      warnings: [error.message]
    });
  }
}

main();
