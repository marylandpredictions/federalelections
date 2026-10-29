# Election Night rehearsal — October 29, 2026

**Readiness: NOT READY for unattended Election Night production use.** The real 2026 NBC general-election feed is unverified/unconfigured, and hosted Render restart/redeploy/instance replacement has not been tested. Local rehearsal passed the scenarios described below; those results do not certify the host or the upstream source.

## A. Starting HEAD

`09c7ca4fb52d486820f0c5cc28ae2d2568a4af06` — Polish default margin trends and refresh election-night OBS overlay. Started with a clean checkout. Inspected the actual public board, enhancement layers, themes, calls, poll schedule, candidate pipeline, readiness checks, persistence, history, geometry and OBS implementation. Preserved the existing architecture.

Before pushing, integrated remote automated data commit `56c182204b3d07cb2abf4e77cccfaa068837d620` (Update daily forecasts) by rebasing the rehearsal fixes on it. Re-ran all 130 result tests and the 506-roster audit successfully after integration. Browser measurements below were collected against the isolated starting-data rehearsal, not a newly repeated browser matrix of that automated data refresh.

## B. Tests before changes

- `npm run test:results`: 112 passed, zero failed.
- `npm run audit:results-candidates`: passed; 506 total/reviewed, 10 official-source verified, zero placeholders, zero needs-review issues.
- Starting commit's GitHub combined status contained no statuses. Missing status data was not treated as green CI.

Final: **130 result tests passed, zero failed**; candidate audit unchanged and clean; `git diff --check` passed. Tests include HTTP integration, actual child-process restart/fresh-checkout recovery, provider transport failures, candidate gate negative fixtures, poll boundaries, county geometry and desktop/phone layout calculations. The new GitHub Actions results-quality workflow runs the audit and result tests on relevant pushes/PRs; local success does not establish that the hosted workflow ran.

## C. Bugs found

1. A 506-race burst overflowed the 200-item feed and lost changed-race highlights and the largest vote drop. County highlights and correction history had the same coupling.
2. An already-open Published calls drawer did not refresh when a call arrived. A correction could leave an older winner notification visible/queued.
3. A live county-Trends update reset panel scroll to zero while the asynchronous chart loaded. Default latest-point inspection also pinned itself to an older observation.
4. Older county history requests could evict newer cached versions; failed requests could cache an empty history indefinitely. Concurrent chart responses could overwrite newer draws.
5. Immediate connection failure could leave `stale:false` until the age threshold, misleading OBS/readiness consumers.
6. Persistence failure did not provide sufficiently explicit degraded health. Malformed provider configuration could prevent last-good recovery; legacy restored envelopes missed default initialization.
7. Candidate variations were insufficiently reconciled to reviewed identities, incomplete rosters could lose candidates, and one failed state endpoint could block healthy feeds. State requests were unnecessarily serial.
8. Self-test accepted an empty poll schedule and did not adequately validate referenced geometry, demographics, OBS assets or storage targets.
9. Held calls were omitted from the admin attention count. Guessed candidate photo filenames produced avoidable 404s.
10. Lab/public session alert deduplication could interfere; synthetic history could contain future/out-of-order points. Municipal controls used county terminology. Redundant theme observation repeated map-fill work.

## D. Fixes made

Separated bounded recent-change/county/drop/correction metadata from the 200-row visible feed. Added full-burst, expiry and bounding tests. Calls drawer refreshes in place and keeps scroll/focus; corrections remove stale projection cards/timers.

Trends restores scroll after asynchronous drawing, cancels restoration after user interaction/view change, and ignores superseded renders. Failed county history is retried; older versions cannot replace newer cached history. Default inspection follows the latest observation until the user deliberately inspects another point. In an actual nationwide delta retest, Berlin Trends advanced from 1,317 to 1,580 votes while **scrollTop stayed 298** and the map transform stayed identical. Race, county, tab, theme, pin and panel sizing survived.

Public fetches now have a 20-second deadline including JSON parsing. Connection/storage errors propagate to health; recoveries clear warnings. Last-good state survives malformed provider configuration. Provider matching is conservative: reviewed aliases/punctuation/initials/nicknames/suffix omission accepted, ambiguous identities and explicit suffix/party conflicts rejected. Missing reviewed candidates quarantine the race. Healthy state feeds continue, source concurrency is capped at eight, and output ordering stays deterministic.

Readiness now validates content and references, checks writable/readable persistence targets, and explicitly warns that local disk checks do not verify Render. Admin shows held-call attention, quarantines and persistence errors. Removed guessed photo fetches and duplicate theme observation. Added visible map/history loading copy and municipal wording. Refreshed asset versions.

## E. Candidate audit

