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
Senate or governor result. At implementation, the verified 2024 presidential
state/county source is available, with Harris/Trump names from that official
source. Other presidential votes are aggregated as **Other votes**, not assigned
to an invented candidate. Older presidential and same-office sources remain
disabled by the existing provenance gate and display a blank dash. Historical
columns use raw vote counts and the all-votes denominator, including other votes.

House comparisons require a verified district row, an exact current `geometryId`
match and the all-votes denominator. There is no statewide fallback. County
comparisons require an exact unique valid FIPS match and compatible county
returns. Missing/redrawn/unverified boundaries stay blank. Local datasets load
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

## Verification

Automated coverage includes exact all-vote margins, unavailable sources,
redrawn/missing/unverified House geometry, unique county matching, and profile
migration/save/export validation, historical column arithmetic and historical
map independence from live votes/calls. Browser inspection covered NBC and NYT
desktop layouts, the national editorial shell, phone-sized sheet, historical
Ohio county colors and restoring the live lens. Physical-device and real OBS
compositing are outside this pass.
