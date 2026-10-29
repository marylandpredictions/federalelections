# Operational certification — October 29, 2026

**Classification: NEEDS MANUAL VERIFICATION.** Local automation passes. No actual NBC general-election contract, live Render persistence, native OBS compositing or physical device is certified. The remaining external checklist is [election-night-manual-certification.md](election-night-manual-certification.md).

## A. Starting HEAD

`b3967ebe6a6baff0bce29b6738b69576cb8935f9`, clean checkout. Confirmed current /results enhancement layers, public version/delta feed, call/grace/override control, bounded activity/history, existing presets and OBS shared card, New England geometry, storage and CI. No architecture rewrite or major product feature added.

## B. Candidate audit before/after

| Metric | Before | After |
|---|---:|---:|
| Total / reviewed races | 506 / 506 | 506 / 506 |
| Official-source verified | 10 | **81** |
| Secondary-source reviewed | 496 | **425** |
| Needs review / placeholders / empty rosters | 0 / 0 / 0 | **0 / 0 / 0** |
| Actual provider mismatches | Not tested | **NOT_TESTED / null**, actual source disabled |

Baseline tests: **130 passed, zero failed/skipped**. Final result suite: **142 passed, zero failed/skipped**. Dedicated restart command: **5 passed**, included in those 142 and also run separately. Candidate deployment negative fixtures run against isolated copies; inserting `Republican` fails the real CLI without corrupting production files. All original vote totals, parties, calls and candidate IDs were compared before/after and preserved.

## C. Official-source verification expansion

Verified 71 additional complete scopes: California 53 (52 House + governor), Colorado 10 (8 House + Senate + governor), Nebraska 5 (3 House + Senate + governor), South Dakota 3 (House + Senate + governor). Stored authority, URL, date, election/scope, status, document hash and actual ballot spelling/party facts, while retaining the previous secondary review and stable display aliases/IDs.

