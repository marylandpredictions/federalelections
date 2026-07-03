import { normalizeRating } from "./rating-priors.mjs";

export const HOUSE_BASELINE_REVIEW_DISTRICTS = [
  "CA-48",
  "FL-09",
  "FL-14",
  "FL-22",
  "TX-35",
  "AL-02",
  "TX-28",
  "TX-34",
  "OH-09",
  "PA-08",
  "WI-03",
  "NJ-07",
  "WA-03",
  "CO-08",
  "AZ-06"
];

const REVIEW_SET = new Set(HOUSE_BASELINE_REVIEW_DISTRICTS);

function finite(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function partyFromMargin(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 0.25) return null;
  return number > 0 ? "D" : "R";
}

function categoryFromMargin(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const party = partyFromMargin(number);
  const abs = Math.abs(number);
  if (!party || abs < 1) return { rank: 0, party: null, rating: "Toss-up" };
  if (abs >= 14) return { rank: 4, party, rating: `Safe ${party}` };
  if (abs >= 7) return { rank: 3, party, rating: `Likely ${party}` };
  if (abs >= 3) return { rank: 2, party, rating: `Lean ${party}` };
  return { rank: 1, party, rating: `Tilt ${party}` };
}

function categoryDistance(modelMargin, rating) {
  const model = categoryFromMargin(modelMargin);
  const parsed = normalizeRating(rating);
  if (!model || !parsed) return null;
  if (!model.party || !parsed.party) return Math.abs(model.rank - parsed.rank);
  if (model.party !== parsed.party) return model.rank + parsed.rank;
  return Math.abs(model.rank - parsed.rank);
}

function ratingSourceRows(input) {
  const rows = input?.ratingsPrior?.sourceRatings
    || input?.sourceRatings
    || input?.ratingBenchmark?.sourceRatings
    || [];
  if (Array.isArray(rows) && rows.length) {
    return rows
      .map((row) => ({
        source: row.source || row.sourceKey || "External rating",
        rating: row.rating || row.normalized || null,
        impliedMargin: finite(row.impliedMargin),
        sourceType: row.sourceType || null,
        asOf: row.asOf || null,
        url: row.url || ""
      }))
      .filter((row) => row.rating);
  }
  const rating = input?.ratingsPrior?.consensusRating || input?.externalRating || input?.rating || null;
  if (!rating) return [];
  return [{
    source: input?.ratingsPrior?.sources?.[0] || input?.fallbackRatingSource || "External rating",
    rating,
    impliedMargin: finite(normalizeRating(rating)?.impliedMargin),
    sourceType: input?.ratingsPrior?.ratingSourceType || "EXTERNAL_RATING",
    asOf: null,
    url: ""
  }];
}

function baselineConfidence(input) {
  return String(
    input?.baselineAnchor?.confidence
    || input?.baselineAnchor?.sourceConfidence
    || input?.fundamentalsQuality
    || input?.redistrictingConfidence
    || "UNKNOWN"
  ).toUpperCase();
}

function baselineIsVerified(input) {
  const confidence = baselineConfidence(input);
  const type = String(input?.baselineAnchor?.type || "").toUpperCase();
  const source = String(input?.baselineAnchor?.source || "").toUpperCase();
  return confidence === "HIGH" || source.includes("CURRENT") || source.includes("119TH") || type.includes("CURRENT_MAP");
}

function diagnosticMessage(flags) {
  if (flags.includes("REDISTRICTING_CONFLICT")) return "Map scenario must be verified before a hard ratings guardrail is allowed.";
  if (flags.includes("BASELINE_RATING_CONFLICT")) return "Reduce fundamentals weight and increase ratings-prior weight unless current-map baseline is verified.";
  if (flags.includes("MISSING_CURRENT_MAP_BASELINE")) return "Treat district as ratings-heavy until a source-backed current-map baseline is available.";
  if (flags.includes("PROJECTED_MARGIN_PROBABILITY_CONFLICT")) return "Review projected-result and probability-engine margin fields before publishing.";
  return "No immediate baseline correction recommended.";
}

