import { existsSync, readFileSync } from "node:fs";
import { cacheEnvelope } from "../forecast-cache.mjs";
import { normalizeRating } from "./rating-priors.mjs";

const ROOT = new URL("../../", import.meta.url);

export const COOK_HOUSE_270_URL = "https://www.270towin.com/2026-house-election/table/cook-political-report-2026-house-ratings";
export const HOUSE_MAP_270_URL = "https://www.270towin.com/2026-house-election/inside-elections-2026-house-ratings";

const COOK_CATEGORY_ALIASES = new Map([
  ["solid dem", "Safe D"],
  ["solid democrat", "Safe D"],
  ["solid democratic", "Safe D"],
  ["likely dem", "Likely D"],
  ["likely democrat", "Likely D"],
  ["likely democratic", "Likely D"],
  ["leans dem", "Lean D"],
  ["lean dem", "Lean D"],
  ["lean democrat", "Lean D"],
  ["leans democrat", "Lean D"],
  ["tilt dem", "Tilt D"],
  ["tilt democrat", "Tilt D"],
  ["toss-up", "Toss-up"],
  ["toss up", "Toss-up"],
  ["tossup", "Toss-up"],
  ["tilt rep", "Tilt R"],
  ["tilt republican", "Tilt R"],
  ["leans rep", "Lean R"],
  ["lean rep", "Lean R"],
  ["lean republican", "Lean R"],
  ["leans republican", "Lean R"],
  ["likely rep", "Likely R"],
  ["likely republican", "Likely R"],
  ["solid rep", "Safe R"],
  ["solid republican", "Safe R"]
]);

const MAP_CONFLICT_DISTRICTS = new Set(["AL-02"]);

