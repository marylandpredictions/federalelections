# Trends and election-night OBS update — October 29, 2026

Starting point: `ee18a95d` on `main`. This pass retains the election-night result/call architecture and updates its chart and broadcast presentation.

## Trends

D−R vote margin is now the initial metric, including when opening a different race. The centered signed scale remains: Democratic margin above zero, Republican below zero. The current value and observation time sit above the chart. Quiet horizontal guides, a subtle area to zero, rounded line joins, a latest-point marker and a moving inspection guide make the chart easier to read. Share charts name the summarized candidate and provide an expandable candidate-color key. Multi-day histories use date labels. There is no native hover-title popup, smoothing, projection or extra chart library.

Keyboard Home/End/arrow inspection still traverses the entire history; pointer lookup now uses a binary search. Visible inspection data remains below the chart rather than in a floating tooltip. History hit targets remain bounded by the existing sampling policy. Switching metrics preserves inspection; changing races clears it.

General principles adopted from [Datawrapper's line-chart guidance](https://www.datawrapper.de/academy/what-to-consider-when-creating-line-charts), [its customization guidance](https://www.datawrapper.de/academy/customizing-your-line-chart), and [Observable's reference-rule documentation](https://observablehq.github.io/plot/marks/rule): explicit units, a meaningful zero reference, quiet guides, and observed linear paths. No brand graphics were copied.

## OBS source

Use the existing `/call-overlay.html` URL as an OBS Browser Source. Use a 1920 × 1080 canvas for HD, or configure the source dimensions to match the broadcast canvas. The page itself is transparent; a normal browser screenshot may composite that transparency onto white.

Optional examples:

- `/call-overlay.html?theme=nbc-big-board`
- `/call-overlay.html?theme=nyt-results&office=senate`
- `/call-overlay.html?race=senate-OH`
- `/call-overlay.html?preview=1&theme=nbc-big-board`
- `/call-overlay.html?preview=correction`

Preview is clearly watermarked, uses a sample candidate and never reads or writes public result/call data. Remove `preview` for broadcasting. Theme parameters select built-in presets only. A saved appearance can also be read from the source browser's local storage; OBS storage is separate from an ordinary desktop browser. Custom theme JSON is never encoded in the URL.

Refresh the Browser Source after deployment. Keep “Shutdown source when not visible” and automatic scene-activation refresh off when uninterrupted monitoring across scene switches is desired. A newly created source establishes a call baseline rather than replaying every existing projection. The source continues polling while hidden because OBS scene visibility differs from an ordinary browser tab.

The prior primary overlay requested `data/result-calls.json`, which is now deliberately private and returns 404. The new source uses the same public snapshot, version heartbeat and delta endpoints as `/results`. It never infers a call from a lead, winner flag or uncontested roster. NBC-origin calls retain NBC attribution. Published FEA calls remain FEA calls; pending/private controls never enter this source.

Both pages use the same projection content and CSS component, scaled for their contexts. OBS omits dismiss/View race buttons. It presents one card at a time for 18 seconds; corrections/retractions replace an active or queued older event for that race. The queue is bounded at 600, the shared call tracker at 2,000 fingerprints. Reload/session tracking prevents routine duplicate notices. No calendar-day filter drops November 3 calls at midnight.

The lower ticker retains the producer's existing config, displays published calls and clearly uncalled observed leaders, and stays stable when content does not change. The top information rotation includes call counts, the existing verified poll-close schedule and producer notes. A separate concise delay badge preserves health visibility without suppressing that rotation. Result refreshes run every 15 seconds with conditional version requests, sparse deltas and full-snapshot reset fallback. Config refreshes are conditional every 30 seconds. Requests abort after 12 seconds including body parsing; failed/invalid responses retain the last accepted data and retry. Intervals are not recreated on each refresh and are cleaned up on page exit.

## Executed verification

- `node --test tests/results/*.test.mjs`: 112 passed, zero failures.
- Candidate audit: 506/506 reviewed, 10 official-source verified, zero placeholders/issues. Reviewed is distinct from official certification.
- New tests exercise actual model/card/controller code: NBC/FEA provenance, midnight dates, no inferred calls, baseline behavior, sparse updates, invalid/empty snapshot retention, 15-call queue, bounded queues, correction/retraction replacement, escaping, shared markup, ETags, outage/recovery, timeout/retry and preview isolation.
- Actual isolated local public API: all 506 races accepted by the new overlay model without replaying historical projections.
- Browser: public Trends initially selected margin; changing metric then opening another race reset to margin; share legend and keyboard Home/ArrowRight inspection worked. FEA Night and NBC light/reduced-motion chart appearances were inspected. Public lab projection rendered the shared component. No errors were logged on tested chart/OBS pages.
- Isolated live server: a manual FEA call and subsequent candidate correction reached the real overlay through normal polling. No production data was changed. Retraction and failure recovery were exercised by the automated controller/model tests, not claimed as browser-observed retractions.
- HD browser: 1920 × 1080, transparent body, card inside x1392–1872/y760–916 with a 20px ticker gap. NBC light preview was visually inspected and saved.
- 4K browser layout: measured 3840 × 2160 with no document overflow; card x2956–3776/y1660–1916, ticker y1936–2096. The browser screenshot capture did not reliably paint the lower 4K region, so a complete 4K visual/compositing pass is **not** certified here.

Local screenshot evidence is in the task visualization folder under `trends-obs/` (margin-trend, margin-trend-light, obs-1080p-nbc). The 4K captures are incomplete and are not visual proof of that layout.

## Remaining broadcast checks

Native OBS/CEF, a real broadcast compositor and actual 2026 NBC ingestion were not exercised. The isolated server correctly reported the unconfigured/delayed provider. Verify the production provider and persistent storage using the existing election-night readiness checklist. Run a final OBS scene-switch, transparent-compositing, font-loading, correction and canvas-resolution check on the broadcast machine before going live. No production persistence/redeploy or six-hour-soak claim is made by this UI pass.
