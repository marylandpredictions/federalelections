# Chart, map labels and county outlines — October 29, 2026

Starting point: current checkout at `410415fe` after the prior map/theme fixes.

## Changes

- **D−R margin:** symmetric positive/negative range around an Even center line. The observed line uses Democratic color above zero and Republican color below zero, with a sharp color change at zero. Axis labels identify D/R leads in percentage points. This remains descriptive history. Custom themes retain their chosen party colors.
- **No chart hover popup:** removed the SVG title responsible for the browser's “Reported results over time…” tooltip. Accessible chart descriptions and the existing inspection card/keyboard controls remain.
- **Map labels switch:** Map labels: On/Off in the upper-right results menu controls state, district, county/town and reference-city text. It persists locally across reloads. Switching labels off also skips the label placement work; it does not remove accessible geography names or race/map controls.
- **Actual county outlines:** the statewide county source had concatenated House district-within-county polygons. Their interior district edges were then stroked as county borders. The build now dissolves shared arcs offline, preserving disconnected geography and holes. Both the upstream county builder and public map-asset builder use this step. No new union work runs in the browser. House-detail files and New England municipal assets stay separate.
- **Chamber striping:** the shorter national bar clipped inline-block leading segments at their text baseline. The uncalled container now uses flex layout, so stripes occupy the full available height in both national and detailed views. Seat/call arithmetic is unchanged.
- **Map manifest refresh:** the small map manifest revalidates on page load so it cannot keep pointing to old county assets after the new application code arrives. Hashed geometry files retain their long-lived cache behavior.

## Executed checks

**110 automated tests passed**, including symmetric margin ranges, dissolution of adjacent fragments with real islands/holes retained, Texas's 254 unique county IDs, and repaired Dallas, Cook, Fulton and Allegheny outlines. Candidate audit passed: 506 reviewed, zero issues/placeholders. Diff whitespace check passed.

The generated geometry retains all **3,144** source county features. Internal fragments were eliminated in **410 counties**, reducing the combined fragment-piece count by **722**. For example: Dallas 6→1 exterior pieces, Cook 17→1, Fulton 3→1, Allegheny 2→1. Los Angeles retains three disconnected exterior pieces. Full counts/examples are in `county-outline-audit-2026-10-29.json`.

Chromium checks used the isolated localhost test board, not production calls/results:

- A six-point margin history displayed both blue and red observed points, an Even axis label and a zero line at the chart's vertical midpoint. Native chart title count was zero. A simulated lead-change scenario also rendered correctly.
- The label switch hid all observed map text; Off survived a reload. Re-enabling restored labels on statewide drilldown.
- Texas rendered 254 county paths, Dallas had one SVG exterior subpath, and the statewide view contained zero House district paths.
- In the national view, measured stripe and bar heights both equaled 10 px. In detailed view both equaled 18 px. The compact-layout check showed no horizontal document overflow at its measured 390×844 viewport.
- Browser tooling occasionally changed viewport dimensions between actions; layout conclusions above use the dimensions and bounds actually read, not assumed desktop sizes. This is not a physical Safari, touch or TV certification.

Screenshots were saved in the task visualization folder under `margin-county-fixes`, including the centered margin and county/chamber checks. Existing provider verification and production persistence dependencies remain as documented in the earlier readiness report.
