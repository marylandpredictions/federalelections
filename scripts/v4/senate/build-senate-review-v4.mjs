import { artifactHeader, readJson, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";

export function buildSenateReviewV4(manifest = readLatestManifestOrCreate()) {
  const forecast = readJson("data/v4/senate-forecast.json", { races: [] });
  const rows = forecast.races.map((row) => ({
    raceId: row.raceId,
    runId: manifest.runId,
    sourceForecastRowHash: row.rowHash,
    projectedResultMargin: row.projectedResultMargin.display,
    probabilityMargin: row.probabilityMargin.display,
    pollingStatus: row.evidence.polling.status,
    financeStatus: row.evidence.finance.status,
    candidateStatus: row.evidence.candidate.status,
    reviewFlags: [
      row.evidence.polling.usedInModel ? null : "NO_VALIDATED_POLLING",
      row.evidence.finance.usedInModel ? null : "FINANCE_DISABLED_NO_ACTIVE_ROWS",
      row.evidence.baseline.usedInModel ? null : "NO_VERIFIED_CURRENT_MAP_BASELINE"
    ].filter(Boolean)
  }));
  const review = {
    ...artifactHeader(manifest, "senate-review"),
    sourceForecast: "data/v4/senate-forecast.json",
    rows
  };
  writeJson("data/v4/diagnostics/senate-review.json", review);
  return review;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(`v4 senate review rows: ${buildSenateReviewV4().rows.length}`);
}
