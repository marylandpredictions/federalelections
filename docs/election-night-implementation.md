# Election-night implementation report

Implemented locally on October 27, 2026. No deployment, GitHub commit, real broadcast, or live NBC general-election ingestion is claimed.

1. **Architecture retained:** one `server.mjs`, the existing generator and results APIs, the existing public/lab map page, result-call file, detail snapshots, authenticated admin, ticker/OBS and analyst-note persistence. The manual ratings editor remains separate.
2. **Problems found/fixed:** forecast-file candidate/context dependencies; zero-vote historical winner flags in the general roster; no public refresh loop; expired server caches returning 304 before refreshing; a global CSS rule hiding all Results links; forced dark theme and hidden toggle; fragmented admin forms; stale race metadata after saves; lack of explicit persistent override/grace state; unvalidated manual candidate/race combinations; duplicate-submit risks; unreported save failures; static access to dotfiles/server sources; and OBS general calls disappearing at calendar rollover.
3. **Forecast/model removal:** removed three forecast JSON loads, modeled candidate-share fallbacks, forecast-derived competitiveness, FEA rating colors, model comparison mode, and forecast-fed ratings/polling/fundraising panels. Actual votes, explicit calls, neutral unreported races, historical comparisons and analyst text remain.
4. **Homepage:** removed obsolete ratings rail, core cards, credit and disclaimer; added a fixed-Eastern election countdown and results link, with zero-expiry behavior; latest video, articles and team links follow. The homepage no longer loads model files.
5. **Navigation:** all public primary navigation now reads Home, Results, Videos, Articles. Source pages and archive/ratings data remain. Shared assets have cache-version changes.
6. **Admin:** Dashboard, Calls, Races, Ticker, Analysis, Testing and System workspaces; search by compact ID/state/district/surname; expandable office/status filters; candidate-backed call form; native confirmations; server-adjusted queue clocks; private audit; local-save/GitHub-persistence distinctions; preserved drafts after errors; keyboard search and large controls; responsive light/dark views.
7. **NBC integration:** generic `fetchResults(catalogue)` contract, strict Firecracker-schema adapter based on the existing primary implementation, explicit race mapping and Decision Desk verification gate. Production sources are intentionally empty. No endpoint is labeled confirmed merely because its URL is plausible.
8. **Call flow:** explicit NBC projection → persisted NBC_PENDING → grace → one existing call record → generator/cache/API/static snapshots → public board/admin/OBS. Source is retained as nbc-auto, nbc-accepted or fea-manual. Public NBC and FEA projections use distinct wording.
9. **Grace:** configurable `NBC_CALL_GRACE_SECONDS`, default 30 seconds; one-second local deadline checks and persisted deadlines; identical refreshes do not restart timers. Auto-publication requires current provider health and active automation. Publish now, hold and ignore are persistent actions.
10. **Overrides:** manual calls and manual uncalls pause NBC for that race across refresh/restart. Return to auto deliberately clears the local call/override and starts a new grace window for the latest retained NBC projection. Bulk return respects overrides. Changed/withdrawn upstream projections are held for review without erasing a published call.
11. **Failure:** timeouts/backoff, schema checks, last-good results, health/staleness warnings and independent manual controls. Invalid/outage responses cannot zero votes or reverse calls. Calls and private runtime files need one process and persistent disk.
12. **OBS:** consumes the same call records and preserves provenance; no duplicate NBC record system; general calls survive midnight. A manual graphic and ticker were rendered in the isolated browser preview; native OBS and a live broadcast were not exercised.
13. **Roster:** 435 House, 35 Senate, 36 governor races; all 132 existing IDs preserved; zero invented vote totals or winner flags. Names were seeded from existing manual team rosters without ratings/model values. **158 races still include generic candidate placeholders; the roster is provisional and needs ballot/provider verification.**
14. **Automated verification:** `npm run test:results` passed 21 tests. Coverage includes parser normalization and invalid payloads, explicit-call-only behavior, unconfirmed-source rejection, HTTP failures, grace/deadline acceptance, deduplication, hold/ignore/publish, restart persistence, manual call/uncall/override, return-auto, bulk controls, outage preservation/backoff, stale versus unchanged data, upstream conflicts/withdrawals, failed-save rollback/retry, invisibility of uncommitted calls during a save, countdown expiry, all public nav labels, authenticated HTTP summary/detail refresh, protected static routes, lab stages/isolation and OBS shared-record provenance/date rollover. Fixtures are synthetic, not captured historical NBC JSON.
15. **Existing ratings regression:** `node --test tests/predictions/*.test.mjs` passed 2 tests. Existing user edits to `assets/predictions.js` and `assets/predictions.css` were not changed by this task. Syntax checks and `git diff --check` also passed.
16. **Browser verification:** checked House/Senate/Governor switching, House race selection, no browser errors on tested results/OBS views, searches CO-04 / Colorado 4 / Illinois Senate / Boebert, login, confirmation/cancel, failed save with selected candidate retained, successful retry, manual call, return-auto, lab NBC pending→accepted, OBS graphic, countdown, themes, `/` keyboard search, and phone/tablet/desktop layouts (390×844, 820×1180, 1366×900 requested viewports). All mutation tests used a temporary copy with test credentials and GitHub persistence disabled.
17. **Not yet verified:** actual 2026 general NBC JSON URL/schema, Decision Desk flag semantics and timestamp fields, nationwide/county coverage, real feed activation/latency, hosting persistence/redeployment, actual GitHub write credentials, or native OBS/broadcast. Research access was blocked on main-site election pages; public PPE primary page content was visible through search, but a raw request returned 403. See the source ledger; no access-control bypass was attempted.
18. **Election-day work:** certify the candidate roster; capture and verify the public general-election payload and NBC call evidence; map all races; adapt/test the parser against that payload; configure source manifest, server secret, grace/poll/stale settings and durable storage; restart and verify health/coverage; test the hosted public/admin/OBS path; deploy through the existing hosting workflow. Until those checks pass, this is an implemented local system with provider activation outstanding, not a launch-ready NBC service.

