# Race comparisons and appearance styles

The race header's **Compare years** button opens current and historical result
columns. The narrow side rail adds/removes up to two earlier election columns;
its separate **MAP** controls switch between live 2026 and verified historical
geographic results. The historical map carries a persistent year/context label,
and its tooltip shows historical returns rather than live results. Closing the
comparison or selecting another race restores the prior normal map lens. Vote deltas
do not reframe the map; deliberate comparison-layout actions do. On phones the
button expands the sheet, and year headers remain visible while scrolling.

Comparisons use the existing comparison manifest and cached baseline datasets.
Only sources marked `available` are used. Each column names its election (for
example, **2024 presidential margin**); this is not mislabeled as a previous
Senate or governor result. Presidential sources now cover 2016, 2020 and 2024.
The previous same-seat Senate election is available for all 35 contests, including
the appropriate special elections and Georgia's January 2021 runoff. Same-office
House/governor coverage and the remaining gaps are listed in
[comparison-data-coverage.md](comparison-data-coverage.md). Actual historical
candidates retain their identities, including independents and same-party races.
Presidential minor-candidate totals remain **Other votes**. Columns use raw counts
and the all-votes denominator. Lead margin compares the top two actual candidates;
it does not turn an independent into a Democrat or imply a call.

House comparisons require a verified district row, an exact current `geometryId`
match and the all-votes denominator. There is no statewide fallback. County
comparisons require an exact unique valid FIPS match and compatible county
returns. A House county can show an explicitly labeled **whole-county reference**;
this never becomes a district-portion estimate, a shift between different scopes,
or a historical district map. Missing/redrawn/unverified boundaries stay blank. Local datasets load
only when needed, reusing the existing cache and deduplicating concurrent loads.

## Appearance

Theme schema version 1 now has an optional validated `presentation` field:

| Value | Default preset | Treatment |
| --- | --- | --- |
| `standard` | FEA Night, FEA Light, System | Existing balanced layout |
| `broadcast` | NBC Big Board | Flat modules, bold type, scoreboard, thicker vote tracks, boxed tabs |
| `editorial` | NYT Results | Serif titles, horizontal desktop header, quiet rules, compact tables and unboxed tabs |
| `contrast` | High Contrast | Heavier borders, larger labels and stronger row separation |
| `studio` | California Inspired | Rounded surfaces, pill tabs and larger headings |

Appearance exposes **Appearance style** independently of colors and mode.
Saved/duplicated/exported custom themes retain their profile. Legacy presets
infer it from their ID; legacy custom themes use `standard`. Imported values are
an allowlisted enum, never arbitrary CSS. Cancel restores the whole prior theme.
Broadcast/editorial profiles now also own the masthead, office navigation,
scorebar layout, national race directory, candidate-card/table layout, map
controls/labels, drawers, tooltips and appearance dialog. Basic FEA profiles keep
the existing shell. The expanded comparison temporarily widens the desktop
panel; closing it restores the operator's saved size. Profiles preserve panel
resizing, operator presets, mobile sheets and election semantics. Projection
typography and surfaces use the shared card stylesheet on
both the board and OBS; no public-call workflow changed.

Visual references inspected in this pass:

- NBC's [Illinois broadcast frame](https://media-cldnry.s-nbcnews.com/image/upload/mpx/2704722219/2024_11/1730892502157_tdy_news_spec_6a_kornacki_breakdown_241106_1920x1080-831vfc.jpg): current candidate cards, adjacent earlier-election columns, year rail, map retained alongside.
- The Big Board designer's [case study](https://www.codeandtheory.com/work/nbc-big-board): integrated broadcast and geographic storytelling.
- The [NYT results screenshot](https://media.designrush.com/tinymce_images/729749/conversions/the-new-york-times-election-results-tracker-content.jpg): editorial headline, strong scorebar, restrained map/table hierarchy.

These are FEA presentations with FEA attribution, not NBC/NYT-branded services.

The **TV** window preset has separate broadcast/editorial compositions on large
screens. NBC uses horizontal party blocks and boxed percentage/
vote figures beside the name, following the
[2020 Pennsylvania broadcast frame](https://static.independent.co.uk/2020/11/07/16/steve%20kornacki%20.png).
NYT uses large serif figures, white space and restrained rules, informed by its
[2024 House results layout](https://img.hankyung.com/photo/202411/01.38576832.1.png).
This is an imagined NYT broadcast adaptation, not an assertion that NYT has such
a broadcast product. Larger year controls and adjacent columns retain the map.
Phones retain the bottom sheet. Leaving TV restores the existing manual sizing.
Candidate blocks use names only, without portrait or initials slots.

The reference-fidelity pass adds `desk-reference.css`: NBC's current column is
1.65 times a historical column, with compact stacked historical figures and a
colored historical leader. Live candidate rows put percentage over votes in a
separate box, alongside the party-colored name area. The status strip reports
only counting, awaiting results, or the actual published call source; closeness
never becomes a projection. County borders, scope headings and the year rail
follow the broadcast treatment. A row hover retains its party background and
contrast, rather than applying the generic table hover fill.

NBC uses locally hosted Roboto Condensed from the
[Google Fonts distribution](https://github.com/google/fonts/tree/main/ofl/robotocondensed),
with its SIL Open Font License retained beside the asset. It is a freely licensed
substitute for the reference's condensed lettering, not NBC's proprietary font.
The shared projection stylesheet loads the same font for board and OBS headings.
NYT uses serif publication/race headings, quiet utility controls and table rules,
and a left map-control rail in the national view. Its national map keeps the full
canvas instead of the previous permanent race-directory sidebar. Existing watch
and search controls remain available. Custom palettes and basic FEA layouts are
preserved. The FEA identity, election data and name-only candidate blocks remain deliberate
differences from the reference screenshots.

Reference-pass verification: 197 results tests passed with no skips. Browser
checks covered both 1920×1080 TV styles, both 390×844 phone sheets, phone year
comparisons, the NYT national control rail, and NBC panel containment at
3840×2160. The corrected hovered independent row retained its purple background
and white foreground. The reference proof screenshots use the explicitly labeled
simulated-results lab. No physical TV or OBS compositing is claimed here.

## Verification

Automated coverage includes exact all-vote margins, unavailable sources,
redrawn/missing/unverified House geometry, unique county matching, and profile
migration/save/export validation, historical column arithmetic and historical
map independence from live votes/calls. Browser inspection covered NBC and NYT
desktop layouts, the national editorial shell, phone-sized sheet, historical
Ohio county colors and restoring the live lens. Physical-device and real OBS
compositing are outside this pass.
