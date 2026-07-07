import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url);

export const V3_GENERATED_AT = new Date().toISOString();

export function repoPath(relativePath) {
  return fileURLToPath(new URL(relativePath, ROOT));
}

export function readJson(relativePath, fallback = null) {
  const file = repoPath(relativePath);
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJson(relativePath, value) {
  const file = repoPath(relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function preserveLegacySnapshot(sourcePath, snapshotPath) {
  const source = repoPath(sourcePath);
  const snapshot = repoPath(snapshotPath);
  if (!existsSync(source) || existsSync(snapshot)) return;
  mkdirSync(dirname(snapshot), { recursive: true });
  copyFileSync(source, snapshot);
}

export function readForecastSeed(sourcePath, snapshotPath) {
  preserveLegacySnapshot(sourcePath, snapshotPath);
  return readJson(snapshotPath) || readJson(sourcePath);
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function probabilityFromMargin(margin, sigma) {
  return clamp(normalCdf(margin / Math.max(1.5, sigma)), 0.001, 0.999);
}

export function normalizeRating(rawRating) {
  const value = String(rawRating || "").trim().toLowerCase();
  if (!value || value === "null" || value === "undefined") return null;
  if (/map conflict|scenario/.test(value)) return "Map Conflict";
  if (/toss|even/.test(value)) return "Toss-up";
  const party = /(^|[^a-z])d(em|emocrat|emocratic)?([^a-z]|$)|blue/.test(value) ? "D"
    : /(^|[^a-z])r(ep|epublican)?([^a-z]|$)|red|gop/.test(value) ? "R"
    : null;
  if (!party) return null;
  if (/safe|solid/.test(value)) return `Safe ${party}`;
  if (/likely/.test(value)) return `Likely ${party}`;
  if (/lean/.test(value)) return `Lean ${party}`;
  if (/tilt/.test(value)) return `Tilt ${party}`;
  return null;
}

export const RATING_PRIORS = {
  "Safe D": { mean: 22, sigma: 4.2, rank: 4 },
  "Likely D": { mean: 11, sigma: 5.4, rank: 3 },
  "Lean D": { mean: 5.5, sigma: 6.4, rank: 2 },
  "Tilt D": { mean: 2, sigma: 7.4, rank: 1 },
  "Toss-up": { mean: 0, sigma: 8.2, rank: 0 },
  "Tilt R": { mean: -2, sigma: 7.4, rank: -1 },
  "Lean R": { mean: -5.5, sigma: 6.4, rank: -2 },
  "Likely R": { mean: -11, sigma: 5.4, rank: -3 },
  "Safe R": { mean: -22, sigma: 4.2, rank: -4 }
};

export function ratingMean(rating) {
  return RATING_PRIORS[normalizeRating(rating)]?.mean ?? 0;
}

export function ratingSigma(rating) {
  return RATING_PRIORS[normalizeRating(rating)]?.sigma ?? 8.2;
}

export function ratingFromMargin(margin) {
  if (margin >= 15) return "Safe D";
  if (margin >= 8) return "Likely D";
  if (margin >= 4) return "Lean D";
  if (margin >= 1) return "Tilt D";
  if (margin > -1) return "Toss-up";
  if (margin > -4) return "Tilt R";
  if (margin > -8) return "Lean R";
  if (margin > -15) return "Likely R";
  return "Safe R";
}

export function marginDisplay(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.05) return "Even";
  return `${value > 0 ? "D" : "R"}+${Math.abs(value).toFixed(1)}`;
}

export function marginRecord(value, source, confidence = "MEDIUM") {
  const rounded = Number.isFinite(value) ? round(value, 2) : null;
  return {
    party: rounded == null ? null : rounded > 0 ? "D" : rounded < 0 ? "R" : null,
    value: rounded,
    display: rounded == null ? "--" : marginDisplay(rounded),
    source,
    confidence
  };
}

export function buildInputBalance(weights) {
  const cleaned = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0) || 1;
  const shares = Object.fromEntries(Object.entries(cleaned).map(([key, value]) => [key, round(value / total, 3)]));
  const dominantInput = Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] || "ratings";
  return { weights: cleaned, shares, dominantInput };
}

export function splitConfidence(probability, marginConfidence, dataConfidence) {
  const p = Math.max(probability, 1 - probability);
  const winConfidence = p >= 0.95 ? "HIGH" : p >= 0.8 ? "MEDIUM_HIGH" : p >= 0.65 ? "MEDIUM" : "LOW";
  return { winConfidence, marginConfidence, dataConfidence };
}

export function raceIdForOffice(office, race) {
  if (office === "house") return `${race.id || race.district || race.raceId}`.replace(/-2026$/, "") + "-2026";
  const state = race.state || race.raceId;
  if (office === "senate") return `${state}-SEN-2026`;
  if (office === "governor") return `${state}-GOV-2026`;
  return `${state || race.raceId}-${office}-2026`;
}

export function raceAliases(office, race) {
  const state = race.state;
  const district = race.id || race.district;
  const canonical = raceIdForOffice(office, race);
  const aliases = new Set([canonical, race.raceId, race.id, district, `${district}-2026`, state]);
  if (office === "senate") {
    aliases.add(`${state}-SEN`);
    aliases.add(`${state}-SEN-2026`);
    aliases.add(`${state}-race-2026`);
  }
  if (office === "governor") {
    aliases.add(`${state}-GOV`);
    aliases.add(`${state}-GOV-2026`);
    aliases.add(`${state}-race-2026`);
    aliases.add(`${state}-governor-2026`);
  }
  return [...aliases].filter(Boolean);
}

export function canonicalPollRaceId(row) {
  const office = String(row.office || "").toLowerCase();
  if (office === "house") {
    const raw = row.raceId || row.district || "";
    return String(raw).replace(/-2026$/, "") + "-2026";
  }
  if (office === "senate") return `${row.state}-SEN-2026`;
  if (office === "governor") return `${row.state}-GOV-2026`;
  return row.raceId || `${row.state}-${office}-2026`;
}

function isValidatedGeneralPoll(row) {
  const status = String(row.validationStatus || row.status || "").toUpperCase();
  const rowType = String(row.rowType || row.tableType || "").toUpperCase();
  const sourceKind = String(row.sourceKind || row.source || "").toUpperCase();
  return status === "VALID"
    && row.usedInModel !== false
    && /GENERAL/.test(rowType)
    && !/FORECAST|FALLBACK|GENERATED|SYNTHETIC|QUARANTINE|REJECT/.test(sourceKind)
    && Number.isFinite(Number(row.margin));
}

function rowsFromJson(relativePath) {
  const json = readJson(relativePath);
  if (!json) return [];
  if (Array.isArray(json)) return json;
  return json.rows || json.polls || json.entries || json.races || json.districts || [];
}

export function buildLiveGeneralLedgerV3() {
  const sourceFiles = [
    "data/cache/polls/upstream-canonical-2026.json",
    "data/staging/polls/validated/senate-2026.json",
    "data/staging/polls/validated/house-2026.json",
    "data/staging/polls/validated/governor-2026.json"
  ];
  const seen = new Set();
  const rows = [];
  for (const sourceFile of sourceFiles) {
    for (const row of rowsFromJson(sourceFile)) {
      if (!isValidatedGeneralPoll(row)) continue;
      const canonicalRaceId = canonicalPollRaceId(row);
      const key = [
        canonicalRaceId,
        row.pollster,
        row.sponsor,
        row.endDate,
        row.sampleSize,
        row.margin
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...row,
        canonicalRaceId,
        ledgerSourcePath: sourceFile,
        countedAsLivePoll: true
      });
    }
  }
  const countsByOffice = {};
  for (const row of rows) countsByOffice[row.office] = (countsByOffice[row.office] || 0) + 1;
  const ledger = {
    schemaVersion: "v3",
    generatedAt: V3_GENERATED_AT,
    description: "Single source of truth for validated live/manual general-election polls allowed into v3 forecasts.",
    rules: [
      "validationStatus must be VALID",
      "usedInModel must not be false",
      "rowType/tableType must be a general-election poll",
      "forecast-derived, fallback, synthetic, rejected, and quarantined rows are excluded"
    ],
    counts: { total: rows.length, byOffice: countsByOffice },
    rows
  };
  writeJson("data/staging/polls/live-general-ledger-v3.json", ledger);
  return ledger;
}