## Modified files

- `.gitignore`
- `404.html`
- `about.html`
- `admin.html`
- `admin/predictions.html`
- `article.html`
- `articles.html`
- `assets/admin.js`
- `assets/call-overlay.js`
- `assets/election-night.js`
- `assets/theme.js`
- `assets/wiki.css`
- `assets/wiki.js`
- `calibration.html`
- `call-overlay.html`
- `contact.html`
- `data/election-night-races.json`
- `data/result-calls.json`
- `data/live-results.json`
- `data/result-comparison-baselines.json`
- `election-night.html`
- `endorsements.html`
- `governor-race.html`
- `house-method.html`
- `index.html`
- `model-lab.html`
- `model-lab/2026/governor.html`
- `model-lab/2026/house.html`
- `model-lab/2026/senate.html`
- `model-lab/2028/president.html`
- `package.json`
- `predictions.html`
- `predictions/2026/governor.html`
- `predictions/2026/house.html`
- `predictions/2026/senate.html`
- `president-method.html`
- `privacy.html`
- `race.html`
- `races.html`
- `result.html`
- `results.html`
- `scripts/generate-live-results.mjs`
- `server.mjs`
- `sources.html`
- `terms.html`
- `videos.html`

## Created files

- `assets/admin-control.css`
- `assets/countdown.js`
- `data/results-provider.json`
- `scripts/results/nbc-provider.mjs`
- `scripts/results/control.mjs`
- `tests/results/control.test.mjs`
- `tests/results/site.test.mjs`
- `docs/election-night-2026.md`
- `docs/election-night-implementation.md`

## Operations and evidence

[Full operations guide and source ledger](election-night-2026.md)

Screenshots from the isolated local preview:

- Homepage: `C:/Users/zydlo/.codex/visualizations/2026/10/27/01a17d06-6512-70b0-ad31-769e92589290/fea-homepage.png`
- Admin: `C:/Users/zydlo/.codex/visualizations/2026/10/27/01a17d06-6512-70b0-ad31-769e92589290/fea-admin-control.png`
- Phone homepage: `C:/Users/zydlo/.codex/visualizations/2026/10/27/01a17d06-6512-70b0-ad31-769e92589290/fea-homepage-phone.png`
