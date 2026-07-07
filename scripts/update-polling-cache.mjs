import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status || 1);
}

run(process.execPath, ["scripts/ingest/upstream-polls-senate.mjs"]);
run(process.execPath, ["scripts/ingest/upstream-polls-house.mjs"]);
run(process.execPath, ["scripts/ingest/upstream-polls-governor.mjs"]);
run(process.execPath, ["scripts/ingest/upstream-generic-ballot.mjs"]);
run(process.execPath, ["scripts/validate/build-quarantine-ledger.mjs"]);
run(process.execPath, ["scripts/merge/build-canonical-upstream-poll-ledger.mjs"]);
run(process.execPath, ["scripts/build-canonical-poll-ledger.mjs"]);
run(process.execPath, ["scripts/build-poll-validation-diagnostics.mjs"]);

if (process.env.EXPORT_FORECAST_POLL_VIEW === "1") {
  run(process.execPath, ["scripts/update-forecast-cache.mjs", "--polling"]);
  console.log("Exported legacy forecast poll view because EXPORT_FORECAST_POLL_VIEW=1.");
}

