# Public research links

- Results accepts `office` and `race`. A five-digit county or ten-digit local reporting ID can be passed as `county` with `tab=counties`.
- Election Lab accepts `office`, `race`, `baseline`, and `unit`. Its workspace also preserves `metric`, `display`, `find`, `sort`, and `local-sort` in the link it generates. An unavailable baseline falls back to the office default, and an unavailable reporting unit falls back to race-wide results.
- Polling bias uses a two-letter `state` and supports `#state-details`. It links to a 2026 Senate race only if that state appears in the public race catalogue.
- The presidential archive accepts `state` and `year` (2016, 2020, or 2024). For district-specific evidence, use the Lab's Historical Benchmarks instead.
- Map Maker accepts `office` and `race` together. A matching race is selected in the map and picker. The link carries geography only, leaving scenario ratings to the editor.

Race IDs use the existing public results catalogue. An unknown or mismatched race leaves the destination's normal view in place.