export function buildRatingsPriorLedgerV3() {
  const sourceFiles = {
    house: "data/cache/ratings/house-ratings-priors-2026.json",
    senate: "data/cache/ratings/senate-ratings-priors-2026.json",
    governor: "data/cache/ratings/governor-ratings-priors-2026.json"
  };
  const rows = [];
  for (const [office, sourceFile] of Object.entries(sourceFiles)) {
    for (const row of rowsFromJson(sourceFile)) {
      const rating = normalizeRating(row.rating);
      rows.push({
        ...row,
        office,
        canonicalRaceId: row.raceId,
        normalizedRating: rating,
        v3Prior: rating && rating !== "Map Conflict" ? {
          mean: ratingMean(rating),
          sigma: ratingSigma(rating),
          rating,
          source: "ratings-prior-ledger-v3"
        } : null,
        ledgerSourcePath: sourceFile
      });
    }
  }
  const countsByOffice = {};
  for (const row of rows) countsByOffice[row.office] = (countsByOffice[row.office] || 0) + 1;
  const ledger = {
    schemaVersion: "v3",
    generatedAt: V3_GENERATED_AT,
    description: "Normalized expert/rating priors used as distributions, not hard clamps.",
    counts: { total: rows.length, byOffice: countsByOffice },
    rows
  };
  writeJson("data/staging/ratings/ratings-prior-ledger-v3.json", ledger);
  return ledger;
}

