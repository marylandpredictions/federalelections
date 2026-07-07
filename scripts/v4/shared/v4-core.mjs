// scripts/v4/ is the canonical publish stack. It must produce one manifest-bound
// v4 contract and fail closed when trusted inputs are missing or stale.
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SCHEMA_VERSION = "v4";
export const CORE_VERSION = "v4";
export const INPUT_PIPELINE = "upstream-ingest-normalize-validate-ledger-v4";
export const STRICT_RELEASE_GATES = true;

export const CANONICAL_ARTIFACTS = {
  houseForecast: "data/v4/house-forecast.json",
  senateForecast: "data/v4/senate-forecast.json",
  governorForecast: "data/v4/governor-forecast.json",
  houseDiagnostics: "data/v4/diagnostics/house-diagnostics.json",
  senateDiagnostics: "data/v4/diagnostics/senate-diagnostics.json",
  governorDiagnostics: "data/v4/diagnostics/governor-diagnostics.json",
  diagnosticsSummary: "data/v4/diagnostics/diagnostics-summary.json",
  houseReview: "data/v4/diagnostics/house-review.json",
  senateReview: "data/v4/diagnostics/senate-review.json",
  governorReview: "data/v4/diagnostics/governor-review.json",
  houseSimulation: "data/v4/diagnostics/house-simulation.json",
  houseCurrentMapBaselineLedger: "data/v4/house/current-map-baseline-ledger.json",
  houseRedistrictingStatusLedger: "data/v4/house/redistricting-status-ledger.json",
  houseBenchmarks: "data/v4/benchmarks/house-benchmarks.json",
  senateBenchmarks: "data/v4/benchmarks/senate-benchmarks.json",
  governorBenchmarks: "data/v4/benchmarks/governor-benchmarks.json",
  benchmarkSummary: "data/v4/benchmarks/benchmark-summary.json",
  releaseGateSummary: "data/v4/release-gates/release-gate-summary.json",
  uiAdapter: "data/v4/ui/forecast-ui-adapter.json"
};

export const FORBIDDEN_LEGACY_FIELDS = [
  "demControlProbability",
  "republicanControlProbability",
  "houseDemControlProbability",
  "modelDemControl",
  "modelDemProbability",
  "controlOdds",
  "seatProjection",
  "legacyTopline"
];

export const RATING_PRIOR_MEANS = new Map([
  ["safe d", 22],
  ["solid d", 22],
  ["likely d", 11],
  ["lean d", 5.5],
  ["tilt d", 2],
  ["toss-up", 0],
  ["tossup", 0],
  ["toss up", 0],
  ["tilt r", -2],
  ["lean r", -5.5],
  ["likely r", -11],
  ["safe r", -22],
  ["solid r", -22]
]);

export function repoPath(path) {
  return join(ROOT, path);
}

