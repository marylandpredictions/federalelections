# November 3, 2026 boundary and source verification

Starting commit: `9eca2c459c0a56ee73f7bf086898a21eb4c033e8`.

## House geography

Both Results and map maker now use the same 435-district geometry. The national
Results topology and map-maker SVG derive from `house-districts-2026.geojson`.
All 173 districts in AL, CA, FL, LA, NC, OH, TN, TX and UT use the official
2026 TIGER CD120 files. County portions are geometric intersections with the
existing county map; their source files, hashes and exact paths are recorded in
`data/results/district-geography.json`. No county votes are apportioned by area.

The other 262 districts retain the Census CD119 county-within-district geography.
[Census confirms these states did not change](https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.120th_Congress.html).
Crucially, Missouri uses its unchanged 2022/2024 plan: Census warns its CD120
shapefile still contains the rejected replacement. We do not use that file.

All 435 districts have 2024 presidential comparisons, using The Downballot's
published retabulation to 2026 lines. Its current public CSV was fetched Nov. 3
and exactly matched the stored SHA-256 (`cc1d51ab…c79d9348`). Source and geometry
verification are recorded separately. 2020 presidential comparisons cover 262
districts; 2016 covers the six at-large districts. Prior House comparisons cover
261 verified unchanged districts; an uncontested race without published vote
totals remains blank. Old House totals are never relabeled as redrawn-district
results. ACS estimates still describe CD119 where districts actually changed.

Rebuild using `scripts/results/build-current-house-geometry.py` (pyshp + shapely),
then `node scripts/results/build-board-assets.mjs`, then
`node scripts/results/build-house-svg.mjs`. The Python script reads the nine
official ZIPs in `.runtime/cd120/{FIPS}.zip`, with URLs in the manifest. The SVG
builder uses the site's existing D3 7: save the official npm/CDN distribution
`https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` as `.runtime/d3.cjs` first.
It checks projected bounds so reversed rings cannot make one district cover the
whole map. No new browser geometry dependency is required.

Measured assets: national House topology 252,240 bytes compressed; map-maker SVG
264,813 bytes gzip (825,892 uncompressed). Detailed county assets remain lazy.

## NBC calls

The actual public Senate results page returned HTTP 200 on Nov. 3. Its source
attributes results to AP and projections to the NBC News Decision Desk. NBC's
production application defines `P` as projected winner and `W` as winner.
`data/results/nbc-projection-contract.json` records public script URLs and hashes.

Only an explicit P/W race code AND exactly one candidate winner flag enter the
existing pending/grace/hold workflow. A lead, flag alone, apparent winner, or
unknown/missing code cannot produce a public projection. An explicit withdrawal
holds the published call for operator review, preserving the existing policy;
an operator can retract it. Tests exercise pending privacy, publication, source
attribution, withdrawal hold and explicit retraction. There was no real live
called-race sample during this check; call transitions were fixture-tested.

## Optional polling reference

`npm run build:polling-reference` reads the public VoteHub poll API and matches
polls to the actual NBC roster. The frozen Nov. 2 aggregate covers 60 races. It
displays an explicitly labeled **FEA race-poll aggregate using VoteHub data**,
not VoteHub's own weighted average. VoteHub exposes raw polls only; there is no
verified published-average API contract.

Method: weighted mean of eligible polls in a 60-day window (recency half-life 45
days, sample-size and LV/RV weights, partisan downweight, repeated-pollster
decay), LV/RV, no internal polls, at least two pollsters, exact
office/state/district and named ballot matchup (including 1D+NR headliners).
The same artifact feeds live win-probability priors when a race qualifies.
Priors also blend in frozen Kalshi Democratic-contract prices (pre-Election-Day
candlesticks) and, for research priors only, single-pollster VoteHub signals.
Races with neither polls nor a usable market stay on a wide uninformative prior.
VoteHub is credited with its CC BY 4.0 API source link.

## CivicAPI

CivicAPI is enabled as the secondary vote source, with 506 explicit unique race
IDs verified against its November 3 election listing. The public Node client
successfully fetched both that listing and a full Colorado Senate response.
The real response matched NBC's current ballot roster. The configuration retains
NBC as primary; no CivicAPI calls are made while NBC covers every race.

During an NBC outage, requests are staggered (24 races per poll, six concurrent,
10-second request window, at least 60 seconds between attempts per race), with
watch races prioritized. Each full race must match its office, date, state,
district, source ID/name, and known ballot. Test/disputed data, invalid votes,
missing candidates, and stale positive results are rejected. A source switch
cannot reduce an already reported candidate's vote total. Missing/rejected data
retains the last-good snapshot. A widespread outage therefore fills secondary
coverage gradually rather than requesting 506 race details simultaneously.

CivicAPI winner flags never make or release NBC projections. NBC call automation
is degraded during a primary outage. Existing published calls stay intact and
retain their original attribution. CivicAPI's generic reporting percentage is
not relabeled as NBC expected-vote or precinct reporting. Active fallback races
are attributed to CivicAPI in their detail panel and feed-status row. Restart
recovery and NBC catch-up were verified locally with isolated fixtures; live
Render connectivity/durability remains unverified.

## Browser evidence and limits

Actual desktop browser checks: all 435 map-maker paths render; TX-04 opens TX-04;
Results and map maker both show the new 15 county portions and the same 2024
presidential totals. Ohio displays the dated polling reference. NBC styling
uses its broadcast hierarchy, party bands, condensed figures and right-hand
comparison rail; redundant pre-election status and overlapping header warning
treatments were reduced. Race changes get a short content transition, with
reduced-motion support. No physical TV/mobile or live Render verification was
performed in this pass. No claim of pixel-identical NBC replication is made.