Sources: [California certification](https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf), [Colorado official general list](https://www.sos.state.co.us/pubs/elections/vote/generalCandidates.html), [Nebraska final general list](https://sos.nebraska.gov/sites/default/files/doc/elections/2026/Final_Statewide_General_Candidate_Filing_List_9.11.26.pdf), [South Dakota general list](https://vip.sdsos.gov/candidatelist.aspx?eid=774). PDF tables/text were extracted and representative pages rendered for visual inspection. No complete source payloads, contact addresses or licensed provider payloads were committed.

Found one actual name correction: **NE-03 Becky Kelly Stille**, replacing the reviewed secondary spelling “Becky Lynn Stille”; retained the old spelling as an explicit alias. Other differences were verified full-name/initial/nickname/party-label variants, retained as provenance/aliases rather than guessed global matches. Colorado certified write-ins and SD's withdrawn Senate candidate were handled explicitly. California's No Party Preference remains NP.

| Office | Total | Official | Reviewed secondary |
|---|---:|---:|---:|
| Senate | 35 | 5 | 30 |
| Governor | 36 | 5 | 31 |
| House | 435 | 71 | 364 |

**53 Watch/Toss-up races remain secondary-reviewed across offices.** The machine report lists every unverified ID by office and Watch/Toss-up. This is a practical expansion, not an exhaustive official certification of every Senate/governor race. NH's official details page returned 403; it was not bypassed. Other remaining rosters retain their reliable dated reviews and are explicitly secondary, not falsely official.

## D. Louisiana

Re-fetched all seven scopes from the [official Louisiana portal](https://voterportal.sos.la.gov/CandidateInquiry). Exact count/name/party comparison passed: Senate 2; LA-01 4; LA-02 5; LA-03 6; LA-04 5; LA-05 9; LA-06 10. No-party counts respectively 0/1/2/1/0/0/0. Quoted ballot nicknames matched exactly. No Louisiana identity changes required.

## E. Render config findings

Starter service, 10-GB disk, `/var/data/election-results`, Node 22 and existing build candidate gate. Added explicit required-persistence and expected-root settings. Startup rejects obvious ephemeral/default/mismatched paths when production persistence is expected, while allowing an explicitly configured nested mount. A real child-process negative startup test passes.

**CODE/CONFIG VERIFIED BUT HOST TEST REQUIRED.** Configuration and successful local probes do not prove the disk is mounted on the actual service. [Render documents that only the mount path survives](https://render.com/docs/disks); no hosted restart/redeploy was performed.

## F. Runtime path inventory

See [results-runtime-storage.md](results-runtime-storage.md) for every path/writer/reader/fallback. Durable: `result-calls.json`, `results-state.json` (last-good races + provider state + audit + matching calls), `race-details/*.json`, `county-history/<race>/<GEOID>.ndjson`. Public summary and delta/compression caches are derived and can reset safely. Provider/config assets are deployed files; pins/themes are browser-local. Ticker configuration/analysis notes remain deployed/optionally externally backed config and are not automatically covered by the runtime disk.

## G. Local restart test

`npm run test:results-restart` starts real isolated server processes, preserves a separate disk, and verifies calls, manual override, audit, votes and race/county history over HTTP. Provider is deliberately unavailable after restart; last-good data remains public with a stale warning. ETag/unchanged heartbeat remains valid. No real credentials or production files used.

## H. Fresh-process / redeploy simulation

Passed: a second code checkout/process reads the preserved runtime directory and recovers the same state. This approximates a redeploy. It does not reproduce a real Render mount, instance replacement or host backup.

## I. Corruption recovery

Passed missing/corrupt standalone calls, invalid/truncated/partially written runtime JSON, malformed schema, unsupported schema version, old optional fields, negative stored votes and unknown saved winner tests. A valid committed envelope recovers matching calls and raises STORAGE ERROR/degraded health if its standalone calls file needs repair. Missing runtime with prior active state and invalid runtime fail clearly instead of publishing a zeroed replacement. Actual child-process truncated-state startup fails before opening the service. Saved identities reconcile only through reviewed names/aliases.

## J. Backup/restore

Added a focused private offline backup/restore command for calls/runtime/details/county history. Checksummed, bounded archive; rejects unsafe paths/symlinks; archive outside checkout (private storage `.backups/` permitted); restore stages artifact children inside the existing mount and retains prior artifacts. It never renames the mount root. Local backup → state mutation → restore → restarted HTTP readback passed; original runtime bytes, calls/audit/history recovered. Corrupt archive rejected. This is a trusted private operator archive, not a public GitHub backup or a live concurrent-writer snapshot. A same-disk archive does not cover disk loss. Real host restore remains external.

## K. NBC source findings

Current public 2026 hub request inaccessible through available authorized research access; no real general-election JSON/projection contract obtained. Existing proposed routes remain PREDICTED. Primary/PPE/historical data is REJECTED for production. No access/auth/licensing restriction was bypassed. See the classified source table in [results-provider-activation.md](results-provider-activation.md).

## L. NBC activation status

**DISABLED / UNVERIFIED**; root `data/results-provider.json` still has `sources: []`. No actual-source activation claimed. The reversible activation procedure requires exact IDs, full roster reconciliation, reporting/timestamp units, evidence of NBC Decision Desk projection and explicit withdrawal semantics, then staged pending/hold/publish/manual/return-to-auto tests.

## M. Provider tests

Synthetic-schema contract tests pass: complete/missing/unexpected candidates, duplicates, wrong date/district, explicit projection, explicit withdrawal and missing/partial flags. Missing any required projection boolean quarantines the race; it cannot silently retract a public call. These are explicitly synthetic fixtures, not a verified NBC 2026 payload.

Existing stale/regressed/malformed/partial-source/failure/recovery tests pass. Eight concurrent source requests maximum; deterministic ordering; healthy states advance independently. Conditional ETag/Last-Modified reuse, validated 304 bodies, 304-without-cache rejection, failure and recovery all tested. Real schema/permitted replay capture remains unavailable pending access.

## N. CI changes/results

Results-quality runs `npm ci`, candidate gate and full result suite. Added dedicated restart command, certification JSON and uploaded JSON/test-log artifacts. Filled trigger gaps for election-night/watch metadata, call configuration and overlay configuration. Negative tests edit isolated fixture copies, not the production tree.

New commands: `npm run test:results-restart`, `npm run certify:results -- --test-log TEST_LOG`. The latter records tests only from supplied executed output; without a log it reports NOT_RUN. It checks source data/assets/poll schedule/provider/storage config and disposable create/write/readback/rename/delete probes, never labels hosted durability verified. Current local report is NEEDS MANUAL VERIFICATION. Hosted workflow execution is reported separately after push, not inferred from unavailable checks.

## O. Desktop browser automation

Used existing Codex browser tooling; no Playwright/Puppeteer dependency added to the app. Automated DOM bounds at 1366×768, 1920×1080, 2560×1440 and 3840×2160: no horizontal page overflow; map, race panel, overflow menu, calls/activity drawers and appearance dialog inside viewport. Trends had two observed points during the matrix. 4K DOM checks passed; **full 4K screenshot paint was inconsistent**, so full visual/device certification remains withheld. No pixel-diff comparison claimed.

## P. Mobile / touch emulation

390×844, 430×932, 844×390 and 932×430 checks passed for horizontal overflow, race panel, calls/activity/appearance bounds and chart rendering. Phone-sized county selection/lock, tabs, pin and menu used logical clicks. Direct office/race/Trends links and malformed URL values restored/fell back safely. Browser console spot-checks clean. Available browser capability did not support genuine coarse-pointer/Safari emulation: **viewport tests are not iPhone or real touch certification**.

## Q. Themes / reduced motion

FEA Night, FEA Light, NBC Big Board, NYT Results and a saved custom purple theme rendered chart/main surfaces. Read actual computed text/background colors and chart point counts; no pixel-perfect or exhaustive contrast matrix claimed. Custom reduced-motion setting was read back from body metadata and remained active through updates/reload; automated motion/fallback tests also pass. Shared public/OBS card source/color behavior remains covered by tests. Physical readability/assistive technology remains external.

## R. OBS browser-source tests

Measured actual overlay controller/shared card layout in isolated synthetic fixtures at 1920×1080 and 3840×2160. HTML/body computed transparent, ticker and card/name bounds inside safe areas, readable clock and no horizontal scroll. A long-name preview changed only the isolated preview's name literal (97 characters); actual shared layout wrapped it without photos or guessed requests. Main card currently uses clean text/color, not a photo dependency.

Browser controller exercised 15 public calls (one visible card/queued remainder), multi-candidate data, pending-only property excluded, outage retaining ticker, recovery and correction flow. Separate actual-controller VM tests assert explicit correction, timeout, no pending/private request and 15-call ordering/bounds. **OBS browser-source layout automated successfully at measured DOM bounds; real OBS compositing still requires manual verification.** 4K full paint was inconsistent in this browser runtime, so native 4K capture is not certified.

## S. Burst test

Actual isolated provider/API transition: **506 changed races, 506 available, 15 calls, reset=false**, recovery healthy. County data changed in the same fixture. Actual public What Changed highlighted the two updated selected-state counties at a five-minute window and feed remained 200. Unit tests separately retain all 506 changed IDs, every changed county and correct raw largest-drop math beyond the visible feed limit.

Browser House stress: 80 changed races / five calls, map **0.9 ms**, selected panel **16.5 ms**, total **28.6 ms**, feed 200, five queued and three visible cards. These are local samples, not production percentiles. Leader-change detection/rendering is covered by existing lab/unit paths; no forecast added.

## T. Soak test

Repeated browser six-hour accelerated selected-race simulation, 1,440 updates. First draw expanded chart targets; completed repeated run held DOM **1,290 → 1,290**, history **1,440**, feed **200**, detail cache **1**, geometry/county caches **0**, projection queue **0**. Heap allocation reading **20,414,443 → 33,893,126 bytes** during the repeated loop; no retained-heap/forced-GC proof of leak absence is claimed.

Added six accelerated hours through the **actual OBS controller** in VM transport/DOM instrumentation: 1,440 ticks including calls/corrections/outage; at most two timeouts, exactly two intervals, one pagehide binding, stable render targets, bounded ticker output; pagehide clears timers/intervals. Existing activity/call/geometry/detail cache bounding tests pass. These are accelerated tests, not a six-hour wall-clock soak or GPU profile.

## U. Network failures

Automated timeout/offline/500/invalid JSON/schema/partial-source cases pass; last-good votes/calls retained and recovery resumes. Actual browser provider-500 rehearsal retained called Ohio, pin/theme/chart and map, displayed delay warning; after recovery the warning element was hidden and updated three-point history remained. OBS outage retained ticker and later cleared warning. No full-snapshot/zero reset introduced. Native browser offline/throttle capability was not available; transport/controller failure injection was used.

## V. Poll-close certification

Re-opened the current [reliable closing-time source](https://www.270towin.com/poll-closing-times/); latest state closes and all seven district-exception groups agree with the stored schedule. Automated exact T−2/T−1/T/T+1/T+60, office filters, IN/KY/FL/KS/MI/TX/ID district exceptions, split closes, session deduplication and hidden-tab suppression pass. Scheduled coverage is 50 states + DC; NH municipalities may close earlier and emergency Election Day extensions require real notices. No invented exceptions.

Hidden-tab polling code tests verify 15-second active, 60-second pre-election and 120-second hidden cadence, visible-return refresh and alert suppression. Native hidden-tab emulation was not supported by this browser connection; code logic was tested, not asserted as physical browser behavior.

## W. Remaining external checklist

Four sections only in [election-night-manual-certification.md](election-night-manual-certification.md): actual Render mount/restart/redeploy/restore, live NBC activation contract (plus authoritative Election Day schedule notices), native OBS compositing and physical Safari/touch/TV path. Secondary-source review is explicitly reported; it is not disguised as 425 mandatory new manual tasks or official verification.

## X. Classification and evidence boundaries

- **AUTOMATICALLY VERIFIED:** candidate gate/provenance comparisons, 142 tests, five restart/corruption/backup checks, provider synthetic contracts/conditional requests, poll-boundary logic, browser DOM layout matrix/themes, isolated controller/burst/accelerated-soak behavior and asset/readiness probes.
- **CODE/CONFIG VERIFIED BUT HOST TEST REQUIRED:** Render manifest/path guard, private disk artifacts/recovery/backup implementation and prospective real-source mappings/projection contract. Local filesystem checks do not prove mounted-disk survival.
- **PHYSICAL-DEVICE / EXTERNAL MANUAL TEST REQUIRED:** live NBC access/contract; actual Render recovery; actual OBS capture; real Safari/touch/TV/AirPlay and target-device accessibility/readability.

**NEEDS MANUAL VERIFICATION. Not ELECTION-NIGHT READY.** Machine evidence is in `election-night-operational-certification-2026-10-29.json`; GitHub Actions publishes a fresh commit-bound JSON/test-log artifact on relevant changes. Screenshots are local evidence, not a substitute for real host/device certification.
