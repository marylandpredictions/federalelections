# State polling bias feature

Public route: `/features/polling-bias`, under **Features → State polling bias**.

## Source

[State-by-State Polling Biases spreadsheet](https://docs.google.com/spreadsheets/d/1_jm2C7nYv4MRVhPWf-_4Q1UCJzDU_liIJAhG7pUT-BQ/edit?usp=sharing).
The public web reader could not read the sheet, and its ordinary CSV export
required sign-in. Data was therefore extracted from the user-provided PDF export
on October 30, 2026. The source PDF's SHA-256 is retained in
`data/features/polling-bias.json`. The PDF itself is not republished.

The import joins the horizontally paginated tables: state fields on PDF pages
5–6 with state evidence on pages 7–8, and race fields on pages 9–13 with race
bias/weight fields on pages 14–18. All 50 state priors reconcile with the rounded
overview on pages 1–2. State race/poll totals and race margin-minus-result bias
were checked before publication: 135 Senate contests, 835 poll observations.

## Display meaning

- Positive values mean the polling D−R margin exceeded the actual D−R margin:
  Democratic overstatement, shown blue. Negative values mean Republican
  overstatement, shown red.
- Both maps use the same color scale, saturated at ±7 percentage points. Actual
  values and historical outliers remain in the tables without color clipping.
- The final 2026 prior is a source estimate, not an election-result forecast.
  Confidence labels, weights and coherence multipliers are reproduced without
  inventing a new formula.
- Oklahoma has no direct race evidence. Its historical map is gray; its
  division-based prior remains visible. Zero evidence is not zero polling bias.
- This is a dated snapshot, not an automatic sheet sync. Update the JSON and
  displayed snapshot date together if a newer source is supplied; bump the data
  URL versions in `assets/polling-bias.js` after changing cached data.

## Geometry and verification

Geometry comes from the repository's `data/result-us-states.geojson`, projected
with Albers USA and Alaska/Hawaii insets. Exterior rings were normalized to D3's
clockwise spherical convention before projection to prevent world-complement
rectangles. The preprojected geometry loads once for both maps; the browser
downloads no chart library. Small-state callouts and Hawaii have leader lines.

Automated tests cover source totals, split-column alignment, sign convention,
source precision/outliers, zero-evidence handling, map coverage/slab bounds,
label contrast, page IDs and the public Features navigation. Browser checks
covered 1366×768, 390×844, 768×1024 and 844×390 layouts, light/dark themes, actual
map selection, Oklahoma's empty-evidence state, dropdown navigation and Escape.
These are browser viewport checks, not physical-device certification.
