# NBC broadcast presentation and secondary result feed

Starting point: `efbb41ea` (November 3, 2026).

## Broadcast reference and composition

The theme follows NBC's actual on-air Big Board rather than the NBC results
website. The primary visual reference was NBC's own
[Illinois analysis broadcast frame](https://media-cldnry.s-nbcnews.com/image/upload/mpx/2704722219/2024_11/1730892502157_tdy_news_spec_6a_kornacki_breakdown_241106_1920x1080-831vfc.jpg),
with the designer's [Big Board presentation](https://www.codeandtheory.com/things-we-make/nbc-big-board)
and the supplied broadcast screenshots as context.

Adopted details:

- continuous light results sheet on the left, geographic canvas on the right;
- condensed uppercase race/candidate typography, colored candidate bands and
  separate light percentage/vote columns;
- matching party order and fixed header/row heights for current and historical
  columns, with the winning historical candidate's solid party treatment;
- narrow comparison and map-tool rails, compact utility buttons, a restrained
  masthead and chamber meter;
- shared NBC projection-card styling for Results and the OBS browser source;
- contrast adjustment for numeric ink on the light sheet without altering the
  party's actual map color, and TV-specific type scaling.

FEA branding, full ballot names, no portraits, all existing tabs, call semantics,
manual sizing, themes and local preferences remain. The sheet has its own light
surface tokens, so imported custom themes still retain their palettes.

## Feed notice

The feed notice is moved out of the map into a reserved footer row. The row has
the same height when healthy or delayed, preventing both overlap and map jumps.
It works for every Results theme. Menu height and tooltip positioning account
for the reserved space; the notice has no pointer-intercepting overlay. Long
text truncates visually while the complete status remains accessible.

## CivicAPI contract

Official documentation: <https://www.civicapi.org/api-documentation>.
Election listing: <https://www.civicapi.org/results/elections/november-3-2026>.
Observed listing request:
`https://civicapi.org/api/v2/race/search?startDate=2026-11-03&endDate=2026-11-03&limit=50000`.
This listing was inspected once to build the explicit manifest; it is not fetched
on every poll. Full details use `https://civicapi.org/api/v2/race/{id}`.

The adapter uses the documented full race detail schema, not the search result's
candidate summary. It checks `test_data`, `is_disputed`, election identity,
`last_updated`, unique candidate IDs, names, ballot completeness and raw integer
votes. It does not use candidate `winner` or `advanced` fields for any call.
Fallback county results are not imported without a verified geographic join;
previous county data remains available. Attribution is displayed as required by
CivicAPI's public API documentation.

Six targeted provider tests cover real-schema parsing, negative fixtures,
idle-primary behavior, bounded outage traffic/cache behavior, pending-call
isolation, publication attribution, rate-limit/Retry-After handling, last-good restart recovery and an NBC
recovery that is behind secondary totals. A production manifest test checks all
506 one-to-one mappings. These tests are local, not hosted Render certification.

## Executed checks

- Starting results suite: 235 passing. Final suite: 242 passing, no skipped tests.
- Candidate audit: 506 reviewed, 81 official-source verified, zero placeholders,
  zero needs-review flags. JSON validation passed.
- Actual browser desktop at 1280×720: current and historical columns have equal
  82px headers and 142px rows, the selected map remains visible on the right,
  menus and the comparison rail remain reachable, and no horizontal overflow.
- A local response fixture forced the exact warning “Results may be delayed.
  Last update 3 min ago.” The board ended at y=692; the reserved status row began
  at y=692 and ended at y=720, with the race window ending at y=674. No overlap.
  Both FEA Night and NBC styling were checked against this fixture.
- An actual 390×844 browser viewport was observed for the phone layout (not a
  physical phone): document width was 390, the board ended at y=816 and the
  status row occupied y=816–844. Race close and comparison controls were reachable.
- Real CivicAPI responses were matched against freshly fetched NBC rosters:
  Colorado Senate (nine candidates), TX-04 (two), and Nebraska governor (four).
  All had zero pre-election votes and no public call.
  Positive-vote outage/recovery/restart scenarios use isolated test fixtures.
- Real Render network/persistence behavior, physical devices, and real OBS
  compositing were not certified in this pass.

The populated 15-call browser rehearsal exposed a legacy notification offset
that assumed bottom-docked map controls. NBC now displays one projection card
with a queued-call counter, anchored inside the map's usable area. The repeated
burst showed one card at y=391–572 with “+14 more projections”; all 15 calls
remained in the chamber/calls history. This removes the off-screen stack without
changing call publication or the other presentation profiles' queue layouts.
The refreshed shared card was also opened in the OBS browser-source preview.