export function marginConsistencyCheck({ projectedMargin, probabilityMargin, demProbability, repProbability }) {
  const projected = Number(projectedMargin);
  const probability = Number(probabilityMargin);
  const flags = [];
  if (Number.isFinite(projected) && Number.isFinite(probability)) {
    const projectedParty = partyFromMargin(projected);
    const probabilityParty = partyFromMargin(probability);
    if (projectedParty && probabilityParty && projectedParty !== probabilityParty) {
      flags.push("PROJECTED_MARGIN_PROBABILITY_CONFLICT");
    }
  }
  return {
    projectedResultMargin: finite(projected),
    probabilityMargin: finite(probability),
    winProbability: {
      D: finite(demProbability, 4),
      R: finite(repProbability, 4)
    },
    consistent: !flags.length,
    flags,
    message: flags.length
      ? "Projected result margin and probability engine point in different directions."
      : "Projected result margin and probability engine point in the same direction."
  };
}

export function auditHouseBaselineDistrict(input = {}) {
  const id = input.district?.id || input.id || input.district || input.raceId || null;
  const baselineMargin = Number(input.baselineAnchor?.margin ?? input.baselineMargin);
  const externalRatings = ratingSourceRows(input);
  const consensus = input.ratingsPrior?.consensusRating
    || externalRatings[0]?.rating
    || input.rating
    || null;
  const parsedRating = normalizeRating(consensus);
  const ratingImpliedMargin = Number(input.ratingsPrior?.impliedMargin ?? parsedRating?.impliedMargin);
  const baselineRatingDifference = Number.isFinite(baselineMargin) && Number.isFinite(ratingImpliedMargin)
    ? baselineMargin - ratingImpliedMargin
    : null;
  const projectedMargin = Number(input.projectedMargin);
  const probabilityMargin = Number(input.probabilityMargin ?? input.probabilityEngineMargin);
  const rawModelMargin = Number(input.rawModelMargin ?? input.rawProbabilityMargin ?? input.preRatingProbabilityMargin);
  const usablePolls = Number(input.usablePollCount ?? input.pollingSummary?.usablePollCount ?? 0);
  const mapConflict = Boolean(
    input.mapConflict
    || input.ratingIsConditional
    || input.forecastStatus === "SCENARIO_ONLY"
    || /CONFLICT|SCENARIO/i.test(String(input.redistrictingConfidence || ""))
    || /CONFLICT/i.test(String(input.ratingsPrior?.ratingSourceType || ""))
  );
  const flags = [];
  const confidence = baselineConfidence(input);
  const baselineMissing = !Number.isFinite(baselineMargin);
  const ratingParty = partyFromMargin(ratingImpliedMargin);
  const baselineParty = partyFromMargin(baselineMargin);
  const rawParty = partyFromMargin(rawModelMargin);
  const projectedParty = partyFromMargin(projectedMargin);
  const probabilityParty = partyFromMargin(probabilityMargin);
  const ratingDistance = categoryDistance(rawModelMargin, consensus);

  if (baselineMissing) flags.push("MISSING_CURRENT_MAP_BASELINE");
  if (mapConflict) flags.push("REDISTRICTING_CONFLICT");
  if (
    Number.isFinite(baselineRatingDifference)
    && ratingParty
    && baselineParty
    && (
      (ratingParty !== baselineParty && Math.abs(baselineRatingDifference) >= 5)
      || Math.abs(baselineRatingDifference) >= 10
    )
  ) {
    flags.push("BASELINE_RATING_CONFLICT");
  }
  if (flags.includes("BASELINE_RATING_CONFLICT") && !baselineIsVerified(input)) {
    flags.push("POSSIBLE_STALE_BOUNDARY_OR_OLD_DISTRICT_RESULT");
  }
  if (projectedParty && probabilityParty && projectedParty !== probabilityParty) {
    flags.push("PROJECTED_MARGIN_PROBABILITY_CONFLICT");
  }
  if (
    usablePolls === 0
    && Number.isFinite(rawModelMargin)
    && Number.isFinite(ratingImpliedMargin)
    && Math.abs(rawModelMargin - ratingImpliedMargin) >= 5
  ) {
    flags.push("RATING_PRIOR_TOO_WEAK");
  }
  if (
    flags.includes("BASELINE_RATING_CONFLICT")
    && !baselineIsVerified(input)
    && rawParty
    && baselineParty
    && rawParty === baselineParty
  ) {
    flags.push("FUNDAMENTALS_TOO_STRONG_FOR_UNVERIFIED_BASELINE");
  }

  const elasticity = Number(input.nationalEnvironment?.districtElasticity ?? input.districtElasticity?.districtElasticity);
  const nationalEffect = Number(input.nationalEnvironment?.nationalEnvironmentEffect);
  if (!Number.isFinite(elasticity)) flags.push("ELASTICITY_MISSING");
  else if (elasticity < 0.1 || elasticity > 1.1) flags.push("ELASTICITY_OUT_OF_RANGE");
  if (parsedRating?.rank >= 4 && Number.isFinite(nationalEffect) && Math.abs(nationalEffect) >= 4.5) {
    flags.push("NATIONAL_EFFECT_TOO_HIGH_FOR_SAFE_DISTRICT");
  }
  if (parsedRating?.normalized === "Toss-up" && Number.isFinite(nationalEffect) && Math.abs(nationalEffect) < 1) {
    flags.push("NATIONAL_EFFECT_TOO_LOW_FOR_TOSSUP");
  }
  if (Number.isFinite(ratingDistance) && ratingDistance >= 2 && usablePolls === 0) {
    flags.push("RATING_PRIOR_TOO_WEAK");
  }

  const uniqueFlags = [...new Set(flags)];
  const highSeverityFlags = uniqueFlags.filter((flag) => [
    "BASELINE_RATING_CONFLICT",
    "REDISTRICTING_CONFLICT",
    "PROJECTED_MARGIN_PROBABILITY_CONFLICT",
    "FUNDAMENTALS_TOO_STRONG_FOR_UNVERIFIED_BASELINE"
  ].includes(flag));

  return {
    district: id,
    mandatoryReview: REVIEW_SET.has(id),
    baselineAnchor: {
      type: input.baselineAnchor?.type || null,
      margin: Number.isFinite(baselineMargin) ? finite(baselineMargin) : null,
      source: input.baselineAnchor?.source || null,
      mapVersion: input.baselineAnchor?.mapVersion || input.mapVersion || "2026 current assumption",
      confidence
    },
    externalRatings,
    consensusRating: parsedRating?.normalized || consensus || null,
    ratingImpliedMargin: Number.isFinite(ratingImpliedMargin) ? finite(ratingImpliedMargin) : null,
    baselineRatingDifference: Number.isFinite(baselineRatingDifference) ? finite(baselineRatingDifference) : null,
    rawModelMargin: Number.isFinite(rawModelMargin) ? finite(rawModelMargin) : null,
    projectedMargin: Number.isFinite(projectedMargin) ? finite(projectedMargin) : null,
    probabilityMargin: Number.isFinite(probabilityMargin) ? finite(probabilityMargin) : null,
    usablePollCount: Number.isFinite(usablePolls) ? usablePolls : 0,
    ratingCategoryDistance: Number.isFinite(ratingDistance) ? ratingDistance : null,
    nationalEnvironment: {
      districtElasticity: Number.isFinite(elasticity) ? finite(elasticity, 3) : null,
      nationalEnvironmentEffect: Number.isFinite(nationalEffect) ? finite(nationalEffect) : null
    },
    auditFlags: uniqueFlags,
    severity: highSeverityFlags.length ? "high" : uniqueFlags.length ? "warning" : "none",
    reviewRequired: REVIEW_SET.has(id) || uniqueFlags.length > 0,
    recommendedAction: diagnosticMessage(uniqueFlags)
  };
}

export function buildHouseBaselineAudit(districts = [], options = {}) {
  const audits = districts.map((district) => auditHouseBaselineDistrict(district));
  const byFlag = {};
  for (const item of audits) {
    for (const flag of item.auditFlags) byFlag[flag] = (byFlag[flag] || 0) + 1;
  }
  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    schemaVersion: "2026.house-baseline-audit.1",
    summary: {
      districts: audits.length,
      mandatoryReviewDistricts: HOUSE_BASELINE_REVIEW_DISTRICTS,
      mandatoryReviewFlagged: audits.filter((item) => item.mandatoryReview && item.reviewRequired).map((item) => item.district),
      reviewRequired: audits.filter((item) => item.reviewRequired).length,
      highSeverity: audits.filter((item) => item.severity === "high").length,
      byFlag
    },
    districts: audits
  };
}
