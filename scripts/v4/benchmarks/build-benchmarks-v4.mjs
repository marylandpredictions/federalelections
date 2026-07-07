import { artifactHeader, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";
import { buildGovernorBenchmarksV4 } from "../governor/build-governor-benchmarks-v4.mjs";

function emptyLayeredBenchmark(manifest, chamber) {
  return {
    ...artifactHeader(manifest, `${chamber}-benchmarks`),
    publicQuantitative: {
      voteHub: { status: "BENCHMARK_UNAVAILABLE", sourceType: "publicQuantitative" },
      raceToWH: { status: "BENCHMARK_UNAVAILABLE", sourceType: "publicQuantitative" }
    },
    expertRatings: {
      cook: { status: "BENCHMARK_UNAVAILABLE" },
      insideElections: { status: "BENCHMARK_UNAVAILABLE" },
      sabato: { status: "BENCHMARK_UNAVAILABLE" },
      splitTicket: { status: "BENCHMARK_UNAVAILABLE" },
      consensus270: { status: "BENCHMARK_UNAVAILABLE" }
    },
    predictionMarkets: {
      kalshi: { status: "OPTIONAL_UNAVAILABLE" },
      polymarket: { status: "OPTIONAL_UNAVAILABLE" }
    },
    manualLocal: { status: "NOT_CONFIGURED" }
  };
}

export function buildBenchmarksV4(manifest = readLatestManifestOrCreate()) {
  const house = emptyLayeredBenchmark(manifest, "house");
  const senate = emptyLayeredBenchmark(manifest, "senate");
  const governor = buildGovernorBenchmarksV4(manifest);
  writeJson("data/v4/benchmarks/house-benchmarks.json", house);
  writeJson("data/v4/benchmarks/senate-benchmarks.json", senate);
  const summary = {
    ...artifactHeader(manifest, "benchmark-summary"),
    layers: ["publicQuantitative", "expertRatings", "predictionMarkets", "manualLocal"],
    blendPolicy: "DO_NOT_BLEND_LAYERS",
    chamberStatus: {
      house: "BENCHMARK_UNAVAILABLE",
      senate: "BENCHMARK_UNAVAILABLE",
      governor: "BENCHMARK_UNAVAILABLE"
    },
    artifacts: {
      house: "data/v4/benchmarks/house-benchmarks.json",
      senate: "data/v4/benchmarks/senate-benchmarks.json",
      governor: "data/v4/benchmarks/governor-benchmarks.json"
    }
  };
  writeJson("data/v4/benchmarks/benchmark-summary.json", summary);
  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(buildBenchmarksV4().blendPolicy);
}
