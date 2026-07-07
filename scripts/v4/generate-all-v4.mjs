import { buildRunManifest } from "./shared/v4-core.mjs";
import { acquireCurrentMapBaselinesV4 } from "./house/acquire-current-map-baselines-v4.mjs";
import { buildHouseForecastV4 } from "./house/build-house-v4.mjs";
import { buildSenateForecastV4 } from "./senate/build-senate-v4.mjs";
import { buildGovernorForecastV4 } from "./governor/build-governor-v4.mjs";
import { buildDiagnosticsV4 } from "./build-diagnostics-v4.mjs";
import { buildBenchmarksV4 } from "./benchmarks/build-benchmarks-v4.mjs";
import { buildReleaseGatesV4 } from "./build-release-gates-v4.mjs";
import { buildUiAdapterV4 } from "./ui/build-ui-adapter-v4.mjs";

export function generateAllV4() {
  const manifest = buildRunManifest();
  acquireCurrentMapBaselinesV4(manifest);
  buildHouseForecastV4(manifest);
  buildSenateForecastV4(manifest);
  buildGovernorForecastV4(manifest);
  buildDiagnosticsV4(manifest);
  buildBenchmarksV4(manifest);
  const releaseGate = buildReleaseGatesV4(manifest);
  buildUiAdapterV4(manifest);
  return { manifest, releaseGate };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const { releaseGate } = generateAllV4();
  console.log(`v4 generate complete: ${releaseGate.publishStatus}`);
}
