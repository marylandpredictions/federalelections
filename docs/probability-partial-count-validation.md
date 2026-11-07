# Partial-count model research, November 7, 2026

This is progress toward the 506-race live-odds goal, not a probability release.
No public probability has been authorized by these research artifacts.

The model conditions a Gaussian geographic hierarchy on partial county counts.
It estimates correlated state counting-order errors and uncertain turnout from
2020 observations. A second variant adds a historical-partisanship interaction
to statewide swing. All observed votes remain fixed; simulations allocate only
additional votes. Source estimates of 100% reported still permit outstanding
votes. Counties with no count retain a prior rather than observing an invented
zero margin. An empty county with a positive reported percentage retains its
historical turnout fallback.

The 2020 training uses 2016 county priors. The presidential 2024 evaluation uses
2020 priors. Every 2020 geographic validation fold excludes that state's count
observations and historical swings from fitting. Those 2020 folds are a
retrospective geographic diagnostic, not a prospective election-night replay.
The forward evaluation uses the earlier cycle exclusively for fitting.
Repeated inspection of 2024 outcomes means subsequent model comparisons remain
exploratory. No independent reviewer or preregistration is implied.

## Sources and quarantine

The [MEDSL 2020 archive](https://github.com/MEDSL/election_night2020/tree/5becbf2c988522d5ed480e661ba5700f7e65b8fa)
and [MEDSL 2024 release](https://doi.org/10.7910/DVN/2CKSIK) are pinned in
`data/results/probability-medsl-count-manifest.json`. Full decoded downloads
passed the publisher/Git checksum checks. The corrected 2024 state-control file
is Harvard Dataverse file 10883470 (`?format=original`), SHA-256
`131ca71808573afec6dabddabe312b24d5172fa1ade837938836a7743cb908ee`.
The publisher warns that some raw county counts have reporting artifacts.

The frame builder requires a complete set of county identifiers at one source
timestamp, rejects conflicting duplicate rows, and checks aggregate counts.
2020 `votes` is the county total; `total.votes` repeats the contemporaneous
state total and must match the county sum. There are 68 selected 2020 frames;
two lack a matching historical county prior. Of 159 selected 2024 frames, 155
match corrected state candidate and total controls exactly. Three mismatches
and one missing exact-time control are quarantined without replacing them
with a more convenient later observation. Source clocks remain unconverted.

Final turnout selects evaluation strata only. Final totals, winners and strata
are excluded from forecast inputs and random seeds. Reported candidate counts
and source percentages determine the forecast. Native New England and Alaska
reporting geographies are outside this county study.

## Executed comparisons

Scores below weight states equally and snapshots equally within states. Lower
Brier scores are better. The comparison holds observed votes fixed and uses
historical geography and uncertain turnout, without a live swing update.

| Forward cohort | Frames / states | Comparison Brier | Partial-count Brier | 80% margin coverage |
| --- | ---: | ---: | ---: | ---: |
| 2024 president, uniform swing | 155 / 42 | .04588 | .02415 | 77.2% |
| 2024 president, partisan interaction | 155 / 42 | .04464 | .02238 | 80.6% |
| 2022 Senate, uniform swing | 9 / 9 | .04792 | .00099 | 77.8% |
| 2024 Senate, uniform swing | 3 / 3 | .04873 | .01979 | 100% |

For presidential uniform swing, the paired Brier difference is -.02173, with
a state-cluster bootstrap 95% interval of [-.04010, -.00673]. For the partisan
variant it is -.02226 [-.04097, -.00700]. Each improves on its comparison at
25–59%, 60–89% and 90–99% reported. The earliest stage's difference interval
includes zero. In 11 states finishing within ten points, the uniform variant's
paired Brier difference is -.08131 [-.13320, -.03552]. Snapshots from the same
state are resampled together, never treated as independent elections.

The Senate transfer uses unchanged 2020 presidential fits on archived actual
county counts, not simulated down-ballot counts. Its first and later captures
are explicitly marked by capture index. It has only twelve eligible snapshots,
all of whose counted leaders ultimately won. It does not validate reversals,
early counts, all Senate races, or the chances of independent candidates.
Its conditional D/R target is not a complete candidate probability vector.
The partisan variant performed worse than uniform swing in these Senate tests.
There is no blanket winner across the two specifications.

Two additional first-capture checks use the 2022 Arizona and Colorado governor
contests. Their decoded payloads match the capture manifest exactly. Certified
controls come from the official Arizona canvass transcription and Colorado's
official results portal. Both observed leaders won and both partial-count 80%
intervals contain the final margin. The Arizona uniform-swing median is D+4.15
against a final D+0.67, worse than the comparison's D+1.26. Colorado improves
from D+13.15 to D+18.98 against the final D+19.35. Two cases cannot certify
governor calibration or justify choosing a model based on this comparison.

House transfer checks now include seven reconciled 2022 snapshots: CA-13,
CA-22, CO-03, DE at-large, WA-03, WA-08 and WY at-large. An eighth NY-17
capture has no reported votes and remains quarantined from partial-count scoring.
Their archived SHA-1 digests cover gzip-encoded HTTP
payloads; decoded SHA-256 digests are recorded separately in
`data/results/probability-house-capture-manifest.json`. County sums match the
contemporaneous district summaries and candidate identities match certified
district returns. Delaware and Wyoming are late-count 99%-reported snapshots.
The uniform model improves Delaware's
median from D+13.21 to D+12.50 against a final D+12.50. It worsens Wyoming's
median to R+44.65 against the candidate-vote margin R+43.81; its interval
contains that margin. The earlier R+42.86 calculation incorrectly included
invalid/blank ballots in Wyoming's candidate-vote denominator. The adapter now
reconciles those ballot categories separately, including New York's categories.

The presidential-geography-only prototype gives false high-confidence forecasts
in CA-13 and CA-22. A further input experiment uses the original FiveThirtyEight
House forecast CSV archived on September 24, 2022, before the election. Its
decoded SHA-256 is
`fde89583e8e46b8854703116d09a14d4dd2b3befe3dc986a1706aeb988db95fd`.
The latest `_deluxe` row available in that capture is selected by parsed date,
matched to the named candidates, and used to shift county log odds without
changing geographic ordering. No final outcome selects the date, tilt or mean.

Across these seven snapshots, the historical-only conditional D/R Brier score
is .40226. Candidate mean anchoring reduces it to .26728. Also carrying the
frozen forecast's 80% interval into the statewide prior through a normal
moment approximation reduces it to .20284; its margin interval covers 6/7
outcomes. WA-03 remains a miss (D win probability .10028, final D+0.82).
The small, geographically concentrated cohort does not certify House
calibration. These are exploratory comparisons, not a release or a claim of
independent confirmation. The experiment keeps the 2020-trained count likelihood
unchanged and does not tune a race-specific correction to the missed outcome.

Full metrics, paired bootstrap intervals, quarantine lists and forecast-report
hashes for the earlier presidential/Senate experiments are in
`data/results/probability-partial-count-research.json`; that file is not a
current release manifest. Historical raw payloads remain private local captures.
The latest complete results suite passed 322 tests with no skips, and ten
partial-state Python checks plus three frozen-anchor checks passed.

A JavaScript statistical kernel now implements the same partial-count
hierarchy in the server's runtime. Nine automated checks compare its
posterior against an independent Numpy matrix solution and its simulation
against Python Monte Carlo, test deterministic ordering/outcome isolation,
zero-vote counties, uncertain 100% reporting and malformed inputs. This kernel
returns an explicitly research-only conditional D/R comparison, not an
all-candidate public probability vector. Publication still uses the existing
reviewed-release gate.

The all-vote and count-only variants are separate experiments. The count-only
model improves on an uninformative prior in the 2024 presidential cohort but
its 80% margin coverage is only about 55%. Pooled Beta-CDF recalibration fitted
on the 2020 state folds raises coverage to about 73%, still with stage-dependent
failures. Recalibrating the historical model worsens both Brier score and
coverage. Neither result authorizes a generic fallback. The separate
other-candidate-share experiment also has inadequate interval coverage and
cannot stand in for a major independent's win probability.

## Reproduce

Run from the repository root with Python/numpy. The earlier county-component
experiment also needs scipy. Supply the original pinned source downloads in a
private capture directory; the source manifest describes their checksums.
The recorded Python environment is 3.12.10 with numpy 2.5.3 and scipy 1.18.1;
`scripts/results/requirements-probability-research.txt` records those optional
offline dependencies. The server does not install or require them.

```text
python scripts/results/probability-county-count-study.py .runtime 2020
python scripts/results/probability-county-count-study.py .runtime 2024
python scripts/results/probability-state-count-frames.py .runtime 2020
python scripts/results/probability-state-count-frames.py .runtime 2024
python scripts/results/probability-partial-state-study.py .runtime
python scripts/results/probability-partial-state-study.py .runtime --partisan
python scripts/results/probability-partial-state-score.py .runtime/probability-partial-state-trial.json .runtime/probability-partial-state-scores.json
python tests/results/probability_partial_state_test.py
```

The optional Senate adapter reads the dated NYT response bodies already used
by `probability-turnout-study.mjs`. Store the public
[capture manifest](https://github.com/electarchive/live-forecast/blob/main/frames/manifest.json)
as `probability-external-capture-manifest.json` and decoded or gzipped bodies
in `probability-turnout-captures/`. Each body must match a manifest checksum.
The adapter records omissions and validates election, named candidate identities,
full-ballot totals, county identifiers, source timestamps and certified controls.
Fusion ballot lines are aggregated by candidate name before matching.

```text
node scripts/results/probability-senate-county-frames.mjs .runtime
python scripts/results/probability-partial-state-study.py .runtime --transfer-frames .runtime/probability-senate-county-frames.json
node scripts/results/probability-senate-county-frames.mjs .runtime governor
python scripts/results/probability-partial-state-study.py .runtime --transfer-frames .runtime/probability-governor-county-frames.json
node scripts/results/probability-senate-county-frames.mjs .runtime house
python scripts/results/probability-frozen-house-study.py .runtime
python tests/results/probability_frozen_house_test.py
```

Remaining release work includes House/governor transfer evidence, partial
geography and missing-prior validation, multi-candidate and election-rule
coverage, production worker integration, independent review, and live coverage
verification of all 506 races.
