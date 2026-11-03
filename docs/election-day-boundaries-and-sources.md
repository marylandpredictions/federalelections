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
polls to the actual NBC roster. The Nov. 3 snapshot covers 44 races. It displays
an explicitly labeled **FEA simple average using VoteHub data**, not VoteHub's
own weighted average. The public average application's referenced JavaScript
returned 404, and a published-average API contract could not be verified.

Method: latest poll per pollster within 30 days, LV/RV, no internal polls, at
least two pollsters, exact office/state/district and both ballot candidates.
The stat includes its date, pollster count and method. It is a static dated
reference, does not drive calls or map colors, and disappears if the runtime
roster no longer matches. VoteHub is credited with its CC BY 4.0 API source link.

## CivicAPI

The official documentation describes a public results API requiring attribution,
but the public race endpoint returned HTTP 403 here. No election/date, district,
candidate, timestamp or call-source contract could be verified. It is therefore
**not enabled as an automatic fallback**. The existing last-good NBC snapshot
and recovery behavior remain in effect. Mixing unverified data on Election Day
would be less safe than retaining known results during an outage.

## Browser evidence and limits

Actual desktop browser checks: all 435 map-maker paths render; TX-04 opens TX-04;
Results and map maker both show the new 15 county portions and the same 2024
presidential totals. Ohio displays the dated polling reference. NBC styling
uses its broadcast hierarchy, party bands, condensed figures and right-hand
comparison rail; redundant pre-election status and overlapping header warning
treatments were reduced. Race changes get a short content transition, with
reduced-motion support. No physical TV/mobile or live Render verification was
performed in this pass. No claim of pixel-identical NBC replication is made.
