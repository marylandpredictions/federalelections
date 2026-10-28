# Election Night Big Board implementation report

Verified locally October 28, 2026, against the current checkout (starting HEAD `9aab3aa4`). The interface and supporting code are implemented. All 506 rosters have now been reconciled against dated general-election sources; production feed readiness and nationwide official ballot certification remain open; this is not a claim that every source-dependent acceptance condition is complete. No deployment, live call, provider activation, or hosting account change was made.

## A. Files changed

New frontend modules: `assets/desk-theme.js`, `assets/desk-bootstrap.js`, `assets/desk-appearance.js`, `assets/desk-experience.js`, and `assets/desk-experience.css`.

Updated integration: `results.html`, `election-night.html`, `assets/election-night.js`, `assets/results-desk-board.js`, `assets/results-desk.js`, `admin.html`, and `assets/admin.js`.

Candidate and public-data work: `scripts/results/candidate-roster.mjs`, `scripts/results/sync-candidate-rosters.mjs`, `scripts/results/control.mjs`, `scripts/results/nbc-provider.mjs`, `scripts/results/change-feed.mjs`, `scripts/update-house-races-from-forecast.mjs`, `data/election-night-races.json`, and `package.json`.

New source artifacts: `data/results/louisiana-ballot-2026.json`, `data/results/reviewed-ballots-2026.json`, `data/results/candidate-roster-audit.json`, and `data/results/poll-closes.json`.

Verification: `tests/results/bigboard.test.mjs`, updates to `tests/results/board.test.mjs` and `tests/results/site.test.mjs`, `scripts/results/measure-bigboard.mjs`, `docs/bigboard-performance.json`, and this report. No new dependency was added.

## B. Architecture

The existing provider/control architecture remains authoritative: configured NBC input → validated normalized races → persisted control decisions → public summary/version/delta/detail endpoints → the shared results page. The new board composition extends the existing page and board enhancer; it does not create a competing results store.

Candidate identities, descriptive totals, expected-vote estimates, precinct reporting, histories, and published calls retain separate meanings. Public candidate fields are explicitly whitelisted; per-candidate internal source metadata is excluded from public summaries. Generic party labels cannot pass as provider candidate names.

The client checks the version before loading changes. Only changed details are invalidated, and detail failures retain the last valid county/history data and retry. Theme changes update local presentation without fetching results or refitting map geography. One polling timer uses 15 seconds while counting, 60 seconds before Election Day, and 120 seconds while hidden. Resume refreshes immediately, shares an in-flight request, and suppresses catch-up alert replay.

## C. Candidate pipeline

`npm run sync:results-candidates` merges identity metadata independently of result outcomes. The old House forecast updater now delegates to this safe path: it no longer copies probabilities or winner flags into election results. Every imported identity starts at zero votes, no percentage, and no winner. The initial catalogue contained 187 generic party-name placeholders; those were removed. All 506 races now have at least one named candidate.

Ten rosters have been checked against official sources: seven Louisiana federal offices and Wyoming Senate, House, and governor. Louisiana's public November 3 lookup was parsed office by office, with withdrawal/disqualification filtering and a saved source hash. Candidate counts are Senate 2; House districts 1–6: **4, 5, 6, 5, 9, 10**. The parser does not impose a two-candidate limit. Quoted names such as E. "Liddy" Glass and Lindsay "Rubia" Garcia are retained. Optional aliases, IDs, fusion labels, no-party identities, and write-in metadata are supported.

The follow-up audit reconciled all 496 remaining races against Ballotpedia general-election lists, including declared/registered write-ins and ranked-choice first rounds. Source URLs, review dates, and hashes are saved in `reviewed-ballots-2026.json`. Together with the ten official rosters, all 506 races contain 1,550 source-listed identities. The comparison corrected 349 roster name sets and removed three additional descriptive/runoff fillers. See `candidate-audit-2026-10-28.md` for the full follow-up.

**496 races remain source-reviewed rather than officially certified.** The five one-candidate lists match their dated source lists; they are not inferred from missing opponent metadata. The audit distinguishes official certification from source review. Compact summaries retain D/R ballot nominees and the prominent independent challengers in SD/ID/MT/NE; all source-listed candidates remain in race details.