export function readJson(path, fallback = null) {
  const fullPath = repoPath(path);
  if (!existsSync(fullPath)) return fallback;
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

export function writeJson(path, value) {
  const fullPath = repoPath(path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

export function ensureV4Dirs() {
  [
    "data/v4",
    "data/v4/diagnostics",
    "data/v4/benchmarks",
    "data/v4/run-manifests",
    "data/v4/release-gates",
    "data/v4/house",
    "data/v4/ui",
    "scripts/v4",
    "schemas/v4",
    "tests/v4"
  ].forEach((path) => mkdirSync(repoPath(path), { recursive: true }));
}

export function nowIso() {
  return new Date().toISOString();
}

export function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function buildRunManifest() {
  ensureV4Dirs();
  const generatedAt = nowIso();
  const manifest = {
    runId: `${generatedAt}-v4`,
    generatedAt,
    schemaVersion: SCHEMA_VERSION,
    coreVersion: CORE_VERSION,
    inputPipeline: INPUT_PIPELINE,
    strictReleaseGates: STRICT_RELEASE_GATES,
    artifacts: CANONICAL_ARTIFACTS
  };
  writeJson("data/v4/run-manifests/latest-run.json", manifest);
  return manifest;
}

export function readLatestManifestOrCreate() {
  return readJson("data/v4/run-manifests/latest-run.json") || buildRunManifest();
}

export function artifactHeader(manifest, artifactType) {
  return {
    runId: manifest.runId,
    generatedAt: manifest.generatedAt,
    schemaVersion: SCHEMA_VERSION,
    coreVersion: CORE_VERSION,
    inputPipeline: INPUT_PIPELINE,
    strictReleaseGates: STRICT_RELEASE_GATES,
    runManifest: "data/v4/run-manifests/latest-run.json",
    artifactType
  };
}

export function normalizeRating(rating) {
  if (!rating) return "Unrated";
  const text = String(rating).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (lower.includes("safe d") || lower.includes("solid d")) return "Safe D";
  if (lower.includes("likely d")) return "Likely D";
  if (lower.includes("lean d")) return "Lean D";
  if (lower.includes("tilt d")) return "Tilt D";
  if (lower.includes("toss")) return "Toss-up";
  if (lower.includes("tilt r")) return "Tilt R";
  if (lower.includes("lean r")) return "Lean R";
  if (lower.includes("likely r")) return "Likely R";
  if (lower.includes("safe r") || lower.includes("solid r")) return "Safe R";
  return text;
}

export function ratingsPriorFromRating(rating, sourceCount = 1) {
  const consensusRating = normalizeRating(rating);
  const meanMargin = RATING_PRIOR_MEANS.get(consensusRating.toLowerCase()) ?? 0;
  const abs = Math.abs(meanMargin);
  const sigma = abs >= 20 ? 7 : abs >= 10 ? 5.5 : abs >= 5 ? 4.5 : 3.5;
  return {
    status: consensusRating === "Unrated" ? "UNAVAILABLE" : "AVAILABLE",
    usedInModel: consensusRating !== "Unrated",
    consensusRating,
    meanMargin,
    sigma,
    sourceCount: Number(sourceCount) || 0,
    sourceDisagreement: false
  };
}

export function districtCode(state, district) {
  if (!district && district !== 0) return state;
  const raw = String(district).replace(/^0+/, "");
  if (!raw || raw.toLowerCase() === "al") return `${state}-AL`;
  return `${state}-${raw.padStart(2, "0")}`;
}

export function canonicalRaceId(office, row, index = 0) {
  if (row.canonicalRaceId) return String(row.canonicalRaceId);
  if (row.raceId) return String(row.raceId);
  if (row.id) return String(row.id);
  const state = row.state || row.stateCode || "US";
  if (office === "house") return `${districtCode(state, row.district)}-HOUSE-2026`;
  if (office === "senate") return `${state}-SENATE-2026`;
  if (office === "governor") return `${state}-GOVERNOR-2026`;
  return `${office.toUpperCase()}-${index + 1}`;
}

export function extractRowsForOffice(office, source) {
  if (!source) return [];
  if (office === "house") return source.districts || source.races || [];
  return source.races || source.states || source.forecasts || [];
}

export function inferCandidateStatus(row, party) {
  const key = party === "D" ? "demStatus" : "repStatus";
  const nameKey = party === "D" ? "demCandidate" : "repCandidate";
  const status = row[key] || row.nomination || row.primarySummary?.status;
  const candidate = row[nameKey] || row[party.toLowerCase()] || party;
  if (status && /presumptive/i.test(String(status))) return "PRESUMPTIVE";
  if (candidate && !["Democrat", "Republican", "D", "R"].includes(String(candidate))) return "VERIFIED";
  return "GENERIC";
}

export function ledgerRows(path) {
  const json = readJson(path, {});
  return Array.isArray(json.rows) ? json.rows : [];
}

export function buildLedgerIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    for (const key of [row.canonicalRaceId, row.raceId, row.id, row.district]) {
      if (key) index.set(String(key), row);
    }
  }
  return index;
}

export function readEvidenceLedgers() {
  return {
    polling: buildLedgerIndex(ledgerRows("data/staging/polls/live-general-ledger-v3.json")),
    baselines: buildLedgerIndex(ledgerRows("data/v4/house/current-map-baseline-ledger.json")),
    finance: buildLedgerIndex(ledgerRows("data/staging/finance/race-finance-ledger-v3.json")),
    ratings: buildLedgerIndex(ledgerRows("data/staging/ratings/ratings-prior-ledger-v3.json"))
  };
}

export function evidenceForRow(office, row, raceId, ledgers) {
  const district = office === "house" ? districtCode(row.state, row.district) : row.state;
  const poll = ledgers.polling.get(raceId) || ledgers.polling.get(district);
  const baseline = ledgers.baselines.get(raceId) || ledgers.baselines.get(district);
  const finance = ledgers.finance.get(raceId) || ledgers.finance.get(district);
  const ratingLedger = ledgers.ratings.get(raceId) || ledgers.ratings.get(district);
  const rating = ratingLedger?.rating || row.modelRating || row.rating || row.baselineRating;

  const validatedRows = poll?.validationStatus === "VALIDATED" || poll?.usedInModel ? 1 : 0;
  const financeRows = finance?.v3Active ? 1 : 0;
  const baselineVerified = Boolean(baseline?.currentMapAnchorAvailable && baseline?.usedInModel && baseline?.confidence !== "LOW");

  return {
    polling: {
      validatedRows,
      usedInModel: validatedRows > 0,
      status: validatedRows > 0 ? "VALIDATED_POLLING_AVAILABLE" : "NO_VALIDATED_POLLING",
      sourceRaceId: poll?.raceId || null
    },
    baseline: {
      status: baselineVerified ? "VERIFIED_CURRENT_MAP_BASELINE" : "NO_VERIFIED_CURRENT_MAP_BASELINE",
      anchorType: baseline?.anchorType || null,
      usedInModel: baselineVerified,
      confidence: baseline?.confidence || "LOW",
      sourceRaceId: baseline?.raceId || baseline?.district || null
    },
    ratings: {
      status: rating ? "AVAILABLE" : "UNAVAILABLE",
      usedInModel: Boolean(rating),
      consensusRating: normalizeRating(rating),
      sourceCount: Number(ratingLedger?.sourceCount || row.ratingsPrior?.sourceCount || 0)
    },
    finance: {
      activeRows: financeRows,
      usedInModel: financeRows > 0,
      status: financeRows > 0 ? "ACTIVE_RACE_LEVEL_FINANCE" : "NO_ACTIVE_RACE_LEVEL_FINANCE",
      sourceRaceId: finance?.raceId || null
    },
    candidate: {
      status: [inferCandidateStatus(row, "D"), inferCandidateStatus(row, "R")].includes("VERIFIED") ? "VERIFIED" : "GENERIC",
      demStatus: inferCandidateStatus(row, "D"),
      repStatus: inferCandidateStatus(row, "R"),
      usedInCandidateEffects: false
    }
  };
}

export function numericProbability(value) {
  if (!Number.isFinite(Number(value))) return null;
  const number = Number(value);
  if (number > 1) return clamp(number / 100);
  return clamp(number);
}

export function canonicalProbabilities(row) {
  const directD = numericProbability(row.probabilities?.D);
  const directR = numericProbability(row.probabilities?.R);
  const dem = directD ?? numericProbability(row.demProbability) ?? numericProbability(row.demWinProbability);
  const rep = directR ?? numericProbability(row.repProbability) ?? numericProbability(row.republicanProbability);
  if (dem !== null && rep !== null) {
    const total = dem + rep;
    return total > 0 ? { D: round(dem / total, 6), R: round(rep / total, 6), other: 0 } : { D: 0.5, R: 0.5, other: 0 };
  }
  if (dem !== null) return { D: round(dem, 6), R: round(1 - dem, 6), other: 0 };
  if (rep !== null) return { D: round(1 - rep, 6), R: round(rep, 6), other: 0 };
  const margin = Number(row.projectedMargin ?? row.probabilityEngineMargin ?? row.margin ?? 0);
  const pD = clamp(0.5 + margin / 40);
  return { D: round(pD, 6), R: round(1 - pD, 6), other: 0 };
}

export function marginObject(value) {
  const margin = Number(value);
  const safe = Number.isFinite(margin) ? margin : 0;
  const party = safe > 0 ? "D" : safe < 0 ? "R" : "TIE";
  return {
    party,
    value: round(Math.abs(safe), 2),
    signedValue: round(safe, 2),
    display: party === "TIE" ? "Even" : `${party}+${round(Math.abs(safe), 1)}`,
    confidence: "MODEL_DERIVED"
  };
}

export function buildCanonicalRaceRow(office, row, index, ledgers) {
  const raceId = canonicalRaceId(office, row, index);
  const evidence = evidenceForRow(office, row, raceId, ledgers);
  const ratingsPrior = ratingsPriorFromRating(evidence.ratings.consensusRating, evidence.ratings.sourceCount);
  const probabilities = canonicalProbabilities(row);
  const projectedMargin = Number(row.projectedResultMargin?.signedValue ?? row.projectedMargin ?? row.margin ?? row.probabilityEngineMargin ?? 0);
  const probabilityMargin = Number(row.probabilityMargin?.signedValue ?? row.probabilityEngineMargin ?? projectedMargin);
  const canonical = {
    raceId,
    office,
    state: row.state || row.stateCode || null,
    district: office === "house" ? String(row.district || row.id || "").replace(/^0+/, "") || "AL" : null,
    displayName: row.label || row.displayName || row.seat || (office === "house" ? districtCode(row.state, row.district) : row.state),
    candidates: {
      D: row.demCandidate || row.dem || "Democrat",
      R: row.repCandidate || row.rep || "Republican",
      other: row.independent || null
    },
    evidence,
    ratingsPrior,
    projectedResultMargin: marginObject(projectedMargin),
    probabilityMargin: marginObject(probabilityMargin),
    probabilities,
    expectedWinner: probabilities.D > probabilities.R ? "D" : probabilities.R > probabilities.D ? "R" : "TIE"
  };
  canonical.evidenceHash = sha256(canonical.evidence);
  canonical.rowHash = sha256({ ...canonical, rowHash: undefined, evidenceHash: undefined });
  return canonical;
}

export function buildTopline(rows, office) {
  const total = rows.length;
  const expectedD = rows.reduce((sum, row) => sum + (row.probabilities?.D || 0), 0);
  const expectedR = rows.reduce((sum, row) => sum + (row.probabilities?.R || 0), 0);
  const expectedOther = rows.reduce((sum, row) => sum + (row.probabilities?.other || 0), 0);
  const medianD = rows.filter((row) => (row.probabilities?.D || 0) >= 0.5).length;
  const medianR = rows.filter((row) => (row.probabilities?.R || 0) > 0.5).length;
  const majority = office === "house" ? 218 : office === "senate" ? 50 : Math.floor(total / 2) + 1;
  const scale = office === "house" ? 10 : 2.75;
  const dControl = clamp(1 / (1 + Math.exp(-((expectedD - majority + 0.5) / scale))));
  return {
    controlProbability: {
      D: round(dControl, 6),
      R: round(1 - dControl, 6),
      other: 0
    },
    expectedSeatsOrWins: {
      D: round(expectedD, 2),
      R: round(expectedR, 2),
      other: round(expectedOther, 2)
    },
    medianSeatsOrWins: {
      D: medianD,
      R: medianR,
      other: Math.max(0, total - medianD - medianR)
    }
  };
}

export function buildForecastArtifact(office, sourcePath, outputPath, manifest, extra = {}) {
  const source = readJson(sourcePath, {});
  const rows = extractRowsForOffice(office, source);
  const ledgers = readEvidenceLedgers();
  const canonicalRows = rows.map((row, index) => buildCanonicalRaceRow(office, row, index, ledgers));
  const artifact = {
    ...artifactHeader(manifest, `${office}-forecast`),
    office,
    sourcePolicy: "source forecasts used only as transitional race-list and current output seed; v4 canonical fields are rebuilt from rows and evidence ledgers",
    sourceForecastPath: sourcePath,
    topline: buildTopline(canonicalRows, office),
    races: canonicalRows,
    ...extra
  };
  writeJson(outputPath, artifact);
  return artifact;
}

export function collectForbiddenKeys(value, path = []) {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...collectForbiddenKeys(item, [...path, String(index)])));
    return hits;
  }
  if (!value || typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (FORBIDDEN_LEGACY_FIELDS.includes(key)) hits.push(nextPath.join("."));
    if (nextPath.join(".") === "toplineCalibration.modelDemControlProbability") hits.push(nextPath.join("."));
    hits.push(...collectForbiddenKeys(child, nextPath));
  }
  return hits;
}