export function buildHouseBaselineLedgerV3() {
  const source = readJson("data/staging/baselines/house-baseline-ledger-v2.json", { rows: [] });
  const rows = (source.rows || []).map((row) => {
    const verification = String(row.verificationStatus || "").toUpperCase();
    const comparable = row.comparableFor2026 === true || row.effectiveFor2026 === true;
    const verifiedCurrent = /VERIFIED_CURRENT_MAP|VERIFIED/.test(verification) && comparable && row.historicalContextOnly !== true;
    const translatedCurrent = /TRANSLATED_CURRENT_MAP|CROSSWALK/.test(verification) && comparable;
    const useAsAnchor = Boolean(verifiedCurrent || translatedCurrent);
    return {
      ...row,
      canonicalRaceId: `${row.raceId || row.district}-2026`.replace(/-2026-2026$/, "-2026"),
      v3Treatment: useAsAnchor ? (verifiedCurrent ? "VERIFIED_CURRENT_MAP_ANCHOR" : "TRANSLATED_CURRENT_MAP_REDUCED_WEIGHT")
        : "HISTORICAL_CONTEXT_ONLY",
      useAsAnchor,
      useAsContext: !useAsAnchor,
      v3EffectiveWeight: useAsAnchor ? (verifiedCurrent ? 0.35 : 0.18) : 0,
      v3Notes: useAsAnchor
        ? "Eligible as v3 current-map baseline input."
        : "Not used as a primary v3 forecast anchor because current-map comparability is not verified."
    };
  });
  const verifiedCurrentMapBaselineCount = rows.filter((row) => row.useAsAnchor).length;
  const ledger = {
    schemaVersion: "v3",
    generatedAt: V3_GENERATED_AT,
    source: "data/staging/baselines/house-baseline-ledger-v2.json",
    mode: verifiedCurrentMapBaselineCount === 0 ? "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" : "RATINGS_PLUS_VERIFIED_CURRENT_MAP_BASELINES",
    counts: {
      total: rows.length,
      verifiedCurrentMapBaselineCount,
      historicalContextOnlyCount: rows.filter((row) => !row.useAsAnchor).length
    },
    rows
  };
  writeJson("data/staging/baselines/house-baseline-ledger-v3.json", ledger);
  return ledger;
}

