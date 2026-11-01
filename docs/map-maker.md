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
not sync between devices. **Save scenario file** and **Open FEA / YAPms file** move
the map between devices; imports validate the schema, office, title, every race
ID and every rating before applying any changes. Files over 5 MB are rejected.
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

## YAPms imports and county explorer (November 1, 2026)

The file picker accepts YAPms JSON downloads for 2026 USA House, Senate and
governor blank-map scenarios. All races in that office must match before anything
changes. The imported office is replaced; other offices and county ratings stay
intact. Split allocations become Tossup with an explicit import note. Custom
candidate names prompt for a party mapping; colors never guess party identity.
Four margin indices map to Safe, Likely, Lean and Tilt, not vote percentages.
Changed/custom House boundary revisions import by district ID and explicitly
retain FEA's displayed map boundaries.

The three fixtures are actual public YAPms downloads, containing only blank-map
metadata and Tossup allocations. Source: [YAPms](https://yapms.com), its
[SavedMap format](https://github.com/yapms/yapms/blob/main/apps/yapms/src/lib/types/SavedMap.ts)
and its 2026 map families. Senate/Governor revision `2024312` is a 2026 map date,
not a 2024 election result. The downloaded House revision `2026253` contains a
confirmed `TN-` identifier typo: its upstream SVG explicitly labels that path
`short-name="TN-2"`, `long-name="Tennessee's 2nd"`. Only that revision receives
the alias; disabled DC is excluded. Unknown active districts are rejected.

**Map maker menu → County detail: right-click / double tap** enables the explorer.
It starts off on every load. Normal single clicks/taps still paint. Right-click,
touch double tap, Shift+F10, or the menu's **Open selected race detail** opens it.
Closing restores the untouched national SVG and its zoom. Counties paint with
the detail brush; Undo/Redo includes county edits. County ratings save/export
separately as `raceId@countyFips`, so district fragments and statewide scenarios
cannot overwrite each other or national totals.

Past elections reuses FEA's verified historical snapshot and tooltip renderer.
There is no 2026/current-results comparison column. Exact district geometry
requirements still apply; unavailable comparisons remain blank. County history
and Census profiles within House detail describe whole counties, clearly labeled.
Redrawn districts without verified current county intersections show labeled
statewide county context instead of an old district boundary. Demographics use
the existing ACS county/state and direct district datasets and boundary warnings.

The NBC presentation uses a broadcast scenario-board composition: party towers,
large national map, condensed headings, compact paint rail and dark studio
surfaces. Reference visually reviewed: [Kornacki's Road to 270 WHAT IF board](https://cdn.kqed.org/wp-content/uploads/sites/2/2020/11/n_msnbc_kornackiearlystates_201103_1920x1080.jpg).
The NYT presentation uses an editorial headline, rules, restrained totals and
right-hand tools. FEA branding remains; these are inspired layouts, not NBC/NYT
products. Saved/custom themes retain the selected presentation layout.

Validation this pass: 210 results tests passed (0 skipped); the unrelated local
Git publishing fixture transiently failed once, then passed alone and in a full
rerun. Candidate audit passed: 506 reviewed, 0 placeholders, 0 needing review.
Data JSON validation and both existing prediction/YAPms tests passed. Actual
YAPms files for all three offices imported through the browser. CO-04 county
painting, county and district Census profiles, historical returns, and TX-01's
redrawn-boundary warning were exercised. Phone-sized layout was checked at
390×844; actual physical-device double-tap behavior still requires verification.

## Held seats and in-page detail correction

National totals include seats not on the ballot: Senate 32 D / 31 R / 2 I,
governors 6 D / 8 R. Independents King and Sanders remain I. The bar denominators
are 100 Senate seats, 50 governorships and 435 House seats. Editing, clearing or
importing ratings never alters held seats. Sources checked November 1, 2026:
[Senate membership and classes](https://www.senate.gov/senators/),
[Senate Class I](https://www.senate.gov/senators/Class_I.htm),
[NGA governors](https://www.nga.org/governors/) and
[NGA election schedule](https://www.nga.org/governors/elections/).
The 14 held governorships are DE, IN, KY, LA, MS, MO, MT, NJ, NC, ND, UT, VA,
WA and WV. The public results page's reversed governor held-seat note was fixed.

County detail is an **in-page panel and map drilldown**, like `/results`.
No modal, backdrop or focus trap opens. Office controls and Appearance remain
available. Back/Escape restores the existing national map and zoom; switching
offices or disabling detail closes the panel. Mobile uses the map and panel in
the same scrollable page. The opt-in menu setting still starts off.

The held-seat correction introduced adjacent D/R columns and responsive sizing.
The subsequent drawing pass below refines their proportions and removes the
extra WHAT IF heading, while retaining FEA identity and ratings. Tooltip background, text
and rating pill now use matching theme surfaces, fixing white text over a
light tooltip in the NBC preset.

Follow-up validation: 212 result tests passed, 0 skipped. Browser workflows
checked 50-governor totals, nonmodal county/history/Census detail, menu behavior,
and phone-sized layout at 390×844. 4K DOM bounds and typography were measured;
the browser screenshot cropped the large virtual viewport, so that capture is
not full-frame visual certification of a physical 4K display.

## Drawing and results-page detail presentation

The pencil beside the three-dot menu toggles drawing immediately. Choose any
color or the Yellow/White/Green shortcuts, select stroke width, then draw with
mouse, touch or pen. Resume map, the pencil, or Escape restores interaction.
While drawing, map pan/zoom, painting, office controls, the race card and menu
are paused; drawing Undo (including Ctrl/Cmd+Z) never undoes a race rating.
Ink follows the map's SVG zoom transform and stays separate for each office
and race detail. PNG downloads include the current national map's ink.

Drawings last until reload; FEA/YAPms rating files do not serialize them.
The store retains at most 100 strokes globally, each at most 1,500 points.
Pointer sampling uses screen distance, including at deep zoom. Only the active
stroke updates during pointer movement, once per animation frame; completed
strokes and map geography remain untouched. The mobile pencil/toolbar stay
reachable while the page is scrolled.

Race detail now uses the actual `/results` focus-panel shell, candidate-table
classes, tabs, county list, comparison cards and Census profile renderer. The
comparison-card and Census HTML functions are shared by both pages. Trends is
omitted. The scenario card shows the existing reviewed roster without invented
votes/calls. County maps use `/results`' Albers USA projection and rendered-
geometry fitting, with ring orientation corrected before projection. Desktop
detail occupies the left race card; the county map fits the space alongside it.
Mobile uses a bounded results-style sheet. New England local-unit geometry is
selected from the same manifest as the live board; unavailable historical or
Census matches remain explicitly unavailable.

NBC's palette now uses brighter broadcast blue/red, neutral gray, a dark slate
canvas, a compact right-side rating rail and right-side map controls. The old
untouched NBC party palette upgrades on load; customized/saved theme colors
remain intact. Light race cards retain the public board's theme treatment.

Browser checks exercised actual freehand strokes, green color selection,
stroke Undo, map-zoom alignment and unchanged race totals. A downloaded
1600×1100 PNG contained the green annotation (1,266 matching ink pixels).
The final full results suite passed with 217 tests (0 skipped), including the
palette migration and shared-renderer scope checks. Phone checks found and fixed an inherited auto-height rule
that had allowed the race sheet to grow above the viewport. Physical touch/pen
hardware and actual TV viewing still require external verification.