export function canonicalToplineProblems(artifact) {
  const problems = [];
  if (!artifact?.topline) problems.push("MISSING_CANONICAL_TOPLINE");
  for (const path of collectForbiddenKeys(artifact)) problems.push(`LEGACY_FIELD_READ:${path}`);
  const top = artifact?.topline;
  if (top) {
    for (const key of ["controlProbability", "expectedSeatsOrWins", "medianSeatsOrWins"]) {
      if (!top[key]) problems.push(`MISSING_CANONICAL_TOPLINE:${key}`);
      for (const party of ["D", "R", "other"]) {
        if (top[key] && !Object.hasOwn(top[key], party)) problems.push(`MISSING_CANONICAL_TOPLINE:${key}.${party}`);
      }
    }
  }
  return problems;
}

export function artifactRunProblems(manifest, artifact, path) {
  const problems = [];
  if (!artifact) return [`MISSING_ARTIFACT:${path}`];
  for (const key of ["runId", "generatedAt", "schemaVersion", "coreVersion", "inputPipeline", "strictReleaseGates", "runManifest"]) {
    if (!Object.hasOwn(artifact, key)) problems.push(`MISSING_ARTIFACT_FIELD:${path}:${key}`);
  }
  if (artifact.runId !== manifest.runId) problems.push(`RUN_ID_MISMATCH:${path}`);
  if (artifact.schemaVersion !== SCHEMA_VERSION || artifact.coreVersion !== CORE_VERSION) problems.push(`SCHEMA_VERSION_MISMATCH:${path}`);
  if (artifact.strictReleaseGates !== true) problems.push(`STRICT_RELEASE_GATES_DISABLED:${path}`);
  if (new Date(artifact.generatedAt).getTime() < new Date(manifest.generatedAt).getTime()) problems.push(`STALE_SIDECAR:${path}`);
  return problems;
}

export function validateReviewHashes(forecast, review) {
  const problems = [];
  const rowHashByRace = new Map((forecast?.races || []).map((row) => [row.raceId, row.rowHash]));
  for (const row of review?.rows || []) {
    if (row.sourceForecastRowHash !== rowHashByRace.get(row.raceId)) {
      problems.push(`${forecast?.office?.toUpperCase() || "FORECAST"}_REVIEW_FORECAST_DRIFT:${row.raceId}`);
    }
  }
  return problems;
}

export function summarizeRows(rows) {
  return {
    raceCount: rows.length,
    validatedPollingRows: rows.filter((row) => row.evidence?.polling?.usedInModel).length,
    verifiedBaselineRows: rows.filter((row) => row.evidence?.baseline?.usedInModel).length,
    activeFinanceRows: rows.filter((row) => row.evidence?.finance?.usedInModel).length,
    ratingsRows: rows.filter((row) => row.evidence?.ratings?.usedInModel).length
  };
}
