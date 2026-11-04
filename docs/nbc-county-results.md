# NBC county results — November 3, 2026

Starting HEAD: `50845fa2`.

The national NBC endpoints contain race totals, not county breakdowns. The
national adapter previously always emitted `counties: []`. FEA now follows the
actual race link supplied in the national feed, reads its public `__NEXT_DATA__`
page props, and uses the exact `updateUrl` that NBC declares on that page.
For example, [Colorado Senate](https://www.nbcnews.com/politics/2026-elections/colorado-senate-results)
declares `/firecracker/api/v2/state-results/2026-elections/colorado-senate-results`.
No guessed county URLs or HTML table scraping are required.

## Data and safety

- Statewide counties: `races[].mapData[FIPS]`.
- House counties: `races[].mapData[district].counties[FIPS]`. These are the
  district's reported county portions, never the whole state's county totals.
- New England: township keys are often names rather than GEOIDs. NBC geometry
  IDs and current FEA Census municipality assets supply exact joins. Full names
  and uniquely identified companion units disambiguate town/plantation and
  town/location pairs; unresolved matches are quarantined rather than guessed.
- Validate production brand, election date/type, state, office, exact race ID,
  district, timestamps, unique candidates, safe raw votes, totals and percentages.
  Ohio/Florida special-election identity requires the special page family and
  explicit special schema (the page uses `true`, the API uses `"special"`).
- County data never publishes or retracts calls, nor replaces national totals.
  Malformed, missing, regressed or reset county data retains last good results.
- First opening a race requests its breakdown immediately. Concurrent viewers
  share a request/cache. Open/recently viewed races refresh during normal provider
  polls, with a 15-second minimum per-race cache, conditional ETags, four concurrent
  county requests, eight race refreshes per poll and 64 recent subscriptions/cache
  entries. Subscriptions expire after two minutes without detail requests.
  HTML and topology responses are discarded after normalization.
- County-only changes advance the normal detail/delta version and sparse county
  history. Fetch timestamps alone do not. Stored breakdowns survive the existing
  runtime recovery path. No new database or separate public polling timer.
- Initial lazy hydration carries its originating summary version so the browser
  accepts the new county detail immediately. A response overtaken by a newer
  client summary remains rejected. This fixes the first-open gray map.

## Executed verification

Baseline: 242 passing results tests. Final: 251 passing, zero skipped. Candidate
audit passed (506 reviewed, zero placeholders/needs-review flags). Data JSON
validation passed. Nine targeted tests cover observed schemas, invalid identities,
isolated malformed/reset counties, duplicate names, safe disambiguation, conditional
requests, concurrent requests, retry/discovery, inactivity, county-only deltas,
last-good recovery/restart and the browser version handoff.

Real public detail HTTP responses from an isolated server using live NBC:

| Race | Breakdown units returned |
| --- | ---: |
| Virginia Senate | 133 |
| Colorado Senate | 64 |
| Colorado governor | 64 |
| CO-04 | 21 district county portions |
| Ohio special Senate | 88 |
| Maine Senate | 516 |
| Massachusetts Senate | 351 |
| New Hampshire Senate | 238 |

The actual browser loaded Virginia on first open, rendered 133 county paths with
live colors, and selected Prince George: 6,115 votes, Mark Warner 3,201,
Bert Mizusawa 2,903, write-ins 11 in that observed snapshot. No browser console
errors/warnings. The selected county panel, lock and tabs worked without reload.
Results keep updating; these are observations, not fixed expected election totals.

Three of NBC's 519 Maine entries lack a confident geometry join: Drew unorganized
territory, Penobscot Indian Island Reservation, and Overseas Absentee. They remain
quarantined in county diagnostics; statewide totals still include NBC's full race.
Overseas absentee is not a geographic municipality. Do not distribute these votes
among neighboring shapes or manufacture GEOIDs.

Live Render deployment/restart was not tested. Local server recovery tests passed;
that is not certification of a hosted persistent disk.
