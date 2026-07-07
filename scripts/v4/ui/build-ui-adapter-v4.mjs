import { artifactHeader, readJson, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";

function chamberCard(path) {
  const forecast = readJson(path, {});
  return {
    sourceCanonicalPath: path,
    office: forecast.office,
    status: readJson("data/v4/release-gates/release-gate-summary.json", {}).publishStatus || "BLOCK_PUBLISH",
    topline: forecast.topline || null,
    raceCount: Array.isArray(forecast.races) ? forecast.races.length : 0
  };
}

export function buildUiAdapterV4(manifest = readLatestManifestOrCreate()) {
  const releaseGate = readJson("data/v4/release-gates/release-gate-summary.json", {
    publishStatus: "BLOCK_PUBLISH",
    blockingReasons: ["MISSING_RELEASE_GATE"]
  });
  const adapter = {
    ...artifactHeader(manifest, "forecast-ui-adapter"),
    canonicalOnly: true,
    publishStatus: releaseGate.publishStatus,
    blockingReasons: releaseGate.blockingReasons || [],
    chambers: {
      house: chamberCard("data/v4/house-forecast.json"),
      senate: chamberCard("data/v4/senate-forecast.json"),
      governor: chamberCard("data/v4/governor-forecast.json")
    }
  };
  writeJson("data/v4/ui/forecast-ui-adapter.json", adapter);
  return adapter;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(buildUiAdapterV4().publishStatus);
}
