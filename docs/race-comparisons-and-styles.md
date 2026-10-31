# Race comparisons and appearance styles

The race header's **Past margin** button opens historical margins inside the
race panel. It stays separate from live votes, calls, and the map lens. On phones
it expands the sheet; comparisons and results share one scroll area.

Comparisons use the existing comparison manifest and cached baseline datasets.
Only sources marked `available` are used. Each row names its election (for
example, **2024 presidential margin**); this is not mislabeled as a previous
Senate or governor result. At implementation, the verified 2024 presidential
state/county source is available. Older presidential and same-office sources
remain disabled by the existing provenance gate and display a blank dash.

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
Profiles preserve panel resizing, operator presets, mobile sheets and election
semantics. Projection typography and surfaces use the shared card stylesheet on
both the board and OBS; no public-call workflow changed.

Reference: NBCU Academy's [behind-the-scenes account](https://nbcuacademy.com/steve-kornacki-2024-election/)
describes touch-driven comparisons with prior elections. This supports the quick
comparison interaction; the exact broadcast button was not independently matched.

## Verification

Automated coverage includes exact all-vote margins, unavailable sources,
redrawn/missing/unverified House geometry, unique county matching, and profile
migration/save/export validation. Browser inspection covered NBC and NYT
desktop layouts, the expanded phone-sized sheet, scrolling past history to
candidate rows, and the actual rendered Ohio county map. Physical-device and
real OBS compositing are outside this pass.
