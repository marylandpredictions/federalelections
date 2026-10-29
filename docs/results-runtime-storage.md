# Election runtime storage and recovery

`render.yaml` requests a Starter service, Node 22, a 10-GB disk mounted at `/var/data/election-results`, and `RESULTS_STORAGE_DIR` plus `RESULTS_EXPECTED_STORAGE_ROOT` pointing there. `RESULTS_REQUIRE_PERSISTENCE=1` enables the startup guard. `NODE_ENV=production` or Render's documented environment marker also makes persistence expected. This configuration is **not verification of the deployed service**.

Startup rejects a missing/relative directory, a temporary location, a checkout location without an explicit nested expected mount, or a path outside the configured expected mount root. An explicit nested mount is permitted because Render supports mounted subdirectories inside a checkout. Configuration cannot prove the path is mounted; that remains a host restart/redeploy test. See [Render's disk documentation](https://render.com/docs/disks).

## Path inventory

`S` means the configured absolute storage directory. Without it, local development uses `.runtime` and selected legacy data paths; that layout is not production durability.

| Artifact | Production path | Writer | Reader / recovery fallback | Persistence required |
|---|---|---|---|---|
| Published calls, manual overrides, pending/held state and automation pause | `S/result-calls.json` | ResultsControl atomic save | ResultsControl; matching `committedCalls` in runtime envelope is authoritative after restart; repo `data/result-calls.json` is only a seed/legacy fallback | Yes |
| Last-good normalized races, provider health/state, call audit and matching call envelope | `S/results-state.json` | ResultsControl atomic save | ResultsControl before loading calls; no fallback to zeroed seed if prior active state exists but the envelope is missing/corrupt | Yes |
| Race vote history/detail | `S/race-details/<race>.json` | `buildRaceResultDetailWithHistory`, `writeRaceDetail` | Detail builder/API; repository detail is static context fallback, not a replacement for missing Election Night history | Yes |
| Sparse county/municipal history | `S/county-history/<race>/<GEOID>.ndjson` | CountyHistory | CountyHistory/API; missing file has no history, malformed trailing rows skipped; bounded reads/compaction | Yes |
| Derived public summary snapshot | checkout `data/live-results.json` | `writeLiveResultsSnapshot`, server refresh | Public API/current ResultsControl; reconstructed from persisted envelope after restart | No separate durable copy required; committed runtime is required |
| Delta versions, retained delta snapshots, compression cache | Process memory | ResultsChangeFeed/server | Reset and rebuild on restart; client receives reset/full recovery for unknown versions | No; an old delta token need not survive |
| Conditional upstream response bodies, ETag/Last-Modified and retry scheduling | Process memory | NbcProvider/ResultsControl | Fresh nonconditional fetch after restart; last-good votes stay in persisted runtime | Cache need not persist |
| Provider endpoint/mapping/projection configuration | checkout `data/results-provider.json` | Reviewed deployment/config update | NbcProvider/ResultsControl at process start; invalid config degrades without clearing recovered data | Deploy with code; not a high-frequency database |
| Producer note/ticker configuration and analysis notes | checkout `data/overlay-config.json`, `data/result-analysis-notes.json` | Existing authenticated admin persistence | Static/config readers; existing optional low-frequency GitHub persistence | Treat as deployed/externally backed configuration; disk above does not automatically cover these files |
| Candidate provenance, poll schedule, geometry, demographics and theme assets | Repository/static assets | Offline builders/reviewed deployment | Existing manifests and lazy loaders | Code/static deployment |
| Theme, pins, panel preferences | Browser localStorage | Public board | Same browser/origin; explicit URL state takes precedence | Client-local, not server disk |
| Call deduplication and poll-close deduplication | Browser sessionStorage plus bounded client memory | Public board/overlay | Session restoration; lab uses separate keys | Session-local |

## Local commands

- `npm run test:results-restart`: isolated temporary server/disk; process restart, fresh-checkout redeploy approximation, immediate unavailable provider, corruption and private backup/restore. No real runtime files or credentials are used.
- `npm run test:results`: includes the restart tests plus provider, candidate negative fixtures, public/OBS controller, poll-time and layout logic.
- `npm run certify:results -- --test-log PATH_TO_RESULT_TEST_LOG`: read-only data/config checks plus disposable storage probes in an isolated directory. Writes `.runtime/results-certification.json`; does not poll or activate the production provider and does not certify the mounted host.

Admin self-test probes create → write → readback → atomic rename → readback → delete, checks existing calls/runtime accessibility/JSON, and reports production-persistence WARNING even when all local probes pass. A probe does not establish filesystem survival.

## Corruption and backup behavior

- A valid committed envelope recovers matching calls when the standalone calls file is missing or corrupt. A corrupt calls file produces an explicit warning and must be repaired/restored before later writes can succeed.
- Truncated/invalid runtime JSON, unsupported schema, malformed stored race/call data, or a missing envelope with prior active election state fail clearly before serving a fabricated replacement snapshot. Legacy envelopes without optional health/audit fields still normalize safely. Historical primary-call seed entries do not masquerade as active general-election runtime state.
- `runtime-backup.mjs backup STORAGE ARCHIVE --offline` creates a private, checksummed gzip archive of calls, runtime, details and county history. Stop all writers first. The archive must be outside the checkout; a private `S/.backups/` location is permitted and excluded from the archive contents. Keep an off-host private copy for disk-loss recovery; a backup on the same disk only covers logical rollback. Size/path/symlink guards reject unsafe inputs.
- `runtime-backup.mjs restore STORAGE ARCHIVE --offline` validates the archive before installation and stages/replaces the four known artifact children **inside** the existing storage mount. It never renames the mount root; unrelated root files remain. Previous artifacts are retained in `S/.before-restore-…`; failed installation attempts roll back. It requires writers stopped and is not a multi-file transaction for concurrent readers. Local tests compare restored runtime bytes and verify calls/audit/history through a restarted server. No host restore is claimed.
- The existing optional published-call GitHub backup excludes overrides, pending decisions, audit and history. It is **not** a full runtime backup. Do not use GitHub as a heartbeat-frequency database.
