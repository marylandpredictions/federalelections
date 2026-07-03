import { existsSync, readFileSync } from "node:fs";
import { sanitizePollingCache } from "./poll-validation.mjs";

const CACHE_ROOT = new URL("../../data/cache/polls/", import.meta.url);
const MONTHS = new Map([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12]
]);

const IGNORED_HEADERS = [
  /poll(?:ster| source)?/i,
  /date/i,
  /sample/i,
  /margin/i,
  /moe|margin of error/i,
  /undecided/i,
  /other/i,
  /lead/i,
  /ref/i,
  /notes?/i
];

export function wikipediaPageUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/\s+/g, "_"))}`;
}

function decode(text) {
  return String(text || "")
    .replace(/<sup[\s\S]*?<\/sup>/gi, "")
    .replace(/<span[^>]*class="sortkey"[\s\S]*?<\/span>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRows(html) {
  return [...String(html || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .map((row) => [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => decode(cell[1])))
    .filter((cells) => cells.length >= 3);
}

function numericPct(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseParty(value) {
  const text = String(value || "").toLowerCase();
  if (/\((?:d|dem)\)|\bdem(?:ocrat|ocratic)?\b/.test(text)) return "D";
  if (/\((?:r|rep|gop)\)|\brep(?:ublican)?\b|\bgop\b/.test(text)) return "R";
  if (/\bind(?:ependent)?\b|\(i\)/.test(text)) return "I";
  return null;
}

function cleanCandidateName(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(text, fallbackYear = 2026) {
  const clean = String(text || "").toLowerCase().replace(/–/g, "-");
  const monthMatch = clean.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (!monthMatch) return null;
  const month = MONTHS.get(monthMatch[1]);
  const numbers = [...clean.matchAll(/\b(\d{1,2})\b/g)].map((match) => Number(match[1])).filter((value) => value >= 1 && value <= 31);
  const day = numbers.at(-1);
  if (!month || !day) return null;
  return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rowType(cells) {
  const text = cells.join(" ").toLowerCase();
  if (/average|realclear|rcp|270towin|race to the wh|polling average/.test(text)) return "POLLING_AVERAGE";
  return "RAW_POLL";
}

function inferMargin(candidates, marginCell) {
  const explicit = String(marginCell || "").match(/([A-Za-z .'-]+)?\s*([+-]?\d+(?:\.\d+)?)/);
  if (explicit && Number.isFinite(Number(explicit[2]))) {
    const value = Number(explicit[2]);
    const leadText = String(explicit[1] || "").toLowerCase();
    const leader = candidates.find((candidate) => leadText && candidate.name.toLowerCase().includes(leadText.trim()));
    if (leader?.party === "R") return -Math.abs(value);
    if (leader?.party === "D") return Math.abs(value);
  }
  const byParty = {
    D: candidates.filter((candidate) => candidate.party === "D").sort((a, b) => b.pct - a.pct)[0],
    R: candidates.filter((candidate) => candidate.party === "R").sort((a, b) => b.pct - a.pct)[0]
  };
  if (byParty.D && byParty.R) return byParty.D.pct - byParty.R.pct;
  if (candidates.length >= 2) return candidates[0].pct - candidates[1].pct;
  return null;
}

function isPollingTable(html, index) {
  const before = String(html || "").slice(Math.max(0, index - 2200), index).toLowerCase();
  const lastHeading = before.match(/<h[2-4][\s\S]*?<\/h[2-4]>[\s\S]*$/i)?.[0] || before;
  return /polling|opinion poll|general election poll|primary poll|hypothetical polling/.test(lastHeading)
    && !/results|candidate filing|endorsements|fundraising|primary results/.test(lastHeading.slice(-900));
}

export function parseWikipediaPollingPage(html, { office, state, raceId, title, url, year = 2026 } = {}) {
  const rows = [];
  const warnings = [];
  for (const table of String(html || "").matchAll(/<table[^>]*class="[^"]*wikitable[\s\S]*?<\/table>/gi)) {
    if (!isPollingTable(html, table.index || 0)) continue;
    const parsedRows = tableRows(table[0]);
    if (parsedRows.length < 2) continue;
    const headers = parsedRows[0];
    const sourceIndex = headers.findIndex((header) => /poll(?:ster| source)?/i.test(header));
    const dateIndex = headers.findIndex((header) => /date/i.test(header));
    const sampleIndex = headers.findIndex((header) => /sample/i.test(header));
    const marginIndex = headers.findIndex((header) => /margin|lead/i.test(header));
    const candidateIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header, index }) => index > -1 && !IGNORED_HEADERS.some((pattern) => pattern.test(header)));
    if (candidateIndexes.length < 2) {
      warnings.push(`Skipped polling table on ${title || raceId || state || "unknown page"} because candidate columns were not detected.`);
      continue;
    }
    for (const cells of parsedRows.slice(1)) {
      const candidates = candidateIndexes
        .map(({ header, index }) => ({
          name: cleanCandidateName(header),
          party: parseParty(header),
          pct: numericPct(cells[index])
        }))
        .filter((candidate) => candidate.name && Number.isFinite(candidate.pct))
        .sort((a, b) => b.pct - a.pct);
      const margin = inferMargin(candidates, cells[marginIndex]);
      if (!Number.isFinite(margin)) {
        warnings.push(`Skipped row on ${title || raceId || state || "unknown page"} because no usable margin could be inferred.`);
        continue;
      }
      const pollster = cells[sourceIndex] || "Wikipedia polling table";
      const endDate = parseDate(cells[dateIndex], year);
      const sampleText = cells[sampleIndex] || "";
      const sampleSize = numericPct(sampleText?.replace(/,/g, ""));
      rows.push({
        office,
        state,
        raceId,
        title,
        sourceUrl: url,
        source: "Wikipedia polling table",
        pollster,
        endDate,
        sampleSize,
        population: /lv|likely/i.test(sampleText) ? "LV" : /rv|registered/i.test(sampleText) ? "RV" : null,
        margin: Number(margin.toFixed(2)),
        tableType: rowType(cells) === "POLLING_AVERAGE" ? "POLLING_AVERAGE" : "WIKIPEDIA_UNVALIDATED_TABLE_ROW",
        candidates,
        rowType: rowType(cells),
        wikipedia: true
      });
    }
  }
  const deduped = dedupeWikipediaPollRows(rows);
  return {
    rows: deduped.filter((row) => row.rowType !== "POLLING_AVERAGE"),
    averages: deduped.filter((row) => row.rowType === "POLLING_AVERAGE"),
    warnings,
    dedupe: {
      inputRows: rows.length,
      duplicatesRemoved: rows.length - deduped.length
    }
  };
}

export function dedupeWikipediaPollRows(rows = []) {
  const seen = new Map();
  for (const row of rows) {
    const key = [
      row.office,
      row.raceId || row.state,
      String(row.pollster || "").toLowerCase().replace(/\W+/g, ""),
      row.endDate || "no-date",
      row.margin
    ].join("|");
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

export function readWikipediaPollingCache(office) {
  const url = new URL(`wikipedia-${office}-2026.json`, CACHE_ROOT);
  try {
    if (!existsSync(url)) {
      return {
        status: "MISSING",
        rows: [],
        rawRows: [],
        usableRows: [],
        rejectedRows: [],
        averages: [],
        usedInModel: false
      };
    }
    const cache = JSON.parse(readFileSync(url, "utf8"));
    return sanitizePollingCache(cache, {
      office,
      source: "Wikipedia election polling tables",
      forceQuarantine: true,
      quarantineReason: "WIKIPEDIA_EXPERIMENTAL_DO_NOT_USE_IN_FORECAST"
    });
  } catch (error) {
    return {
      status: "PARSE_FAILED",
      rows: [],
      rawRows: [],
      usableRows: [],
      rejectedRows: [],
      averages: [],
      usedInModel: false,
      warnings: [error.message]
    };
  }
}

export function wikipediaPollRowsByState(cache) {
  if (cache?.usedInModel !== true) return {};
  return Object.groupBy((cache?.usableRows || []).filter((row) => row.rowType !== "POLLING_AVERAGE"), (row) => row.state);
}

export function wikipediaPollingSummary(cache) {
  return {
    status: cache?.status || "MISSING",
    rawPollRows: cache?.rawRows?.length || cache?.rows?.length || 0,
    usablePollRows: cache?.usableRows?.length || 0,
    rejectedPollRows: cache?.rejectedRows?.length || 0,
    pollingAverageRows: cache?.averages?.length || 0,
    usedInModel: cache?.usedInModel === true,
    pollingValidation: cache?.pollingValidation || null,
    pages: cache?.meta?.pages || 0,
    parseWarnings: cache?.warnings?.length || 0,
    note: "Wikipedia rows are cached for inspection only. They are quarantined and not counted as model polling inputs until the parser is explicitly promoted."
  };
}
