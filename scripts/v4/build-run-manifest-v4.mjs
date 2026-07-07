import { buildRunManifest } from "./shared/v4-core.mjs";

export function main() {
  const manifest = buildRunManifest();
  console.log(`v4 run manifest: ${manifest.runId}`);
  return manifest;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
