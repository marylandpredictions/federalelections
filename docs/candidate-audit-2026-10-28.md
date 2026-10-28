# Candidate audit — October 28, 2026

All **506 election-night races** were reconciled against dated general-election candidate lists: 435 House, 35 Senate, and 36 governor races. The catalogue now contains **1,550 named identities**: 1,231 House, 151 Senate, and 168 governor candidates. The audit found **zero empty rosters and zero recognized placeholder/filler names**. No candidate listed in the reviewed source roster is absent from the catalogue.

This is source reconciliation, not a claim of nationwide official ballot certification. Ten rosters use official Louisiana/Wyoming sources; 496 use Ballotpedia's current general-election lists. Late source errors, withdrawals, replacements, and newly registered write-ins can still require updates.

## Corrections

The audit changed 349 roster name sets, including missing opponents, stale primary candidates, ballot-name variations, and omitted minor-party/write-in candidates. Three remaining descriptive fillers were replaced with actual source-listed names:

- South Dakota Senate: `independent longshot, caucus not credited` → **Brian Bengs**.
- Alabama Senate: unresolved Larriett/Wess runoff label → **Everett Wess**.
- Oklahoma governor: unresolved Drummond/Mazzei runoff label → **Mike Mazzei**, with **Cyndi Munson** and the listed independents also restored.

The source also excludes withdrawn or defeated candidates. For example, Idaho's general-election source marks David Roth withdrawn; he is not retained as a fictitious Democratic nominee. Nebraska's obsolete Senate “Special” label was corrected.

Five races have a single candidate in the reviewed list: FL-10 Maxwell Alejandro Frost; MA-02 Jim McGovern; MA-05 Katherine Clark; MA-07 Ayanna Pressley; WI-02 Mark Pocan. These were checked against their general-election lists rather than treated as uncontested merely because old metadata lacked an opponent.

## Summary versus detail

Compact map/county summaries retain Democratic and Republican ballot nominees and explicitly preserve these prominent challengers:

| Race | Candidate |
|---|---|
| South Dakota Senate | Brian Bengs |
| Idaho Senate | Todd Achilles |
| Montana Senate | Seth Bodnar |
| Nebraska Senate | Dan Osborn |

Other minor-party and write-in candidates remain in the full race detail. A candidate among the actual top two vote leaders also remains visible in the compact summary, regardless of party. This rule changes display only; totals, denominators, calls, and chamber affiliation are unaffected.

For example, Montana's compact summary shows Alani Bankhead, Kurt Alme, and Seth Bodnar; opening the race also shows Kyle Austin and write-in Jami Woodman. Idaho detail retains Natalie Fleming and Matt Loesby alongside Jim Risch and Todd Achilles. Declared write-ins whose registration is not verified are identified as such.

## Provenance and verification

- `data/results/reviewed-ballots-2026.json`: dated source identities, per-race source URLs, and source hashes. It contains no forecast probabilities, vote shares, winners, or calls.
- `data/results/louisiana-ballot-2026.json`: official Louisiana extraction.
- `data/results/candidate-review-changes.json`: before/after names for the 349 reconciled races.
- `data/results/candidate-roster-audit.json`: all-race counts, review/certification distinction, empty/filler checks.
- `data/results/candidate-summary-priorities.json`: the four explicit summary priorities.

House state pages were parsed only from their general-election sections. Senate/governor directories accept general-election and ranked-choice Round 1 candidates, with write-ins explicitly identified. Primary losers, withdrawals, and disqualifications are excluded. Available individual statewide pages were checked against the directory lists. Official Louisiana/Wyoming sources take precedence.

**63/63 results tests pass**, including exact catalogue-to-source coverage for all 506 races, filler rejection, summary visibility, full-detail preservation, parser phase filtering, and protection against stale zero-vote runtime rosters. The public HTTP summary and all 506 race-detail responses were separately checked: 1,550 candidates, zero name-set mismatches, and all four summary priorities preserved. Checked-in summary/detail fallbacks were reconciled too; the measured result is saved in `docs/candidate-http-verification.json`.

Browser checks confirmed all four prominent independents in public details. Compact summaries were checked for South Dakota, Idaho, Montana, and Nebraska; minor candidates were absent from those summaries and present in details. Browser console checks showed no errors. A saved Montana summary screenshot shows all three principal candidates.

## Maintenance

Run `npm run audit:results-candidates` for the checked-in roster audit and `npm run sync:results-candidates` to regenerate the catalogue from the reviewed sources. The sync fails if a configured prominent candidate is missing.

For a new source review, save the public source pages in a local cache, then run `node scripts/results/review-candidate-catalogue.mjs --cache=PATH`, followed by sync and tests. The review script requires complete race coverage and has no forecast fallback. Raw downloaded HTML is kept outside the repository; only extracted identities and hashes are committed.

Reference directories: [House](https://ballotpedia.org/United_States_House_of_Representatives_elections,_2026), [Senate](https://ballotpedia.org/United_States_Senate_elections,_2026), [governors](https://ballotpedia.org/Gubernatorial_elections,_2026). Individual source links are recorded with each race.