export function readJson(relativePath, fallback = null) {
  try {
    const url = new URL(relativePath.replaceAll("\\", "/"), ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

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

function normalizeDistrictId(state, district) {
  if (!state || !district) return null;
  const suffix = String(district).toUpperCase() === "AL" ? "AL" : String(Number(district)).padStart(2, "0");
  if (suffix !== "AL" && suffix === "NaN") return null;
  return `${state}-${suffix}`;
}

function cookCategoryFromLine(line) {
  const clean = String(line || "")
    .replace(/\(\d+\).*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return COOK_CATEGORY_ALIASES.get(clean) || null;
}

export function parseCookHouseRatings(html, { asOf = new Date().toISOString().slice(0, 10), url = COOK_HOUSE_270_URL } = {}) {
  const lines = htmlToLines(html);
  const rows = [];
  let rating = null;
  for (const line of lines) {
    const nextRating = cookCategoryFromLine(line);
    if (nextRating) {
      rating = nextRating;
      continue;
    }
    const match = line.match(/^([A-Z]{2})-(AL|\d{1,2})$/);
    if (!match || !rating) continue;
    const district = normalizeDistrictId(match[1], match[2]);
    if (!district || district === "DC-AL") continue;
    rows.push({
      raceId: `${district}-2026`,
      district,
      office: "house",
      cycle: 2026,
      source: "Cook Political Report via 270toWin",
      sourceKey: "cook",
      rating,
      asOf,
      url,
      status: "OK_PARSED"
    });
  }
  return uniqueBy(rows, (row) => row.raceId);
}

function extractJsonAssignment(html, marker) {
  if (typeof html !== "string" || !html) return null;
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = html.indexOf("{", markerIndex);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  return null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parse270HouseBaselines(html) {
  const json = extractJsonAssignment(html, "map_d3.seats =");
  if (!json) return [];
  const parsed = JSON.parse(json);
  return Object.values(parsed).flatMap((stateRows) => stateRows).map((district) => {
    const state = district.state_abbr;
    const number = Number(district.district_number);
    const atLarge = String(district.district_id_combo || "").endsWith("00");
    const id = `${state}-${atLarge ? "AL" : String(number).padStart(2, "0")}`;
    const presidentialMargin2024 = toNumber(district.margin_president);
    const houseMargin2024 = toNumber(district.margin_congress);
    const comparableHouseMargin2024 = Number.isFinite(houseMargin2024) && Math.abs(houseMargin2024) < 70;
    return {
      district: id,
      state,
      districtNumber: atLarge ? "AL" : String(number).padStart(2, "0"),
      mapVersion: "2026 enacted/current assumption from 270toWin map feed",
      redistrictingConfidence: MAP_CONFLICT_DISTRICTS.has(id) ? "CONFLICTING_SOURCES" : "UNKNOWN",
      presidentialMargin2024: Number.isFinite(presidentialMargin2024) && Math.abs(presidentialMargin2024) > 0.01 ? presidentialMargin2024 : null,
      houseMargin2024: comparableHouseMargin2024 ? houseMargin2024 : null,
      houseMargin2024Comparable: comparableHouseMargin2024,
      houseMargin2022: null,
      pvi: null,
      incumbentParty: district.seat_party || null,
      incumbentRunning: district.retired_code ? false : null,
      openSeat: Boolean(district.retired_code),
      confidence: Number.isFinite(presidentialMargin2024) || comparableHouseMargin2024 ? "MEDIUM" : "LOW",
      source: "SOURCE_BACKED",
      independent: true,
      sources: [HOUSE_MAP_270_URL]
    };
  }).filter((row) => row.district && row.district !== "DC-AL");
}

export function sourceBackedHouseBaselines(mapHtml = "") {
  const mapRows = mapHtml ? parse270HouseBaselines(mapHtml) : [];
  const mapByDistrict = new Map(mapRows.map((row) => [row.district, row]));
  const house2024 = readJson("data/baselines/house-2024-districts.json", { districts: [] });
  const sourceRows = [];
  for (const row of house2024.districts || []) {
    if (!row?.id || row.id === "DC-AL") continue;
    const rowMargin = Number(row.margin);
    const comparable = Number.isFinite(rowMargin) && Math.abs(rowMargin) > 0.01 && Math.abs(rowMargin) < 70;
    const mapRow = mapByDistrict.get(row.id) || {};
    sourceRows.push({
      district: row.id,
      state: row.state,
      districtNumber: row.district,
      mapVersion: mapRow.mapVersion || "2024 certified district result baseline; 2026 map crosswalk unavailable",
      redistrictingConfidence: mapRow.redistrictingConfidence || (MAP_CONFLICT_DISTRICTS.has(row.id) ? "CONFLICTING_SOURCES" : "UNKNOWN"),
      presidentialMargin2024: Number.isFinite(mapRow.presidentialMargin2024) ? mapRow.presidentialMargin2024 : null,
      houseMargin2024: comparable ? rowMargin : null,
      houseMargin2024Comparable: comparable,
      houseMargin2022: null,
      pvi: null,
      incumbentParty: mapRow.incumbentParty || null,
      incumbentRunning: typeof mapRow.incumbentRunning === "boolean" ? mapRow.incumbentRunning : null,
      openSeat: Boolean(mapRow.openSeat),
      sources: [
        house2024.sourceFile || "data/baselines/house-2024-districts.json",
        ...(mapRow.sources || [])
      ],
      confidence: comparable || Number.isFinite(mapRow.presidentialMargin2024) ? "MEDIUM" : "LOW",
      source: "SOURCE_BACKED",
      independent: true,
      warnings: comparable ? [] : ["2024 House margin was uncontested or near-uncontested and is not comparable."]
    });
  }
  for (const mapRow of mapRows) {
    if (!sourceRows.some((row) => row.district === mapRow.district)) sourceRows.push(mapRow);
  }
  return uniqueBy(sourceRows, (row) => row.district).sort((a, b) => a.district.localeCompare(b.district, undefined, { numeric: true }));
}

function manualHouseRatingRows() {
  const benchmarks = readJson("data/forecast-benchmarks.json", { races: {}, updatedAt: null });
  const rows = [];
  for (const [raceId, sources] of Object.entries(benchmarks.races || {})) {
    if (!/-[0-9]{2}-2026$|-AL-2026$/.test(raceId)) continue;
    const district = raceId.replace(/-2026$/, "");
    for (const [sourceKey, value] of Object.entries(sources || {})) {
      if (!value || typeof value !== "object" || !value.rating) continue;
      const parsed = normalizeRating(value.rating);
      if (!parsed) continue;
      rows.push({
        raceId,
        district,
        office: "house",
        cycle: 2026,
        sourceKey,
        source: value.source || sourceKey,
        rating: parsed.normalized,
        asOf: value.asOf || benchmarks.updatedAt || null,
        url: value.url || "",
        status: "OK_PARSED"
      });
    }
  }
  return rows;
}

function uniqueBy(rows, keyFn) {
  const seen = new Map();
  for (const row of rows) seen.set(keyFn(row), row);
  return [...seen.values()];
}

function nearestRatingFromMargin(margin) {
  const value = Number(margin);
  if (!Number.isFinite(value)) return null;
  const party = value >= 0 ? "D" : "R";
  const abs = Math.abs(value);
  if (abs >= 14) return `Safe ${party}`;
  if (abs >= 7) return `Likely ${party}`;
  if (abs >= 3) return `Lean ${party}`;
  if (abs >= 1) return `Tilt ${party}`;
  return "Toss-up";
}

function impliedMarginForRating(rating) {
  return normalizeRating(rating)?.impliedMargin ?? null;
}

function consensusRating(rows) {
  const margins = rows.map((row) => impliedMarginForRating(row.rating)).filter(Number.isFinite);
  if (!margins.length) return null;
  const average = margins.reduce((sum, value) => sum + value, 0) / margins.length;
  return nearestRatingFromMargin(average);
}

function inferredSafeRating(baseline) {
  if (!baseline || MAP_CONFLICT_DISTRICTS.has(baseline.district)) return null;
  const values = [baseline.presidentialMargin2024, baseline.houseMargin2024].filter(Number.isFinite);
  if (!values.length) return null;
  const weighted = values.length === 2 ? values[0] * 0.6 + values[1] * 0.4 : values[0];
  if (Math.abs(weighted) < 14) return null;
  return nearestRatingFromMargin(weighted);
}

export function mergedHouseRatingsCache({ cookRows = [], baselines = sourceBackedHouseBaselines(), asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const manualRows = manualHouseRatingRows();
  const externalRows = [...cookRows, ...manualRows].filter((row) => normalizeRating(row.rating));
  const externalByRace = Object.groupBy(externalRows, (row) => row.raceId);
  const baselineByDistrict = new Map(baselines.map((row) => [row.district, row]));
  const allDistricts = [...new Set([...baselines.map((row) => row.district), ...externalRows.map((row) => row.district)])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = [];
  for (const district of allDistricts) {
    const raceId = `${district}-2026`;
    const sourceRows = externalByRace[raceId] || [];
    const baseline = baselineByDistrict.get(district) || null;
    if (MAP_CONFLICT_DISTRICTS.has(district)) {
      rows.push({
        raceId,
        district,
        office: "house",
        cycle: 2026,
        rating: consensusRating(sourceRows),
        ratingSourceType: "MAP_CONFLICT_RATING_DISABLED",
        sources: Object.fromEntries(sourceRows.map((row) => [row.sourceKey || row.source, { rating: row.rating, asOf: row.asOf, url: row.url, source: row.source }])),
        status: "DISABLED",
        asOf,
        warnings: ["Map conflict: rating kept for comparison only."]
      });
      continue;
    }
    if (sourceRows.length) {
      rows.push({
        raceId,
        district,
        office: "house",
        cycle: 2026,
        rating: consensusRating(sourceRows),
        ratingSourceType: "EXTERNAL_RATING",
        sources: Object.fromEntries(sourceRows.map((row) => [row.sourceKey || row.source, { rating: row.rating, asOf: row.asOf, url: row.url, source: row.source }])),
        status: "OK_PARSED",
        asOf,
        sourceCount: sourceRows.length
      });
      continue;
    }
    const inferred = inferredSafeRating(baseline);
    rows.push({
      raceId,
      district,
      office: "house",
      cycle: 2026,
      rating: inferred,
      ratingSourceType: inferred ? "INFERRED_SAFE_RATING" : "RATING_UNAVAILABLE",
      sources: inferred ? {
        inferredSafeRating: {
          rating: inferred,
          source: "Source-backed district baseline",
          asOf,
          notes: "District absent from competitive ratings tables and baseline is strongly one-party."
        }
      } : {},
      status: inferred ? "OK_PARSED" : "OK_NO_ROWS",
      asOf,
      baselineConfidence: baseline?.confidence || "MISSING"
    });
  }
  return cacheEnvelope({
    source: "Merged House ratings cache: Cook/270toWin + manual ledger + source-backed inferred safe ratings",
    office: "house",
    asOf,
    rows,
    status: rows.some((row) => row.ratingSourceType === "EXTERNAL_RATING") ? "OK_PARSED" : "OK_NO_ROWS",
    meta: {
      externalRows: externalRows.length,
      cookRows: cookRows.length,
      manualRows: manualRows.length,
      inferredSafeRows: rows.filter((row) => row.ratingSourceType === "INFERRED_SAFE_RATING").length,
      unavailableRows: rows.filter((row) => row.ratingSourceType === "RATING_UNAVAILABLE").length
    }
  });
}

export function readHouseRatingsCacheMap() {
  const cache = readJson("data/cache/ratings/house-2026.json", { rows: [] });
  return new Map((cache.rows || []).map((row) => [row.raceId, row]));
}

export function readHouseFundamentalsCacheMap() {
  const cache = readJson("data/cache/fundamentals/house-district-baselines-2026.json", { rows: [] });
  return new Map((cache.rows || []).map((row) => [row.district || row.id, row]));
}

export function fundamentalsCacheEnvelope(rows, { asOf = new Date().toISOString(), status = "OK_PARSED", warnings = [] } = {}) {
  return cacheEnvelope({
    source: "data/baselines/house-2024-districts.json + 270toWin district map fields",
    office: "house",
    asOf,
    rows,
    status,
    warnings,
    meta: {
      sourceBackedRows: rows.filter((row) => row.source === "SOURCE_BACKED").length,
      independentRows: rows.filter((row) => row.independent).length,
      lowConfidenceRows: rows.filter((row) => row.confidence === "LOW").length
    }
  });
}
