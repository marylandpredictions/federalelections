# FEA election-night operations — 2026

Status on October 27, 2026: the local results/control implementation is tested. **No production NBC 2026 general-election feed or Decision Desk JSON projection field has been verified.** `data/results-provider.json` intentionally has an empty source list. Until activation/verification, NBC is unavailable, automation is degraded, the roster has no fabricated votes, and manual FEA calls remain available.

## Existing architecture retained

Run Node 22 or newer with `node server.mjs`. `/results` serves `results.html`; `/fea-results-lab-26` continues to serve `election-night.html`. Both use `assets/election-night.js` and the existing D3 House, statewide and county maps. The broadcast admin remains at `ADMIN_PATH` (existing default `/1234ab`), protected by `ADMIN_SECRET`. `admin/predictions.html` remains the separate manual ratings editor.

The existing generator, `/api/live-results`, `/api/live-results/race?id=…`, `data/result-calls.json`, `data/live-results.json`, per-race detail files, overlay configuration and analyst notes are retained. The old primary adapter remains available explicitly with `RESULTS_MODE=legacy-primary`; general-election operation is the default. Do not use legacy-primary mode for November results.

## Source research ledger

These are access findings, not claims that NBC has or has not launched a service. Main-site election URLs were blocked by the research tool's robots policy. One normal raw-HTML request to the public PPE Texas page returned HTTP 403; it was not retried or bypassed. No authentication, protected endpoints or browser DOM scraping were used for ingestion.

| Source | Status | Last checked | Finding |
| --- | --- | --- | --- |
| https://www.nbcnews.com/politics/2022-elections/senate-results | UNAVAILABLE | 2026-10-27 | Research access blocked by robots; delivered schema not verified. |
| https://www.nbcnews.com/politics/2022-elections/house-results | UNAVAILABLE | 2026-10-27 | Research access blocked by robots. |
| https://www.nbcnews.com/politics/2024-elections/senate-results | UNAVAILABLE | 2026-10-27 | Research access blocked; PPE equivalent also inaccessible to the research tool. |
| https://www.nbcnews.com/politics/2024-elections/house-results | UNAVAILABLE | 2026-10-27 | Research access blocked by robots. |
| https://www.nbcnews.com/politics/2024-elections/governor-results | UNAVAILABLE | 2026-10-27 | Research access blocked by robots. |
| https://www.nbcnews.com/politics/2026-primary-elections/texas-senate-results | UNAVAILABLE | 2026-10-27 | Main-site research access blocked. |
| https://ppe.nbcnews.com/politics/2026-primary-elections/texas-senate-results | CONFIRMED (page content only) | 2026-10-27 | Public search-delivered page contains candidate tables, county detail, expected-vote estimates and explicit projection text. Raw request returned 403. PPE test content is excluded from production. |
| https://www.nbcnews.com/firecracker/api/v2/state-results/2026-primary-elections/texas-senate-results | UNAVAILABLE | 2026-10-27 | Primary endpoint pattern already exists in this repo. Current endpoint access/schema not verified. |
| https://www.nbcnews.com/politics/2026-elections/senate-results | PREDICTED | 2026-10-27 | User-supplied likely route; not confirmed. |
| https://www.nbcnews.com/politics/2026-elections/house-results | PREDICTED | 2026-10-27 | User-supplied likely route; not confirmed. |
| https://www.nbcnews.com/politics/2026-elections/governor-results | PREDICTED | 2026-10-27 | User-supplied likely route; not confirmed. |
| `/politics/2026-elections/{state}-{office}-results` | PREDICTED | 2026-10-27 | Naming pattern only; no state route has been confirmed. |
| `https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/{slug}` | PREDICTED | 2026-10-27 | Extrapolation from existing primary code. **Not a confirmed API.** |
| https://ppe.nbcnews.com/politics/2026-elections/senate-results | UNAVAILABLE | 2026-10-27 | Research tool could not open it. PPE homepage has preview election material; that does not verify this route or production data. |