| Measure | Result |
|---|---:|
| Total races | 506 |
| Reviewed rosters | 506 |
| Official-source verified rosters | 10 |
| Needs review | 0 |
| Generic placeholders | 0 |
| Empty rosters / audit issues | 0 |
| Actual live-provider/local mismatches | **Not measurable: actual source unconfigured** |

Reviewed is not synonymous with official-source verified. Remaining 496 reviewed rosters retain their recorded provenance; this pass did not independently verify all 506 against official ballot PDFs.

Re-fetched Louisiana using the official [Secretary of State candidate inquiry](https://voterportal.sos.la.gov/CandidateInquiry). All seven stored candidate lists matched: Senate 2; LA-01 4; LA-02 5; LA-03 6; LA-04 5; LA-05 9; LA-06 10. No names changed. Canonicalization tests cover aliases, initials, punctuation, nicknames, suffixes, distinct people and minor-party labels.

Intentionally inserted the fake name `Republican` only in an isolated QA checkout: actual candidate-audit CLI exited 1. Restored the real fixture afterward. Render's existing build audit remains in place; the new CI workflow also runs it. Neither an actual Render rejection nor a hosted invalid-commit deployment was triggered.

## F. Poll-close audit

Coverage: 50 states plus DC. Statewide entries mean **latest scheduled state close**, not every precinct's closing time. Rechecked against the current [2026 closing-time table](https://www.270towin.com/poll-closing-times/), retaining provenance and refreshing verification dates. No times were invented or changed.

District exceptions tested: IN-01/08, KY-01/02, FL-01/02, KS-01, MI-01, TX-16/23 and ID-01/02 versus their defaults. Automated tests run T−2, T−1, T, T+1 and T+60 across every scheduled boundary and office. Actual poll-clock methods also test once-only firing, session refresh deduplication and hidden-tab suppression. The browser lab exercised the poll-close visual wave; it was not a browser clock replay of every national boundary.

NH municipalities can close at different times. Emergency extensions and all precinct/local exceptions are **not exhaustively verified**; operators must monitor authoritative Election Day notices. Alaska/Aleutians and Hawaii use their latest state close; November UTC/ET conversion uses standard time. No neighboring-state inference.

## G. Provider failure and recovery

Executed automated timeout, HTTP 500, invalid JSON, invalid schema, empty response, stale/regressed data, missing race and malformed-race tests. Last-good votes and manual calls remain; bad races are quarantined while healthy races advance. Recovery resumes version/delta updates. Tests cover a quarantined pending race being prevented from auto-publication.

Actual isolated process restart followed immediately by a synthetic provider outage retained 506 races, two public calls, six audit entries and existing race/county history. Malformed provider-config restart also retained votes, 16 calls, two overrides and 43 audit entries without crashing the API. Valid configuration recovery cleared the stale warning.

**Actual 2026 NBC source status: UNVERIFIED.** Repository `data/results-provider.json` still has `sources: []`. All connected-source rehearsal responses came from an explicitly isolated synthetic transport using reviewed local rosters. No synthetic source configuration was copied into production data. Real source activation must supply/match full reviewed candidate rosters; unexplained aggregated write-ins or source IDs require review, not guessed merges.

## H. Calls and corrections

Browser/operator rehearsal: NBC detection → pending grace → hold → publish; manual FEA override; return to NBC; explicit public withdrawal/correction. Checked public source labels, winner markers, map/chamber state, drawer, activity, projection card, audit and browser OBS overlay. Public pending calls stayed absent while admin showed NBC_PENDING.

Fifteen House calls published in one update: chamber moved from zero to 15 calls (7 D / 8 R). Public cards stayed capped at three; OBS showed one at a time with the remaining queue. Retraction removed stale winner treatment and produced a withdrawal indication. Manual uncall survived the still-called synthetic upstream feed and restart. The OBS queue drains serially, so a 15-call burst can take several minutes; operators should use the current ticker/calls list for immediate aggregate awareness.

## I. Burst/load

Final browser lab: 80 changed races and five calls, map 1.7 ms, selected panel 25.8 ms, total scenario 39 ms, 200 activity items, five queued calls and three visible cards. Single local measurement; not a production percentile or low-end-device benchmark. Large-update animation simplification remains in place.

Actual API all-506 delta: 66,147 Brotli body bytes. Fifteen-call delta: 2,853 bytes / 15 races. Synthetic 506-race activity test now retains all 506 changed IDs and a 100,000-vote largest drop despite feed truncation; 254 changed counties also survive truncation.

## J. Long-run

Repeated actual browser lab Six-hour stress on final code (1,440 accelerated selected-race updates). Repeated run: DOM **1,284 → 1,284**; activity **200 → 200**; race history **1,440**; detail cache 1; county-history cache 0; geometry cache 0; projection queue 0. Stress loop 794.1 ms, entire scenario 817.7 ms.

Heap allocation reading grew 27,689,018 → 31,275,194 bytes during that run. No forced collection/retained-heap analysis was performed; this does **not** prove a memory leak or its absence. Existing tests separately stress bounded geometry/detail/activity/call caches. A prior 30,013-ms idle sample recorded zero main-thread long tasks over 50 ms and DOM 1,300 → 1,281 as notifications expired.

This was **not a six-hour wall-clock soak**, nor every race/county changing every tick. Broad workflow phases, navigation, calls, outages and recovery were exercised separately. Timer/listener counts and GPU cost were not exhaustively measured.

## K. Persistence/restart

| Data | Locally verified | Host/Render verified |
|---|---|---|
| Public calls | Process restart and separate-checkout recovery | NOT VERIFIED |
| Manual overrides / manual uncall | Restart, source conflict and recovery | NOT VERIFIED |
| Call audit | Restart preserved entries | NOT VERIFIED |
| Vote history | Restart/API readback | NOT VERIFIED |
| Sparse county history | Restart/readback; one-county update appends only that county | NOT VERIFIED |
| Provider state/configuration health | Recovered last-good state; malformed configuration degraded safely | NOT VERIFIED |
| Last-good public snapshot | Immediate post-restart outage retains data | NOT VERIFIED |

Existing Render configuration requests Starter with a 10-GB disk mounted at `/var/data/election-results` and matching `RESULTS_STORAGE_DIR`. Only files under the actual mounted path are durable according to [Render's disk documentation](https://render.com/docs/disks). A configuration file is not evidence the live service uses it. No real hosted restart, redeploy or instance replacement was performed.

Actual QA write failure: made the calls-file target temporarily a directory. Save failed clearly, previous public call remained, health showed STORAGE ERROR; after restoring the file, retry succeeded and cleared the warning. No GitHub high-frequency fallback was used.

Race/county history, runtime calls and state must remain on that mounted directory. Provider source configuration comes from the deployed repository, not magically from recovered storage. Client themes/pins persist in each browser's local storage, not on the server. Activity session queues, hover, projection toast visibility, pending client fetches and map-detail caches are intentionally not durable. Delta windows may reset across a process restart; unknown versions request a safe full recovery. That is distinct from losing votes/calls.

## L. Public-board UX

Exercised pre-election, first votes, leader change, active count, poll-close wave, late-night simulation, calls, county updates, provider warning/recovery and correction. Pre-election has reviewed names and Awaiting results rather than active-looking zero bars. Search, pins, window presets, selected Trends, shareable county link, fullscreen controls, map labels and cross-office navigation were exercised.

Berlin, Boston/Cambridge and Auburn local units resolved by source GEOID. NH/MA/ME shapes loaded (259/351/529 features). Public county terminology corrected to town/city where appropriate. House comparisons stay unavailable without verified district baselines; no statewide presidential fallback was introduced. Live nationwide retest preserved zoom/selection/window and, after the fix, chart scroll.

FEA Night, FEA Light, NBC Big Board, NYT Results, High Contrast and a saved extreme magenta custom palette were exercised at varying depths. Custom theme and pin remained local to client B while independent client A retained its theme/House context. Not every preset/component/live-event combination or two extreme custom palettes received a complete visual matrix.

## M. Admin UX

Performed find/review/hold/publish/manual override/return-to-NBC and self-test flows in isolated admin. Held-call badge corrected; missing-photo errors removed; Advanced now exposes quarantine and storage failures. Healthy synthetic configuration self-test returns WARNING for unverified hosted persistence. Broken empty poll schedule now returns FAIL (it previously returned PASS). Self-test does not publish calls or mutate result data.

## N. OBS

Browser overlay checked alongside public calls and explicit withdrawal, including burst queue behavior and feed failure retention. It uses shared public projection markup/source attribution. No private pending call leaked. Transparent document/background is retained by implementation/tests.

**Native OBS/CEF capture, actual alpha compositing, long-name/image-failure broadcast matrix, native 1080p/4K scene capture and AirPlay were not verified.** Browser screenshots alone do not certify OBS broadcast output.

## O. Mobile/tablet/large displays

Actual viewport checks: 390×844, 844×390, 820×1180, 1366×768, 1920×1080, 2560×1440 and 3840×2160. Phone portrait chart/dialog and tablet NYT board were visually inspected. DOM bounds showed no horizontal page overflow at checked dimensions and reachable panel bounds. Phone landscape and 4K screenshot painting was inconsistent after resizing: DOM layout checked, **full visual certification withheld**. 1080p and 1440p screenshots rendered usable map/panel/controls.

No real touch hardware/coarse-pointer emulation, iPhone/iPad Safari or AirPlay-to-TV test was available. These remain manual checks. Fullscreen enter/exit was exercised at ordinary browser dimensions; not an exhaustive fullscreen × resolution × theme matrix.

## P. Accessibility

Spot-checked named map/race buttons, tabs, menu/dialog controls, projection live region and keyboard chart navigation/scroll. Browser reduced-motion custom-theme use and automated preference/fallback tests passed. Batch-call announcement summarizes rather than announcing every card simultaneously. Full keyboard-only journey, real screen reader, focus restoration in every dialog and real touchscreen audit remain unverified. Motion/GPU comfort over 30–60 real minutes was not established.

## Q. Network/performance

Measured local response bodies (headers excluded): full 506-race snapshot 66,368 Brotli bytes; one-race delta 715 bytes; 15-call delta 2,853 bytes; all-506 delta 66,147 bytes; unchanged heartbeat HTTP 304 with zero body bytes. Live APIs are `private, no-cache`; versioned JS is `public, max-age=31536000, immutable`; map manifest is `public, max-age=60, must-revalidate`. Unknown delta version returns reset. Browser trace showed version/delta requests between deliberate reloads/navigation, not a repeated nationwide snapshot loop. Synthetic upstream timestamps can create small metadata-only deltas even without vote changes.

Cold slow-network public client: 700-ms proxy latency plus 64 KiB/s **per response**, 824,008 own-origin encoded bytes / 832,408 ResourceTiming transfer bytes; map usable in 13,466 ms. External CDN libraries excluded, so this is not whole-page/all-origin transfer or aggregate mobile-link throttling. Warm reload measured 354 ms in a separate sample. Initial map/history loading feedback is now visible.

No duplicate selected detail/geometry request was found in a representative Maine selection. Removed an actual duplicated theme-fill observer. Latest checked public client/lab console had no warning/error entries. All IAB tabs reported visible; hidden cadence/suppression was verified through tests, **not a native hidden-tab browser session**. No production latency/CPU/GPU percentile claim.

## R. Remaining blockers

1. Actual NBC endpoint, full candidate identity mapping, publication flags and correction semantics unverified; root sources list empty.
2. Actual Render mounted disk/restart/redeploy/instance replacement and backup restoration unverified.
3. Local closing-time extensions/precinct exceptions require Election Day monitoring.
4. Real device/Safari/touch/AirPlay/native OBS/4K full-paint and screen-reader checks incomplete.
5. No six-hour wall-clock multi-client production soak or retained-memory profile.
6. Official-source provenance covers 10 rosters; review status is clean but not blanket official ballot certification.

## S. Classification

**NOT READY** under the requested strict standard. Substantial local reliability tests pass and reproducible bugs were fixed. It cannot honestly be classified Election-night ready or Ready for final provider activation until the real provider contract and hosted persistence are established.

## T. Exact manual steps before November 3

1. Obtain the actual 2026-general source URLs/authorization. Verify election identity, all mapped race/candidate IDs, full rosters, timestamp semantics, reporting units, winner flag and explicit correction/retraction behavior against real source samples. Keep unverified projection flags disabled.
2. Configure reviewed source mappings through the existing provider workflow; run strict verification, candidate audit and non-destructive admin self-test. Resolve every real mismatch/quarantine. Confirm pending → hold → publish → manual → return-to-NBC against the activated source.
3. In the actual Render dashboard verify the paid disk attachment, mount path and runtime storage variable. Make a recoverable backup, record calls/overrides/audit/history/snapshot, then restart and redeploy. Re-read the same records/API data, test outage immediately after startup and document instance-replacement recovery. Verify backup restore before relying on it.
4. Verify live GitHub results-quality and Render build/audit results for the pushed commit. A missing check is not a pass.
5. Check authoritative state/local notices for extensions and municipality/district exceptions; keep an operator process for corrections to schedule provenance.
6. On real iPhone/iPad Safari and a tablet, test tapping/locking geography, sheet collapse, tabs, pin, appearance, share and fullscreen fallback; test the actual AirPlay TV path. Verify phone landscape and 4K on real displays.
7. Load the real OBS browser source, verify transparent compositing at 1080p and 4K, source labels, burst queue, long names, missing images, ticker/clock, outage and explicit withdrawal. Capture the scene, not only a browser screenshot.
8. Run a real-duration multi-client soak with the activated feed/replay, native hidden-tab behavior, CPU/GPU and retained-memory inspection. Complete keyboard-only and screen-reader journeys. Re-run candidate audit and readiness immediately before opening the board publicly.