Official sources: [Louisiana candidate inquiry](https://voterportal.sos.la.gov/CandidateInquiry), [Wyoming general-election candidate list](https://sos.wyo.gov/Elections/Docs/2026/2026_WY_General_Election_Candidates.pdf). Secondary identities are attributed per race in the saved source artifact.

## D. Map and geography

National Senate/governor state views, selectable House district geometry, state drill-down, county interaction, city labels, zoom, and reset remain integrated. County locking remains independent of pointer hover. Missing county results do not substitute statewide totals or statewide projected-winner checks. Called regions use stronger party treatment; leading regions remain visually distinct and uncalled.

House comparisons require the exact district and compatible current-map baseline. Statewide presidential data cannot substitute for a missing district baseline. Those comparisons remain unavailable when verification is absent. District demographic estimates are not manufactured from statewide demographics. Existing compressed geometry and lazy detail loading are retained.

## E. Race window

The draggable/resizable race window retains Results, Counties, Trends, and Demographics. County sorting adds name, votes, closest margin, and expected vote. A compact pinned-race tray supports opening/unpinning up to 12 races and persists locally.

Window dimensions, selected analytical tab, county lock, zoom, and pins survive theme changes. The browser comparison saved identical values before and after a theme change. Arrow keys resize the window; Home and double-click reset it. Laptop verification measured width 370 → 346 with Arrow Left and back to 370 with Home. Mobile uses a compact expandable race sheet and scrollable content.

## F. Calls and projections

Only published control decisions produce winner checks and projection events. A vote leader is labeled Leading, not a winner. NBC source verification and grace timing remain required. Authenticated manual FEA calls, held decisions, return-to-auto controls, persisted audit records, and the shared OBS call source are preserved.

The bounded projection queue supports View race, correction/retraction distinctions, refresh persistence, and suppression of historical replay. Pending grace decisions are not public projections. Chamber bars distinguish called, leading but uncalled, awaiting votes, seats not up, and Independent/Other seats. Senate control wording explicitly distinguishes 51 Democratic seats from 50 Republican seats plus the vice president.

## G. Motion

Hover/focus uses restrained emphasis. A small ambient sheen is restricted to the board interface, pauses during interaction/hidden state, and is removed under reduced motion. Updated map fills, candidate rails, chamber segments, and projection cards use short transitions. Poll-close alerts briefly emphasize affected states, with one-time delivery rather than a historical flood.

System reduced motion and the explicit Appearance preference disable ambient and movement effects and shorten map transitions. Deliberately excluded: perpetual animation across thousands of map paths, invented vote count-ups, confetti, fireworks, flashing backgrounds, and celebration effects. A theme change recolors existing geography rather than animating a new map fit.

## H. Themes

Built-ins are FEA Night, FEA Light, System, High Contrast, and California Inspired. Appearance provides mode, a base interface color, independent Democratic/Republican/Independent/Other colors, and reduced motion. Semantic surfaces/text/borders/status/chart/desk tokens can be overridden in Advanced, reset individually or by section, or fully restored.

Base-color generation uses bounded RGB mixing and derived readable foregrounds; it is not an OKLCH engine. Party colors do not change when the interface color changes. Same-party candidates receive deterministic distinct variants; minor parties remain independent of a forced D/R pair. Candidate lead margin uses the top two candidates; explicitly labeled D−R metrics aggregate all D and R candidates using all votes as the denominator.

Named themes support save, rename, duplicate, delete, default/current selection, validated JSON import/export, and local persistence under schema version 1. Imports accept known keys and hex colors only; names are rendered as text. Unsupported schemas and malformed storage fail safely. Contrast diagnostics and an automatic text-contrast repair are provided. Live preview can be canceled to restore the previous appearance. Theme transitions preserve analytical state.

## I. California legacy inspection

June 1–5 repository history and commit `73eb9948`, including `assets/results.js`, `assets/wiki.css`, results HTML, and California imagery/headshots, were inspected before structural changes. Recovered concepts include the dark canvas, saturated blue/red palette, rounded candidate rails, restrained gradients, called-row emphasis, and subtle fade/rise treatment.

The new **California Inspired** preset adapts those concepts to the present board. It is not an exact restoration of the historical page or an import of its old runtime.

## J. Design research

[AP vote-count methodology](https://www.ap.org/elections/our-role-in-the-u-s-elections/how-ap-counts-the-vote/) and [AP winner declarations](https://www.ap.org/elections/our-role-in-the-u-s-elections/how-we-declare-winners/) informed the separation of counting progress, uncertainty, and calls. The [NYT precinct-map repository](https://github.com/nytimes/presidential-precinct-map-2024) informed geographic hierarchy and legible detail. NBC's published results-board description was consulted for map-first presentation and source labeling.

Direct access to some NBC/NYT live product pages was unavailable. This was not a complete live interaction audit or a claim to have watched a full NBC board demonstration. No proprietary visual asset or source code was copied.

## K. Performance

Reproducible measurements are in `docs/bigboard-performance.json`. Equal gzip accounting for required own static national-House resources, preserving already compressed map bytes:

| Measurement | Starting HEAD | This pass |
|---|---:|---:|
| Required own static requests | 15 | 20 |
| Stored/raw bytes | 1,844,268 | 1,926,561 |
| Encoded bytes | 1,482,489 | 1,502,756 |

The added features cost **20,267 encoded bytes (about 1.37%)**. This pass does not claim a new 85% reduction; the prior geometry optimization is preserved. These figures exclude API responses, external libraries, fonts, icons, and HTTP headers.

On the isolated QA server, the final catalogue summary was 502,395 decoded bytes and **42,081 transmitted gzip bytes**, with `private, no-cache`. Ten successive unchanged version requests returned **304 with zero body bytes**. Existing immutable compressed map caching, summary/detail separation, selected-race history, and lazy county/demographic assets remain intact.

Compared with a fixed 15-second schedule, the new cadence makes 75% fewer pre-election checks and 87.5% fewer hidden-tab checks. Cadence and single-timer behavior are automated tests; a production background-tab network trace was not collected.

A local public-route navigation reached a usable map in 1,640 ms; a warm Lab navigation measured 176 ms. These are local observations with mixed cache state, not controlled cold-load production benchmarks. Two 30-second idle probes—normal and reduced motion—recorded zero main-thread tasks longer than 50 ms and stable DOM counts. They do not establish total CPU/GPU cost. No production edge-cache or Render deployment measurement is claimed.

## L. Admin and simulation

Admin retains provider health, diagnostics, pending/held calls, grace controls, manual calls, overrides, outage state, and audit history. Advanced now reports roster validation counts and incomplete/empty-name warnings.

The isolated Lab adds pre-election, poll close, first 1%, leader change, county update, House control, restored/stale status, accelerated four-hour history, and idle-measurement controls. Existing projection, correction/retraction, and outage tests remain. Restored/stale buttons illustrate status presentation; the automated provider/integration tests exercise actual failure/recovery behavior. Simulations cannot seed production or run in live-provider mode.

Poll-close data covers 50 states and DC with split-district exceptions, checked against [270toWin's schedule](https://www.270towin.com/poll-closing-times/). It labels scheduled closes, notes voters in line and possible extensions, and is not a replacement for official local voting guidance.

## M. Accessibility

The desk keeps keyboard-selectable map controls, search, tabs, resize controls, and a native Appearance dialog with focus trapping. Trend points have roving focus and Arrow/Home/End navigation. Focus is restored after relevant re-renders and pin actions. Escape handling respects the modal instead of clearing underlying county selection.

Themes derive readable text colors and diagnose advanced overrides. Leading/called/awaiting states use wording, checks, and patterns as well as color. Mobile controls, expandable details, scroll regions, and reduced-motion behavior were checked in browser. This is not a formal screen-reader or WCAG certification, nor testing on a physical touchscreen board.

## N. Tests and visual evidence

- **63/63 results tests pass**, including provider validation, calls/grace/holds/manual precedence, summary privacy, conditional fetching, deltas, selected-detail retry, county isolation, strict House geography, Census artifacts, OBS provenance, Lab isolation, theme validation/contrast, arbitrary candidate counts, and polling cadence.
- **2/2 ratings-prior regression tests pass.**
- An 80-image matrix covers FEA Night and FEA Light at 1920×1080, 2560×1440, 3840×2160, 820×1180, and 390×844, across national, Senate, county, trend, demographic, House, projection, and multiple-alert states. The 4K full-page captures were inspected alongside DOM bounds because the browser's viewport-only capture clipped large images.
- Additional evidence covers custom Copper/Forest palettes, High Contrast, California Inspired, System, mobile Appearance, and 1366×768 laptop/public layout. No document overflow was observed in the layout matrix.
- Browser theme checks exercised save/rename/duplicate/delete, valid and invalid import, export, reload persistence, cancel restoration, resets, contrast repair, and actual reduced-motion styling.
- Louisiana House 1/3/6 displayed 4/6/10 candidate rows with unusual names preserved.
- Accelerated four-hour simulation: 960 update samples, 967 retained history points, one retained race detail, zero queued projections; DOM count 1,173 → 1,167. This is an accelerated functional test, not four hours of wall-clock memory profiling.

Local evidence directory: `C:/Users/zydlo/.codex/visualizations/2026/10/27/01a17d06-6512-70b0-ad31-769e92589290/bigboard-qa/`. Lab screenshots contain explicitly simulated results. Browser console checks found no errors during the tested flows.

## O. Remaining limitations and Election Day work

1. NBC's 2026 general-election feed and exact projection fields still need live verification and any required access/licensing. Fail-closed source/projection gates remain enabled.
2. All 506 races are reconciled to current named general-election lists, with zero recognized fillers or empty rosters. Official ballot certification remains separate for 496 secondary-source rosters, and late withdrawals/replacements still require a dated refresh.
3. Exact compatible 2024 House district baselines remain unavailable. Comparisons stay unavailable; statewide substitution is prohibited.
4. Live county geography/results, expected-vote estimates, historical update cadence, and advanced metrics depend on verified upstream fields. Lab samples are illustrations, not live evidence.
5. The real 2024 ACS five-year county/state artifact is retained. This pass did not fabricate new district demographic estimates or require disclosure of the user's Census key.
6. No physical 55–65-inch touchscreen, actual OBS capture session, controlled GPU profile, four-hour wall-clock heap soak, production traffic/load test, deployment, or persistent-disk/edge-cache behavior was certified.
7. Poll-close extensions and Election Day source changes must be checked on the day. The schedule is a dated reference, not a live official extension feed.

The result is reviewable local code with measured browser and automated evidence. The source and deployment limitations above remain explicit release conditions.