The [public PPE primary page](https://ppe.nbcnews.com/politics/2026-primary-elections/texas-senate-results) attributes vote data to AP and projections to NBC's Decision Desk. This distinction is why an AP winner flag is not automatically accepted as an NBC projection. No historical raw payload was captured in this environment; parser tests use clearly labeled synthetic fixtures based on the existing repository adapter's schema. No 2026 general live test is claimed.

## Provider contract and activation

`scripts/results/nbc-provider.mjs` implements the small provider contract `fetchResults(catalogue) -> Promise<normalizedRace[]>`. The control service handles health, last-good storage, calls, audit and polling independently of provider-specific fields. Another provider can implement the same method.

The existing primary adapter established a `races[].summary.candidates` / `races[].areas` schema, `percentVote`, `percentIn`, party identifiers and timestamps. The new adapter strictly validates that schema; it does not claim a future NBC general feed will use it unchanged. A changed schema must fail closed until adapted and tested.

To activate, verify a public production JSON feed and update `data/results-provider.json` with a source object containing:

- `url`: exact observed HTTPS URL on `www.nbcnews.com` under `/firecracker/`; redirects and PPE are rejected.
- `status: "CONFIRMED"`, `election: "2026-general"` only after actual verification.
- `races`: explicit `{ feaRaceId, providerRaceId }` mappings. Preserve FEA IDs, e.g. `house-CO-4`, `senate-IL`, `governor-AZ`.
- `projection`: omit it until the NBC Decision Desk semantics are verified. Only then set `{ verified: true, candidateFlag: "isWinner" }` or `"winner"` if that exact flag is proven to represent NBC projections for this feed. A source-level boolean is an operator attestation, not evidence by itself; retain the captured evidence and source-table note.

The adapter checks election date `2026-11-03`, state, office, district, provider race ID, unique candidates, nonnegative integer votes, percentages and timestamps. A missing mapped race or malformed source rejects the fetched batch and retains the entire previous good batch. It never falls back to a primary, PPE, another organization's calls, leading vote totals or inferred winners. Unmapped races retain their prior data or provisional local roster. Add every intended source/mapping and verify coverage counts; a healthy single mapped race does not establish nationwide coverage. Restart the server after changing the manifest or roster.

## Normalization

| Field | Meaning |
| --- | --- |
| `id`, `type`, `state`, `district` | Stable FEA race identity; House/Senate/Governor |
| `provider`, `providerRaceId`, `sourceUrl` | NBC provenance and upstream identity |
| `candidates[].id/name/party/partyCode/votes/percent` | Candidate vote totals and vote share |
| `expectedVotePercent`, `estimatedVoteReporting` | Expected-vote estimate from NBC `summary.percentIn` |
| `reportingPercent`, `percentReporting` | Precinct percentage **only** when explicitly supplied as `precinctsReportingPercent` |
| `lastUpdated`, `updatedAt` | Supplied provider timestamp; never replaced with the request time |
| `providerCall` | Explicit upstream projection, separate from FEA publication |
| `calls`, `callState`, candidate winner/call flags | Published FEA decision with call source and time |
| `countyCount`, `hasBreakdown` | Summary availability; county arrays are served through race detail |

Missing expected-vote and precinct values remain null. Candidate vote share is separate from both. Unknown county FIPS stays empty; no IDs are guessed as FIPS. County candidates never acquire statewide winner flags from a statewide call. A verified projection can publish with zero reported votes; a vote lead alone can never produce a call.

The general roster contains 435 House, 35 Senate and 36 governor races. All 132 pre-existing FEA race IDs were preserved. Candidate metadata was copied from the existing manual team rosters, without ratings, margins or probabilities. **It is provisional, not a certified ballot.** At implementation time 158 races contain at least one generic party placeholder. Such placeholders cannot receive manual calls. Verify nominees/third-party candidates against authoritative ballot information or the activated provider before election night. The ratings editor and its data remain intact; changing ratings does not silently change the results roster.

## Polling, cache and failure behavior

| Setting | Default | Meaning |
| --- | --- | --- |
| `NBC_CALL_GRACE_SECONDS` | 30 | Nonnegative grace interval in seconds |
| `NBC_POLL_SECONDS` | 45 | Server-side polling cadence; minimum 15 seconds |
| `NBC_STALE_SECONDS` | 180 | Age threshold for success/upstream timestamp; minimum 30 seconds |
| `RESULTS_MODE` | general election | Set `legacy-primary` only for the older primary workflow |

NBC requests time out after 12 seconds; failures back off exponentially to a maximum ten-minute retry interval. Source requests are sequential, and overlapping polls/actions are serialized. A one-second local scheduler checks deadlines; it does not make one NBC request per second. Public clients poll FEA every 15 seconds, never NBC. Detail reads use local normalized data. Health distinguishes UNAVAILABLE, CONNECTION FAILED, DATA STALE and CONNECTED; an unchanged vote count does not itself mark a recent, timestamped feed stale. Missing provider timestamps suspend auto-publication.

`.runtime/results-state.json` contains last-good provider results, health and the private audit trail. `data/result-calls.json` retains pending state, deadlines, accepted calls, holds, ignores, overrides and global automation pause. Both use temporary-file/rename writes. If the second write fails, the call file is rolled back; failed operations restore memory. Public/admin API readers see only committed result state while a write is in progress. These are not a distributed database transaction. Run **one server process** against a persistent writable disk; do not run multiple independent instances writing these files.

On failure, votes and published calls remain available. Pending auto-publication pauses while automation is degraded or paused. An admin can still explicitly publish a retained NBC projection or make a manual FEA call. Upstream withdrawal or a conflicting winner moves the affected NBC call to held review without silently erasing an existing published call. Successful fetching resumes eligibility once health is current. There is no inference that stale data means no new votes.

The existing 15-second API cache and conditional responses remain. The stale-cache-before-ETag bug is fixed. Generated summary snapshots and changed call-detail snapshots feed static consumers/OBS. General summaries exclude county arrays to limit bandwidth. Secrets, dotfiles, `.runtime`, source scripts and server files are not served as static files. Admin API responses use `no-store`. Do not put credentials in source manifests.

Votes, routine polls and automatic acceptances do not trigger GitHub commits. Explicit admin actions retain optional GitHub persistence for `data/result-calls.json`; ticker/notes keep their existing persistence. GitHub failures are reported separately from a successful local save. Live provider state and audit require persistent disk and operational backup; GitHub is not a backup of every transient result or audit event.

## NBC call lifecycle

1. An explicit, verified NBC candidate projection is normalized separately from votes.
2. First detection records `providerCall`, provider race ID, candidate, `detectedAt`, provider timestamp, fingerprint and `publishAt = detectedAt + grace`.
3. The race enters `NBC_PENDING`; no winner is public yet. Repeated identical projections do not restart its timer or duplicate the record.
4. The admin queue shows the candidate, party, detection age and server-clock-adjusted time remaining. While suspended, it states that auto-publication is suspended.
5. If health is current and automation is active at the deadline, the system creates one published call in the existing calls file (`source: nbc-auto`, `provider: NBC`) and records `NBC_AUTO_ACCEPTED`.
6. Publish now uses the same record with `source: nbc-accepted`. Hold and ignore persist as `NBC_HELD` / `NBC_IGNORED`; they do not expire on refresh.
7. Public results say **NBC projects**. A manual FEA record (`source: fea-manual`) says **FEA projects**. OBS reads the same records, so auto and manual acceptance cannot duplicate a call.

A manual call or manual uncall sets `manualOverride: true`. It remains authoritative across refreshes and restarts. Later NBC observations remain visible/audited, but cannot overwrite the manual choice. Return to NBC auto explicitly clears the local call/override and starts a fresh grace period for the latest retained upstream projection, or returns to UNCALLED when no current projection exists. This consequential action requires confirmation. A held conflicting projection can be published only by explicit confirmation.

Global pause/resume, hold-all-pending and return-non-overridden-to-auto are available in Calls. Bulk return respects manual overrides. Audit entries contain timestamp, race, candidate, action, source, role (`admin`/`system`), previous state and next state. No secret or personal admin identifier is logged. The audit is available only through the authenticated control API, not a public file.

## Admin workflow

Dashboard summarizes provider health, pending calls, office call counts and overrides. Calls prioritizes pending/held decisions, recent publications and overrides/ignored projections. Races searches compact IDs, full state names, district names and candidate surnames; office/status filters are expandable on small screens. Candidate buttons fill the existing single-winner call form. Ticker, preview, analysis and lab forms retain their existing API/storage paths.

Buttons prevent duplicate saves, consequential call actions use an accessible native confirmation dialog, errors remain visible and failed saves keep form edits. Race changes prompt before dropping unsaved calls/analysis; filtering is blocked while a race draft exists. Notes/ticker are preserved on polling failures. Keyboard: `/` opens race search; P/H request publish/hold for the selected race, with confirmation; Escape closes the confirmation or public focus panel. Navigation uses native buttons, labels and visible focus; statuses have live regions. The admin uses shared light/dark tokens and a horizontally scrollable section menu on phones.

## Lab and OBS

The lab is browser-local: `/fea-results-lab-26` or `/election-night.html`. Query flags on `/results` cannot activate simulation. Lab snapshots use a different browser-storage namespace from public snapshots. Mock/simulation stages cover pre-election, polls open, closed/no votes, early/active reporting, NBC pending (a visual 30-second demo), accepted calls, manual override, provider outage, near-complete and completed. The visual lab timer is a demo; production grace uses server configuration. `?live=true` is a read-only view of the current provider state and never seeds mock counties. The lab does not submit call actions or write simulated votes to the backend. Control-engine scenarios run against temporary directories in the test suite.

OBS remains `call-overlay.html` (existing suggested Browser Source: 1920×300). The ticker keeps configured messages and automatic race information; graphics retain NBC/FEA provenance. General-election calls continue through midnight instead of disappearing at the calendar-date rollover. Deduplication uses the existing race/candidate/status/call-time signature. No live OBS application connection or broadcast was performed in this task; browser graphic behavior and shared records were checked locally.

## Public site and countdown

The results page no longer loads House/Senate/Governor forecast JSON, modeled candidate shares, FEA rating colors, forecast comparisons, projection/polling/fundraising panels sourced from forecasts, or modeled race classifications. Neutral unreported map colors and actual vote gaps replace them. Useful historical 2020/2024 and prior-office comparisons remain. Analyst text notes use the existing notes file; legacy forecast embeds are not brought into the public results page.

All public primary navigation is Home → Results → Videos → Articles. Manual ratings/model archives remain accessible independently and via relevant secondary links. The old global CSS rule hiding Results links is removed. Theme switching is restored from the old forced-dark/hidden-toggle state.

Homepage hierarchy is identity, countdown/results entry, latest video, articles, then team links. Obsolete ratings rail, core ratings cards, model credit and forecast disclaimer are removed. The homepage exits its shared script before loading forecast/model data.

Countdown target: **2026-11-03T00:00:00-05:00**, equivalent to **2026-11-03T05:00:00Z** (midnight Eastern after DST ends). Every visitor counts toward the same instant using their browser's clock; there is no ambiguous local date parsing. In Chicago it reaches zero at 11 PM November 2; on the Pacific coast at 9 PM. The displayed election date stays November 3. At zero it replaces the digits with Election Day/Live Results and never displays negatives. This is the start of Election Day, not a poll-closing deadline.

## Election-day checklist and recovery

1. Verify the certified candidate roster (including placeholders/third parties), all source URLs, general-election date and every NBC→FEA race mapping. Capture an actual raw payload and explicit Decision Desk projection evidence; update this ledger. Adapt the parser if the observed schema differs. Never enable a predicted endpoint merely because its URL looks plausible.
2. Run `npm run test:results`, then test the captured payload and live source in a separate copy. Compare county FIPS, percentages, winner identity, upstream times and all office coverage counts against NBC. Confirm any provider call timestamp field.
3. Configure `ADMIN_SECRET`, existing `ADMIN_PATH`, polling/grace settings and optional GitHub credentials on the server only. Use one Node process and persistent storage for `data/` and `.runtime/`. Restart to load verified sources/roster.
4. Confirm provider CONNECTED, upstream timestamps fresh, expected race coverage, automation ACTIVE, correct server clock and no unexplained holds/overrides. Test login, one safe lab scenario, public refresh and OBS Browser Source.
5. If NBC fails, pause auto-calls as needed, keep the last-good files, examine System health/audit and use manual calls. Do not delete results/calls to “refresh” a broken connection. Retry after fixing the source/schema/storage problem.
6. If a correction is needed, hold the race, review upstream evidence, then publish the corrected projection or make a manual override with confirmation. Return to auto only deliberately. Back up calls and private runtime state together before recovery/redeployment.
7. After deploying, check `/results`, the homepage, themes, phone/tablet controls and the actual OBS source on the hosting environment. Deployment and a live NBC feed were **not** verified here.
