import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildHouseBaselineAudit } from "./lib/house-baseline-audit.mjs";
import { applyCurrentMapBaselineAnchor, currentMapBaselineForDistrict, readCurrentMapBaselineMap } from "./lib/house-current-map-baselines.mjs";
import { readHouseFundamentalsCacheMap, readHouseRatingsCacheMap } from "./lib/house-input-caches.mjs";
import { normalizeRating } from "./lib/rating-priors.mjs";

const FORECAST_URL = new URL("../data/house-forecast.json", import.meta.url);
const OUTPUT_URL = new URL("../data/diagnostics/house-baseline-audit-2026.json", import.meta.url);
const CURRENT_MAP_BASELINES = readCurrentMapBaselineMap();

function readJson(url) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return null;
  }
}

function districtIdFromRaceId(raceId) {
  return String(raceId || "").replace(/-2026$/, "");
}

function sourceRatingsFromCacheRow(row) {
  if (!row) return [];
  if (Array.isArray(row.sourceRatings)) return row.sourceRatings;
  const rating = row.rating || row.consensusRating || null;
  if (!rating) return [];
  return [{
    source: row.source || row.sourceKey || "Cached House rating",
    rating,
    impliedMargin: normalizeRating(rating)?.impliedMargin ?? null,
    sourceType: row.ratingSourceType || row.sourceType || null,
    asOf: row.asOf || null,
    url: row.url || ""
  }];
}

function fallbackDistrictsFromCaches() {
  const fundamentals = readHouseFundamentalsCacheMap();
  const ratings = readHouseRatingsCacheMap();
  const ids = new Set([
    ...[...fundamentals.keys()].map(districtIdFromRaceId),
    ...[...ratings.keys()].map(districtIdFromRaceId)
  ].filter(Boolean));
  return [...ids].sort().map((id) => {
    const fundamentalsRow = fundamentals.get(id) || fundamentals.get(`${id}-2026`) || {};
    const ratingsRow = ratings.get(`${id}-2026`) || ratings.get(id) || {};
    const contextualMargin = Number(
      fundamentalsRow.margin
      ?? fundamentalsRow.fundamentalMargin
      ?? fundamentalsRow.houseMargin2024
      ?? fundamentalsRow.presidentialMargin2024
      ?? fundamentalsRow.presidentialMargin
    );
    const rating = ratingsRow.consensusRating || ratingsRow.rating || null;
    const parsedRating = normalizeRating(rating);
    const sourceBaselineAnchor = {
      type: fundamentalsRow.baselineType || fundamentalsRow.source || "CACHE_BASELINE",
      margin: Number.isFinite(contextualMargin) ? contextualMargin : null,
      source: fundamentalsRow.source || "data/cache/fundamentals/house-district-baselines-2026.json",
      mapVersion: fundamentalsRow.mapVersion || "2026 current assumption",
      confidence: fundamentalsRow.confidence || fundamentalsRow.sourceConfidence || "UNKNOWN"
    };
    return {
      id,
      baselineAnchor: applyCurrentMapBaselineAnchor(sourceBaselineAnchor, currentMapBaselineForDistrict(id, CURRENT_MAP_BASELINES)),
      ratingsPrior: {
        enabled: Boolean(rating),
        consensusRating: parsedRating?.normalized || rating,
        impliedMargin: parsedRating?.impliedMargin ?? null,
        sourceRatings: sourceRatingsFromCacheRow(ratingsRow),
        ratingSourceType: ratingsRow.ratingSourceType || ratingsRow.sourceType || null
      },
      projectedMargin: null,
      probabilityEngineMargin: null,
      preRatingProbabilityMargin: null,
      usablePollCount: 0,
      redistrictingConfidence: fundamentalsRow.redistrictingConfidence || "UNKNOWN",
      mapVersion: fundamentalsRow.mapVersion || null
    };
  });
}

const forecast = readJson(FORECAST_URL);
const districts = Array.isArray(forecast?.districts) && forecast.districts.length
  ? forecast.districts
  : fallbackDistrictsFromCaches();
const audit = buildHouseBaselineAudit(districts);

mkdirSync(new URL("../data/diagnostics/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_URL, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(`Wrote data/diagnostics/house-baseline-audit-2026.json for ${audit.summary.districts} House districts.`);
