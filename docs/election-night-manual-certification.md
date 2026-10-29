# Final external certification — November 3, 2026

Local automated checks are recorded in `election-night-operational-certification-2026-10-29.md`. **Classification: NEEDS MANUAL VERIFICATION.** Only the following checks require external service access or physical equipment. Do them on a staging service/scene or before public coverage; never publish a fake test call into the live election.

## 1. Actual Render service and disk

- Verify the service has the requested 10-GB persistent disk at `/var/data/election-results`. Confirm runtime `RESULTS_STORAGE_DIR` and `RESULTS_EXPECTED_STORAGE_ROOT` both point there and `RESULTS_REQUIRE_PERSISTENCE=1`. A YAML file or passing write probe alone is not proof of the mount.
- Run admin Election Night Self-Test. Storage must pass create/write/readback/rename/delete, and existing files must be accessible. The production-persistence warning remains until this external drill is recorded.
- On the staged service, load a known replay snapshot with a call, manual override, audit entry and race/county history. Record race ID, candidate, votes, call source, audit count, last history points and public version. Keep all writers stopped while making a **private** backup outside the checkout:
  `node scripts/results/runtime-backup.mjs backup /var/data/election-results /var/data/election-results/.backups/night-backup.gz --offline`
  Copy it privately off-host for disk-loss recovery; the same-disk copy is only a rollback archive.
- Restart the service; compare the same API/admin values. Redeploy and compare again. Test replacement/recovery using the host's supported process. Votes, calls, overrides, audit and history must survive; the delta token may reset safely.
- Make the staged provider unavailable immediately after restart. The board must retain recorded votes/calls and show a delay warning. Restore provider access; updates must resume without duplicate calls.
- Restore the private archive on the **staged, stopped** service using `runtime-backup.mjs restore STORAGE ARCHIVE --offline`. Verify the recorded values. The previous directory is retained as `.before-restore-…`; remove old copies only after verification. Keep the archive private: it contains overrides/audit as well as public results.

## 2. Live NBC contract when available

- Use public/authorized access to observe the exact 2026 general-election JSON requests. Do not guess endpoint paths, bypass access controls or reuse primary/PPE content. Root production sources remain disabled.
- Follow `results-provider-activation.md`: verify date, state/office/district IDs, complete roster/candidate IDs, raw votes, reporting and timestamp meanings. Capture a small fixture only if redistribution is permitted.
- Obtain evidence that the chosen flag means an NBC Decision Desk projection and how explicit withdrawal is represented. Missing flags must not withdraw a public call.
- Validate mappings and fixtures, run the candidate gate and all result/restart tests. On the staged service check pending → hold → publish → manual override → return to NBC and explicit retraction on board and OBS. Then enable the reviewed manifest; pause automation/restore the prior manifest to reverse activation.
- Monitor authoritative state/local Election Day notices for closing-time extensions. Static scheduled-close coverage and district tests are already automated; emergency extensions require a real notice.

## 3. Actual OBS scene

- Add `/call-overlay.html` as a Browser Source at the scene's actual resolution. Confirm transparent compositing over video, ticker/clock readability, safe margins and correct NBC/FEA attribution. Check 1080p and 4K if used.
- With staged replay, capture a single call, 15-call burst, long name/multi-candidate race, correction/withdrawal and provider outage. One card at a time; no pending call, blanking, zeroing or stale winner. The current shared card uses clean text/color without candidate photo requests.

## 4. Physical Safari/touch/TV path

- On a real iPhone and iPad/tablet: tap geography, lock a county/town, collapse/expand the sheet, use tabs/search/pin/theme/share, view a projection, and check fullscreen fallback. Confirm the shared link restores the requested view and a live update preserves zoom/scroll.
- Test the actual touchscreen/TV or AirPlay path, landscape rotation and the target TV resolution, including 4K if used. Confirm controls are reachable and the picture is readable at viewing distance. Complete a real assistive-technology spot-check on the target device if used by the operator.

Record date, deployed commit, device/service/scene, expected values, observed values and evidence for each section. Only after the live source and hosted recovery pass can the product be considered for Election-night ready status.
