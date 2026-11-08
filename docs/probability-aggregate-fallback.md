# Race-total fallback research — November 8, 2026

This fallback demonstrates descriptive predictive skill in the tests below.
It is not yet wired into production. The 506-race publication objective remains
incomplete. The existing geographic model is preferred wherever validated
inputs are available.

## Method and scope

Use the real race-level candidate counts, the source's estimated reporting,
and an independently dated pre-election candidate margin and uncertainty.
Represent the race as one explicitly named `race:` reporting unit. Do not
invent counties, county completion, geographic shares or historical turnout.
The model's existing 2020 counting-order calibration is unchanged. No parameter
was fitted to the 2022 or 2024 evaluation outcomes.

These tests evaluate the D/R comparison component. They cannot authorize a
complete multicandidate win vector, major independent, runoff, ranked-choice
transfer, or legislative contingency. An exactly two-candidate plurality
contest is the special case where the component covers the full ballot.

The aggregate experiment was committed before its forecasts were calculated.
The 2022 races had been inspected in other experiments; this is exploratory
model-selection evidence rather than a claim of an untouched new election.
A different-cycle confirmation was specified before generating any 2024
aggregate predictions. No retuning occurred between those tests.

## 2022 House evidence

For 144 races excluded from the original inspected-case list, with at least
25% source-estimated reporting:

| Metric | Race-total fallback | Frozen pre-election prior |
| --- | ---: | ---: |
| Brier score | .00740 | .01665 |
| 80% margin interval coverage | 93.8% | 87.5% |
| Wrong forecasts above 95% confidence | 0 | 0 |

The paired state-cluster 95% Brier-difference interval is
[-.01627, -.00277]. The fallback is worse than the geographic model, whose
Brier score is .00440 on this sample. That difference also excludes zero.
Among 21 prior-competitive cases, fallback Brier is .05071 and interval coverage
is 90.5%. Wider intervals are conservative, not evidence of exact calibration.

All 193 accepted 2022 House/Senate/governor experiments, their office-specific
scores and exclusions remain in `data/results/probability-aggregate-validation.json`.
The Senate-only Brier improvement interval includes zero; pooled results must
not be described as separately proving Senate-specific improvement.

## Separate 2024 confirmation

The verified archive contains 538's October 7 forecast, captured October 8,
well before Election Day. Its actual ZIP checksum and canonical archive URL
are retained in `data/results/probability-aggregate-2024-anchor-source.json`.
Wayback redirected the requested capture to another indexed pre-election
capture; the actual capture's own timestamp and checksum were verified.

The archived primary interface explicitly labels its published range as 95%.
The normal approximation therefore uses that level, unlike the 2022 source's
explicit p10/p90 interval. This source-semantic correction was committed before
the 2024 model was evaluated.

The county-only 2024 captures do not provide a race reporting estimate. It is
derived from contemporaneous county estimates only when every county has
positive counts and a positive estimate: current votes divided by the sum of
county votes / reporting fraction. Missing/zero counties withhold the estimate.
The final-turnout `countedShareForScoring` field never enters the predictor.

Of 159 source frames, 33 across 23 states pass all checks. The 126 excluded
frames and reasons remain in the score artifact. Results weight states equally,
then frames within each state equally:

| Metric | Race-total fallback | Frozen pre-election prior |
| --- | ---: | ---: |
| Brier score | .00990 | .06341 |
| Log loss | .05605 | .18958 |
| 80% margin interval coverage | 100% | Not compared to the source's 95% range |
| Wrong forecasts above 95% confidence | 0 | Not a model confidence claim |

The paired state-cluster 95% Brier-difference interval is
[-.09880, -.01464]. Eight prior-competitive states have Brier .02833 versus
.18156, with difference interval [-.24230, -.06463]. The four 25–59% cases do
not demonstrate improvement; later stages carry the confirmation. This does
not justify claiming strong early-stage performance.

The intervals substantially overcover. They must be described as conservative;
do not narrow them just to resemble an expected result. The confirmation is
presidential-state component evidence, not an additional House election cycle.

## Next integration checks

Before publication, require a JavaScript implementation matching the research
kernel, a distinct race-total input scheme, exact candidate/source/time checks,
appropriate reporting-stage scope, release hashes and negative tests. Keep the
geographic model as the preferred path. Never use this work to publish a D/R
conditional probability as a full multicandidate win probability.

## Reproduction

With the checksummed source captures in `.runtime`:

```text
python scripts/results/probability-aggregate-study.py
python scripts/results/probability-aggregate-score.py
python scripts/results/probability-aggregate-2024-study.py
python scripts/results/probability-aggregate-2024-score.py
```

See `data/results/probability-aggregate-forward-plan.json` for the frozen
statistical code identities, source conventions and selection rules. The raw
archive ZIP, HTML and live vote responses are not committed.
