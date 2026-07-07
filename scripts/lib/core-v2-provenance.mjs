import { existsSync, readFileSync } from "node:fs";

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

function hasCoreArg() {
  return process.argv.some((arg) => arg === "--core=v2" || arg === "--core" || arg === "v2");
}

export function coreV2Enabled() {
  return process.env.FORECAST_CORE_V2 === "1" || hasCoreArg();
}

function ledgerPathForOffice(office) {
  return `data/cache/polls/upstream-canonical-${office}-2026.json`;
}

function ratingPathForOffice(office) {
  return `data/cache/ratings/${office}-ratings-priors-2026.json`;
}

function financePathForOffice(office) {
  return `data/cache/finance/${office}-2026-v2.json`;
}

function readRequired(path) {
  const payload = readJson(path);
  if (!payload) throw new Error(`FORECAST_CORE_V2 requires ${path}; run npm run pipeline:v2 inputs first.`);
  if (payload.readError) throw new Error(`FORECAST_CORE_V2 could not read ${path}: ${payload.readError}`);
  return payload;
}

function countRows(payload) {
  return Array.isArray(payload?.rows) ? payload.rows.length : 0;
}

function summarizeRows(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return {
    rows: rows.length,
    usedInModel: rows.filter((row) => row.usedInModel !== false).length,
    generatedAt: payload.generatedAt || payload.updatedAt || null
  };
}

export function coreV2Metadata(office) {
  const enabled = coreV2Enabled();
  if (!enabled) {
    return {
      coreVersion: "v1",
      inputPipeline: "legacy",
      sourceProvenanceSummary: {
        upstreamPollLedger: "not-required-for-v1"
      }
    };
  }

  const pollLedgerPath = ledgerPathForOffice(office);
  const pollLedger = readRequired(pollLedgerPath);
  const ratingPath = ratingPathForOffice(office);
  const ratingPriors = readJson(ratingPath, { rows: [], readWarning: "rating priors not built" });
  const financePath = financePathForOffice(office);
  const finance = readJson(financePath, { status: "UNAVAILABLE", rows: [] });
  const houseBaselinePath = "data/staging/baselines/house-baseline-ledger-v2.json";
  const houseBaseline = office === "house" ? readJson(houseBaselinePath, { rows: [] }) : null;

  if ((pollLedger.rows || []).some((row) => row.sourceKind === "generated-forecast-output")) {
    throw new Error(`${pollLedgerPath} contains generated-forecast-output rows; v2 forecast inputs must be upstream-only.`);
  }

  return {
    coreVersion: "v2",
    inputPipeline: "upstream-ingest-validate-ledger-v2",
    featureFlags: {
      FORECAST_CORE_V2: process.env.FORECAST_CORE_V2 === "1",
      UPSTREAM_POLLS_ONLY: process.env.UPSTREAM_POLLS_ONLY === "1",
      STRICT_RELEASE_GATES: process.env.STRICT_RELEASE_GATES === "1",
      EXPORT_FORECAST_POLL_VIEW: process.env.EXPORT_FORECAST_POLL_VIEW === "1"
    },
    structuredMargins: {
      projectedResultMargin: "race.margin / race.projectedResultMargin",
      probabilityMargin: "race.probabilityEngineMargin / race.probabilityMargin",
      ratingsRegularizedMargin: "ratings prior diagnostic pull only",
      marketAdjustedMargin: "null unless market source is explicitly used",
      uncertaintySigma: "race.error / race.uncertainty"
    },
    upstreamPollLedger: {
      path: pollLedgerPath,
      ...summarizeRows(pollLedger)
    },
    sourceProvenanceSummary: {
      polls: {
        path: pollLedgerPath,
        ...summarizeRows(pollLedger),
        upstreamOnly: true
      },
      ratingsPriors: {
        path: ratingPath,
        rows: countRows(ratingPriors),
        generatedAt: ratingPriors.generatedAt || null,
        status: ratingPriors.readWarning || ratingPriors.sourceStatus || "OK"
      },
      finance: {
        path: financePath,
        status: finance.status || finance.sourceStatus || "OK",
        rows: countRows(finance),
        generatedAt: finance.generatedAt || null
      },
      ...(houseBaseline ? {
        houseBaselineLedger: {
          path: houseBaselinePath,
          rows: countRows(houseBaseline),
          effectiveFor2026: houseBaseline.counts?.effectiveFor2026 ?? null,
          generatedAt: houseBaseline.generatedAt || null
        }
      } : {})
    }
  };
}
