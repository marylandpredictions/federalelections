# Map maker

Open **Features → Map maker** (`/features/map-maker`). Choose House, Senate or
Governors, pick a rating, and click/tap a race. The palette includes Safe, Likely,
Lean and Tilt for D/R/I, plus Tossup. These are personal scenarios, not FEA
forecasts, public vote totals or calls. Only the 506 contests on the 2026 results
catalogue are editable; other states are shown as not on this ballot.

Drag normally to pan. Enable **Paint by dragging** for a painting stroke instead.
One stroke is one Undo operation. Enter/Space paints a focused race. Undo/Redo
history is capped at 100 operations and lasts for the current page session. Clearing an office can be undone and leaves
other offices intact. Painting and theme changes update existing paths, retaining
zoom. Office changes intentionally open the selected national map.

Ratings and the map title save under `fea-map-maker-v1` in this browser. They do
not sync between devices. **Save scenario file** and **Open scenario file** move
the map between devices; imports validate the schema, office, title, every race
ID and every rating before applying any changes. Files over 1 MB are rejected.
**Download PNG** produces a full national map with its rating legend and an
explicit user-created-scenario label. The file does not claim to be live results.

The map reuses `prediction-map-utils.js`, including the existing 435-district
House SVG and repaired statewide geometry. Its `ratingLabel` option defaults to
the existing “FEA rating” on forecast/admin pages; this page uses “Your rating”.
The maker uses the existing appearance editor and local theme preferences. It
does not load the live provider, result polling, call controls or admin state.

`npm run build:map-maker` derives the 30,483-byte identity-only catalogue from
`data/election-night-races.json`. It contains no candidate rosters, votes, calls
or forecast ratings. A regression test compares every derived entry with the
source, so a catalogue change requires a rebuild. Shared map geometry remains
cached and loads only for the chosen office.

Verification: model tests cover atomic edits/imports, all 506 IDs, the canonical
rating vocabulary, cross-office isolation, undo/redo and history bounds. Browser
checks exercised all three offices, 435 House paths, individual and drag painting,
grouped undo, redo, keyboard painting, stable zoom after edits, reload restoration,
scenario download/import, PNG download/rendering and phone-sized layout. Logo
geometry was checked in all six preset styles at a phone-sized viewport. These
are browser checks, not physical-device certification.
