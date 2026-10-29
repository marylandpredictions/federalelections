# Map, theme and interaction fixes — October 29, 2026

Started from `bf5b9cc3` after the election-night awareness pass. Existing provider/call controls, themes, resizing, deltas, history and demographic behavior are preserved. The pre-existing modified `data/live-results.json` was left outside this change.

## Changes

- Added **NYT Results**, a paper/white preset with restrained red/blue, dark readable secondary text and serif race titles. It uses the existing appearance/saved-theme system; no NYT artwork or branding assets were copied.
- Fixed VA/AK labels: spherical centroids could select a polygon's complement because source ring directions differ. Anchors now use the largest visible projected exterior, independent of winding. National House state labels use actual state geometry instead of aggregating district centroids. Positions are cached per projection.
- House gestures now update the SVG transform only. Label reconstruction/collision work happens after the gesture, with offscreen labels culled. Decorative labels/roads hide briefly while moving, and expensive SVG filters/glows were removed from geography paths. Hover/selection still use borders.
- Corrected the House simplifier: topojson-simplify quantiles are descending. The old `.8` setting retained roughly 80% of interior points despite its “20%” comment. The display asset now retains the top 5%, with all 435 voting districts plus DC context still present. Original detailed geometry remains separate and unchanged.
- Corrected map fitting to use the same projected geometry that is drawn. Automatic clearance now scales into available space rather than translating an oversized state offscreen. Width changes retain the current transform; small browser-height changes do not rebuild the map. An older race selection cannot zoom a newer selected race.
- Retained race-list, pin-tray and Activity drawer scroll positions through refreshes. Automatic focus restoration uses preventScroll; unchanged Activity drawers do not rebuild every clock tick.
- Replaced the cramped one-line Trends inspection text with a structured **14 px** update card containing time, votes, candidate rows and descriptive margin/reporting. Keyboard history navigation remains intact.
- Removed hard-coded pale tooltip metadata colors. Party labels, reporting footers and related metadata now follow the theme's secondary text. Darkened NBC muted text; NYT/NBC primary, secondary and muted text pass 4.5:1 checks on the tested panel/raised/tooltip/control surfaces.

## New England local maps

Official **2025 Census cartographic county-subdivision boundaries**, at 1:500,000, are loaded lazily for statewide Senate/Governor drilldowns:

| State | Display areas |
| --- | ---: |
| Maine | 529 |
| Massachusetts | 351 |
| New Hampshire | 259 |
| Vermont | 256 |
| Connecticut | 169 |
| Rhode Island | 39 |

These include Census-recognized towns/cities and applicable other minor civil divisions; they are not a precinct registry. Each file records its exact Census download URL and vintage. Rebuild with `node scripts/results/build-local-maps.mjs`. The national asset builder preserves the municipal manifest.

The panel labels this tab **Towns / cities**. Unmatched areas show **Awaiting local results**, without empty result tables or invented zero-vote batches. An exact 10-digit GEOID is preferred. Name matching is limited to explicitly municipal source rows and rejects ambiguous names; same-named county totals cannot be assigned to a town. Ten-digit IDs are supported in view URLs, normalized areas, history storage and the history API. Town demographics remain unavailable unless an exact matching source exists; county estimates are not silently substituted.

House drilldowns retain their existing district-clipped county geometry. This pass does not claim certified town-by-district intersections or convert statewide town totals into House district totals. Actual live municipal coverage still depends on the confirmed provider's reporting areas and IDs.

Source: [U.S. Census Bureau 2025 cartographic boundary files](https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html), with per-state downloads in the [official Census directory](https://www2.census.gov/geo/tiger/GENZ2025/shp/).

## Executed verification

- **107 automated tests passed**, including new real-boundary anchor/coverage, safe town joins, House asset size/district retention, desktop clearance and theme contrast checks. Candidate audit: **506 reviewed, zero issues/placeholders**. Diff whitespace check passed.
- Chromium loaded all six municipal drilldowns with the expected feature counts. Boston was selected by keyboard/list and correctly showed Awaiting local results.
- A real public client on an isolated local server received an FEA call delta: Activity advanced to 1 and the selected race became Called while its scroll stayed **77 px** and its transform stayed exactly `translate(296.80601802150574,96.17328736836924) scale(0.9159281241381827)`. The test call was then retracted. No production calls were changed.
- Lab vote updates retained Trends scroll **304→304 px**, county-list scroll **77→77 px**, and an independently zoomed map transform.
- Actual House drag and deeper zoom were exercised; inspected paths had no black computed fills and no geography filters. No black region was observed in these local captures. This cannot rule out every device/GPU-specific rasterization problem.
- Applied NYT and NBC presets through Appearance. Verified the actual rendered inspection font was 14 px; NBC inspector text/secondary colors were dark on light surfaces. A **390×844** viewport had no horizontal document overflow. Physical Safari/touch/TV/AirPlay were not exercised in this pass.
- House gzip asset: **1,303,985→423,441 bytes** (about 67.5% smaller). Decoded arc points: **494,870→90,707** (about 81.7% fewer). These are measured asset reductions, not an invented frame-rate benchmark or a guarantee of initial-load speed on every connection. The most reduced district planar-area ratio in the comparison was approximately 0.907; this is display simplification, not election-boundary certification.

Detailed measurements: `map-polish-measurements-2026-10-29.json`. Local screenshots remain in this task's visualization folder, including `nyt-final-20261029.png`, `nbc-readable-trends.png`, and `house-pan-polish.png`.
