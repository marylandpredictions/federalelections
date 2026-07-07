import { artifactHeader, districtCode, ledgerRows, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";

export function acquireCurrentMapBaselinesV4(manifest = readLatestManifestOrCreate()) {
  const rows = ledgerRows("data/staging/baselines/house-baseline-ledger-v3.json").map((row) => {
    const district = row.district || districtCode(row.state, row.districtNumber);
    const verifiedCurrentMap = Boolean(row.verified && row.comparableFor2026 && row.useAsAnchor && row.translationConfidence === "HIGH");
    return {
      raceId: row.canonicalRaceId || row.raceId || `${district}-HOUSE-2026`,
      district,
      state: row.state,
      mapStatus: row.mapChangeFlags?.length ? "CHANGED" : "UNKNOWN",
      currentMapAnchorAvailable: verifiedCurrentMap,
      anchorType: verifiedCurrentMap ? row.baselineSourceType || "MANUAL_VERIFIED" : null,
      margin: verifiedCurrentMap ? Number(row.baselineMargin || 0) : null,
      source: "data/staging/baselines/house-baseline-ledger-v3.json",
      provenanceUrlOrNote: row.notes || "v3 baseline ledger imported for v4 audit; unverified rows are context only.",
      turfComparableToLastHouseResult: Boolean(row.comparableFor2026),
      confidence: verifiedCurrentMap ? "HIGH" : "LOW",
      usedInModel: verifiedCurrentMap,
      historicalContextOnly: !verifiedCurrentMap,
      reasons: verifiedCurrentMap ? [] : ["NO_VERIFIED_CURRENT_MAP_BASELINE"],
      generatedFromRunId: manifest.runId
    };
  });
  const ledger = {
    ...artifactHeader(manifest, "house-current-map-baseline-ledger"),
    source: "data/staging/baselines/house-baseline-ledger-v3.json",
    counts: {
      total: rows.length,
      verifiedCurrentMapAnchors: rows.filter((row) => row.usedInModel).length,
      contextOnly: rows.filter((row) => row.historicalContextOnly).length
    },
    rows
  };
  const redistricting = {
    ...artifactHeader(manifest, "house-redistricting-status-ledger"),
    source: "data/staging/baselines/house-baseline-ledger-v3.json",
    counts: ledger.counts,
    rows: rows.map((row) => ({
      district: row.district,
      state: row.state,
      mapStatus: row.mapStatus,
      currentMapAnchorAvailable: row.currentMapAnchorAvailable,
      confidence: row.confidence,
      reasons: row.reasons
    }))
  };
  writeJson("data/v4/house/current-map-baseline-ledger.json", ledger);
  writeJson("data/v4/house/redistricting-status-ledger.json", redistricting);
  return ledger;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const ledger = acquireCurrentMapBaselinesV4();
  console.log(`v4 house current-map anchors: ${ledger.counts.verifiedCurrentMapAnchors}/${ledger.counts.total}`);
}
