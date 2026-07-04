import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditHouseBaselineDistrict,
  buildHouseBaselineAudit,
  marginConsistencyCheck
} from "./lib/house-baseline-audit.mjs";
import {
  applyCurrentMapBaselineAnchor
} from "./lib/house-current-map-baselines.mjs";
import {
  POLL_VALIDATION_STATUSES,
  SOURCE_TRUST_LEVELS,
  validatePollRow
} from "./lib/poll-validation.mjs";
import {
  applyRatingGuardrail,
  buildRatingPrior
} from "./lib/rating-priors.mjs";
import {
  applyPrimarySyncToRace,
  primarySyncMap
} from "./lib/primary-sync.mjs";

const TRUST_CONFIG = {
  sources: {
    "270towin": { trust: SOURCE_TRUST_LEVELS.TRUSTED_SEMI_STRUCTURED, label: "270toWin" },
    "wikipedia": { trust: SOURCE_TRUST_LEVELS.QUARANTINED, label: "Wikipedia" },
    "legacy-model-input": { trust: SOURCE_TRUST_LEVELS.LEGACY_FALLBACK, label: "Legacy model input" },
    "direct-poll-ledger": { trust: SOURCE_TRUST_LEVELS.MANUAL_VERIFIED, label: "Manual direct poll ledger" }
  },
  aliases: {}
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  } catch {
    return null;
  }
}

const spreadOnly = validatePollRow({
  office: "house",
  state: "IA",
  tableType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
  endDate: "2026-06-15",
  candidates: [{ name: "Democrat", pct: null }, { name: "Republican", pct: null }],
  margin: 2.4,
  source: "270toWin",
  sourceKey: "270towin"
}, {
  office: "house",
  state: "IA",
  source: "270toWin",
  sourceKey: "270towin",
  allowSpreadOnly: true,
  trustConfig: TRUST_CONFIG
});
assert.equal(spreadOnly.validationStatus, POLL_VALIDATION_STATUSES.USABLE, "Semi-structured spread-only polling rows should be usable when explicitly allowed.");
assert.equal(spreadOnly.usedInModel, true);

const quarantined = validatePollRow({
  office: "senate",
  state: "ME",
  tableType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
  endDate: "2026-06-15",
  candidates: [{ name: "Democrat", pct: 45 }, { name: "Republican", pct: 42 }],
  margin: 3,
  sourceKey: "wikipedia"
}, {
  office: "senate",
  state: "ME",
  sourceKey: "wikipedia",
  trustConfig: TRUST_CONFIG
});
assert.equal(quarantined.validationStatus, POLL_VALIDATION_STATUSES.QUARANTINED);
assert.equal(quarantined.usedInModel, false);

const legacy = validatePollRow({
  office: "governor",
  state: "IA",
  tableType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
  endDate: "2026-06-15",
  candidates: [{ name: "Sand", pct: 50 }, { name: "Lahn", pct: 41 }],
  margin: 9,
  sourceKey: "legacy-model-input"
}, {
  office: "governor",
  state: "IA",
  sourceKey: "legacy-model-input",
  trustConfig: TRUST_CONFIG
});
assert.equal(legacy.sourceTrust, SOURCE_TRUST_LEVELS.LEGACY_FALLBACK);
assert.equal(legacy.usedInModel, false);

const prior = buildRatingPrior({
  office: "house",
  raceId: "UNIT-2026",
  benchmark: { cook: { rating: "Lean D" } },
  rawModelMargin: -8,
  pollingSummary: { pollCount: 0 },
  fundamentalsQuality: "UNVERIFIED"
});
assert.ok(prior.ratingsPriorDistribution, "Rating priors should publish the underlying distribution metadata.");
const guardrail = applyRatingGuardrail(-4, prior);
assert.equal(guardrail.guardrailMode, "soft-penalty");
assert.ok(!/CANNOT|FLOOR|MAX/i.test(guardrail.reason), "Rating guardrails must not use old hard-clamp reason strings.");
assert.ok(guardrail.guardrailedMargin > -4, "Soft guardrail should pull impossible no-poll crossings toward the external prior.");

const synced = applyPrimarySyncToRace({
  state: "IA",
  demCandidate: "Democratic field",
  repCandidate: "Republican field"
}, "governor", primarySyncMap({
  races: [{
    raceId: "IA-GOV-2026",
    demNominee: "Rob Sand",
    demStatus: "presumptive nominee",
    repNominee: "Zach Lahn",
    repStatus: "presumptive nominee",
    primaryDate: "2026-06-01"
  }]
}));
assert.equal(synced.demCandidate, "Rob Sand");
assert.equal(synced.repCandidate, "Zach Lahn");
assert.equal(synced.primarySync.applied, true);

const staleAnchor = applyCurrentMapBaselineAnchor({
  type: "CACHE_BASELINE",
  margin: -20,
  confidence: "LOW"
}, {
  district: "UNIT-01",
  baselineMargin: -20,
  baselineSource: "missing",
  effectiveFor2026: false,
  confidence: "UNVERIFIED",
  mapVersion: "unit-test"
});
assert.equal(staleAnchor.effectiveFor2026, false);
assert.equal(staleAnchor.margin, -20, "Diagnostics keep stale baseline data visible.");

const audit = auditHouseBaselineDistrict({
  id: "UNIT-02",
  baselineAnchor: { margin: 13, confidence: "VERIFIED", effectiveFor2026: true },
  ratingsPrior: { consensusRating: "Safe D", impliedMargin: 24, sourceRatings: [{ source: "Cook", rating: "Safe D", impliedMargin: 24 }] },
  projectedMargin: 18,
  probabilityEngineMargin: 16,
  usablePollCount: 0,
  nationalEnvironment: { districtElasticity: 0.5, nationalEnvironmentEffect: 2 }
});
assert.ok(audit.auditFlags.includes("BASELINE_RATING_SAME_PARTY_GAP"), "Same-party baseline/rating gaps should remain visible as warnings.");
assert.notEqual(audit.severity, "high", "Same-party baseline/rating gaps should not be high-severity false positives.");

const consistency = marginConsistencyCheck({ projectedMargin: 2, probabilityMargin: -1 });
assert.ok(consistency.flags.includes("PROJECTED_PROBABILITY_DIRECTION_CONFLICT"));
const summary = buildHouseBaselineAudit([
  {
  id: "UNIT-03",
    baselineAnchor: { margin: 13, confidence: "VERIFIED", effectiveFor2026: true },
    ratingsPrior: { consensusRating: "Safe D", impliedMargin: 24 },
    projectedMargin: 18,
    probabilityEngineMargin: 16,
    nationalEnvironment: { districtElasticity: 0.5, nationalEnvironmentEffect: 2 }
  }
]);
assert.ok("samePartyFalsePositiveRateEstimate" in summary.summary);

const house = readJson("data/house-forecast.json");
if (house?.districts?.length) {
  for (const district of house.districts) {
    const reasons = [
      district.ratingGuardrail?.projected?.reason,
      district.ratingGuardrail?.probability?.reason,
      district.marginDecomposition?.ratingGuardrailReason
    ].filter(Boolean);
    for (const reason of reasons) {
      assert.ok(!/CANNOT|FLOOR|MAX/i.test(reason), `${district.id}: stale hard-clamp guardrail reason is still present.`);
    }
    if (district.ratingsPrior?.enabled) {
      assert.ok(district.ratingsPrior.ratingsPriorDistribution, `${district.id}: enabled ratings prior must publish distribution metadata.`);
    }
  }
}

console.log("House calibration validation passed.");
