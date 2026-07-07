import { artifactHeader, readJson, readLatestManifestOrCreate, summarizeRows, writeJson } from "./shared/v4-core.mjs";
import { buildHouseReviewV4 } from "./house/build-house-review-v4.mjs";
import { buildSenateReviewV4 } from "./senate/build-senate-review-v4.mjs";
import { buildGovernorReviewV4 } from "./governor/build-governor-review-v4.mjs";
import { simulateHouseV4 } from "./house/simulate-house-v4.mjs";

export function buildDiagnosticsV4(manifest = readLatestManifestOrCreate()) {
  const house = readJson("data/v4/house-forecast.json", { races: [] });
  const senate = readJson("data/v4/senate-forecast.json", { races: [] });
  const governor = readJson("data/v4/governor-forecast.json", { races: [] });
  buildHouseReviewV4(manifest);
  buildSenateReviewV4(manifest);
  buildGovernorReviewV4(manifest);
  simulateHouseV4(manifest);
  const summary = {
    ...artifactHeader(manifest, "diagnostics-summary"),
    chamberSummary: {
      house: summarizeRows(house.races || []),
      senate: summarizeRows(senate.races || []),
      governor: summarizeRows(governor.races || [])
    },
    diagnosticsArtifacts: {
      house: "data/v4/diagnostics/house-diagnostics.json",
      senate: "data/v4/diagnostics/senate-diagnostics.json",
      governor: "data/v4/diagnostics/governor-diagnostics.json",
      houseReview: "data/v4/diagnostics/house-review.json",
      senateReview: "data/v4/diagnostics/senate-review.json",
      governorReview: "data/v4/diagnostics/governor-review.json"
    }
  };
  writeJson("data/v4/diagnostics/diagnostics-summary.json", summary);
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(Object.keys(buildDiagnosticsV4().chamberSummary).join(", "));
}