export function buildFinanceLedgerV3() {
  const sourceFiles = [
    "data/cache/finance/house-2026-v2.json",
    "data/cache/finance/senate-2026-v2.json",
    "data/cache/finance/governor-2026-v2.json",
    "data/cache/finance/house-2026.json",
    "data/cache/finance/senate-2026.json",
    "data/cache/finance/governor-2026.json"
  ];
  const rows = [];
  const seen = new Set();
  for (const sourceFile of sourceFiles) {
    for (const row of rowsFromJson(sourceFile)) {
      const office = row.office || sourceFile.match(/finance\/([a-z]+)-/)?.[1] || "unknown";
      const id = row.raceId || row.id || row.state;
      const key = `${office}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hasReceipts = Number.isFinite(Number(row.totalReceipts)) && Number(row.totalReceipts) > 0;
      const hasCandidateLevel = Array.isArray(row.candidates) && row.candidates.some((candidate) => Number(candidate.totalReceipts) > 0);
      const active = hasReceipts && hasCandidateLevel;
      rows.push({
        ...row,
        office,
        canonicalRaceId: office === "house" ? `${id}`.replace(/-2026$/, "") + "-2026"
          : office === "senate" ? `${id}-SEN-2026`
          : office === "governor" ? `${id}-GOV-2026`
          : id,
        v3Active: active,
        effect: active ? "AVAILABLE_RACE_LEVEL_CANDIDATE_FINANCE" : "INACTIVE_NO_VERIFIED_RACE_LEVEL_CANDIDATE_FINANCE",
        ledgerSourcePath: sourceFile
      });
    }
  }
  const ledger = {
    schemaVersion: "v3",
    generatedAt: V3_GENERATED_AT,
    description: "Race-level finance ledger. Summary placeholders are explicitly inactive.",
    counts: {
      total: rows.length,
      activeRaceLevelRows: rows.filter((row) => row.v3Active).length,
      inactiveRows: rows.filter((row) => !row.v3Active).length
    },
    rows
  };
  writeJson("data/staging/finance/race-finance-ledger-v3.json", ledger);
  return ledger;
}

export function buildTrustLedgersV3() {
  return {
    polls: buildLiveGeneralLedgerV3(),
    ratings: buildRatingsPriorLedgerV3(),
    baselines: buildHouseBaselineLedgerV3(),
    finance: buildFinanceLedgerV3()
  };
}

export function indexByAliases(rows, keyField = "canonicalRaceId") {
  const index = new Map();
  for (const row of rows || []) {
    const keys = [row[keyField], row.raceId, row.id, row.state, row.district].filter(Boolean);
    for (const key of keys) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
  }
  return index;
}

export function rowsForRace(index, office, race) {
  const rows = [];
  const seen = new Set();
  for (const alias of raceAliases(office, race)) {
    for (const row of index.get(alias) || []) {
      if (row.office && String(row.office).toLowerCase() !== String(office).toLowerCase()) continue;
      const id = row.ledgerId || row.canonicalRaceId || row.raceId || JSON.stringify(row);
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
  }
  return rows;
}

export function averagePollMargin(rows) {
  if (!rows.length) return null;
  let weighted = 0;
  let total = 0;
  for (const row of rows) {
    const size = Number(row.sampleSize);
    const weight = Number.isFinite(size) ? Math.sqrt(Math.max(100, size)) : 20;
    weighted += Number(row.margin) * weight;
    total += weight;
  }
  return total ? weighted / total : null;
}

export function ratingsPriorForRace(ratingsIndex, office, race) {
  const rows = rowsForRace(ratingsIndex, office, race);
  const row = rows[0];
  const rating = normalizeRating(row?.normalizedRating || row?.rating || race.modelRating || race.rating || race.baselineRating);
  const prior = rating && rating !== "Map Conflict" ? RATING_PRIORS[rating] : null;
  return {
    row,
    rating,
    prior,
    rows
  };
}

export function financeForRace(financeIndex, office, race) {
  return rowsForRace(financeIndex, office, race).find((row) => row.v3Active) || null;
}

export function baselineForHouseRace(baselineIndex, race) {
  return rowsForRace(baselineIndex, "house", race)[0] || null;
}

export function buildRatingsPriorMetadata({ rating, weight, ledgerRow, enabled = true }) {
  const normalized = normalizeRating(rating);
  const distribution = normalized && RATING_PRIORS[normalized] ? {
    rating: normalized,
    mean: RATING_PRIORS[normalized].mean,
    sigma: RATING_PRIORS[normalized].sigma,
    marginUnit: "Democratic two-party margin points"
  } : null;
  return {
    enabled: Boolean(enabled && distribution),
    weight: round(weight, 3),
    rating: normalized,
    source: "data/staging/ratings/ratings-prior-ledger-v3.json",
    usedAs: enabled ? "DISTRIBUTIONAL_PRIOR" : "COMPARISON_ONLY",
    ratingsPriorDistribution: distribution,
    sources: ledgerRow ? [{ source: "ratings-prior-ledger-v3", rating: normalized, raceId: ledgerRow.canonicalRaceId || ledgerRow.raceId }] : []
  };
}

export function pollingMetadata(rows) {
  if (!rows.length) {
    return {
      status: "NO_RACE_POLLS",
      source: "data/staging/polls/live-general-ledger-v3.json",
      validatedPollCount: 0,
      livePollCount: 0,
      countedAsLivePolling: false,
      explanation: "No validated general-election race polls exist in the v3 live poll ledger."
    };
  }
  return {
    status: rows.some((row) => String(row.sourceKind || "").includes("manual")) ? "MANUAL_POLLS_AVAILABLE" : "LIVE_POLLS_AVAILABLE",
    source: "data/staging/polls/live-general-ledger-v3.json",
    validatedPollCount: rows.length,
    livePollCount: rows.length,
    countedAsLivePolling: true,
    pollsterCount: new Set(rows.map((row) => row.pollster).filter(Boolean)).size,
    averageMargin: round(averagePollMargin(rows), 2)
  };
}

export function financeMetadata(row) {
  if (!row) {
    return {
      status: "INACTIVE_NO_VERIFIED_RACE_LEVEL_CANDIDATE_FINANCE",
      active: false,
      source: "data/staging/finance/race-finance-ledger-v3.json",
      effect: 0
    };
  }
  return {
    status: "ACTIVE_RACE_LEVEL",
    active: true,
    source: "data/staging/finance/race-finance-ledger-v3.json",
    effect: 0,
    totalReceipts: row.totalReceipts,
    cashOnHand: row.cashOnHand,
    lastReportDate: row.lastReportDate
  };
}

export function sourceHealthForPolling(pollMeta, extraReasons = []) {
  const noPolls = pollMeta.validatedPollCount === 0;
  return {
    forecast: noPolls ? "PARTIAL" : "HEALTHY",
    degraded: noPolls,
    racePolling: pollMeta.status,
    health: noPolls ? "DEGRADED" : "HEALTHY",
    reasons: noPolls ? ["no validated v3 live poll rows", ...extraReasons] : ["validated v3 live poll rows available", ...extraReasons]
  };
}

export function runSeatSimulation(items, probabilityAccessor, options = {}) {
  const iterations = options.iterations || 100000;
  const baseSeats = options.baseSeats || 0;
  const threshold = options.threshold || Math.floor(items.length / 2) + 1;
  const distribution = {};
  let demControl = 0;
  let seed = 246813579;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const probabilities = items.map((item) => clamp(probabilityAccessor(item), 0.001, 0.999));
  const expectedDemSeats = baseSeats + probabilities.reduce((sum, p) => sum + p, 0);
  for (let i = 0; i < iterations; i += 1) {
    let demSeats = baseSeats;
    for (const p of probabilities) if (random() < p) demSeats += 1;
    distribution[demSeats] = (distribution[demSeats] || 0) + 1;
    if (demSeats >= threshold) demControl += 1;
  }
  const ordered = Object.entries(distribution).flatMap(([seat, count]) => Array(count).fill(Number(seat))).sort((a, b) => a - b);
  const medianSeats = ordered[Math.floor(ordered.length / 2)];
  return {
    iterations,
    expectedDemSeats: round(expectedDemSeats, 2),
    expectedRepSeats: round((options.totalSeats || items.length + baseSeats) - expectedDemSeats, 2),
    medianDemSeats: medianSeats,
    medianRepSeats: (options.totalSeats || items.length + baseSeats) - medianSeats,
    demControlProbability: round(demControl / iterations, 4),
    repControlProbability: round(1 - demControl / iterations, 4),
    distribution
  };
}

export function sanitizeNoLivePollingClaims(race, pollMeta) {
  const noPolls = pollMeta.validatedPollCount === 0;
  if (!noPolls) return race;
  return {
    ...race,
    polls: [],
    pollCount: 0,
    usablePollCount: 0,
    livePollCount: 0,
    manualPollCount: 0,
    legacyFallbackPollCount: race.legacyFallbackPollCount || 0,
    totalPollInputsUsed: 0,
    pollingStatus: "NO_RACE_POLLS",
    pollSignal: null,
    pollingSummary: {
      ...(race.pollingSummary || {}),
      usablePollCount: 0,
      livePollCount: 0,
      status: "NO_RACE_POLLS"
    },
    sourceInputs: {
      ...(race.sourceInputs || {}),
      pollMargin: {
        value: null,
        usableAsGeneralElectionPoll: false,
        source: "data/staging/polls/live-general-ledger-v3.json",
        explanation: "No validated general-election race polls in v3 ledger."
      }
    }
  };
}

export function updateCommonTopLevel(forecast, office, trustLedgers, extra = {}) {
  const pollRows = trustLedgers.polls.rows.filter((row) => row.office === office);
  const activeFinanceRows = trustLedgers.finance.rows.filter((row) => row.office === office && row.v3Active);
  return {
    ...forecast,
    modelVersion: "2026-v3",
    coreVersion: "v3",
    inputPipeline: "trust-ledger-v3",
    generatedAt: V3_GENERATED_AT,
    lastUpdated: V3_GENERATED_AT,
    forecastStatus: extra.forecastStatus || forecast.forecastStatus || "REVIEW",
    featureFlags: {
      ...(forecast.featureFlags || {}),
      trustLedgerV3: true,
      financePlaceholdersInactive: true,
      strictPollProvenance: true
    },
    sourceProvenanceSummary: {
      ...(forecast.sourceProvenanceSummary || {}),
      v3Ledgers: {
        polls: "data/staging/polls/live-general-ledger-v3.json",
        ratings: "data/staging/ratings/ratings-prior-ledger-v3.json",
        finance: "data/staging/finance/race-finance-ledger-v3.json",
        baselines: office === "house" ? "data/staging/baselines/house-baseline-ledger-v3.json" : null
      },
      validatedLiveGeneralPollRows: pollRows.length,
      activeRaceLevelFinanceRows: activeFinanceRows.length
    },
    trustState: {
      office,
      pollLedgerRows: pollRows.length,
      activeFinanceRows: activeFinanceRows.length,
      generatedAt: V3_GENERATED_AT,
      mode: extra.mode || null
    },
    ...extra.topLevel
  };
}

export function moduleMain(importMetaUrl, runner) {
  if (process.argv[1] && pathToFileURL(process.argv[1]).href === importMetaUrl) {
    runner().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
