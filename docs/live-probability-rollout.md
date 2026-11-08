# Live probability rollout — November 8, 2026

The objective remains published, validated odds for all 506 races. The first
scoped configuration initially contained 99 House races and now contains 118;
the other 388 are not certified
by this release. Configuration coverage is not proof that every configured race
currently has fresh, reconciled NBC inputs. Check the public coverage API.

## Evidence and supported scope

The count likelihood was fitted on 2020 presidential county reporting. The
House extension uses archived real 2022 counts and a separately captured
September 24 pre-election candidate forecast. Candidate means recenter the
historical geography; published forecast uncertainty enters the statewide prior.
No final outcome enters the predictor, forecast date selection, or random seed.

The expanded archive index covered 399 races: 368 downloads passed their archive
checksums and 31 failed. Input and candidate checks admitted 163 forecasts;
149 were races not previously inspected during development. All exclusions
remain in the private scoring output, rather than becoming replacement samples.

For the supported reporting stages (at least 25% source-estimated reporting),
the new-race sample contains 144 races across 33 states. The chosen
candidate-and-uncertainty model has binary Brier score .00440 versus .01665 for
the frozen candidate forecast. Its paired state-cluster 95% difference interval
is [-.02117, -.00521]. Its 80% margin interval covers 88.2% of outcomes, with no
wrong forecasts above 95% confidence. Among 21 prior-competitive races, coverage
is 76.2% and the Brier difference interval is [-.13275, -.04196].

Single-county districts use their actual one reporting unit, without invented
subdivisions. These were already included in the frozen evaluation. The
descriptive subgroup diagnostic is retained in
`data/results/probability-house-single-unit-diagnostic.json`; no parameters were
refitted for this subgroup. Classic completed-county model requirements remain
unchanged. The partial-count path explicitly permits a reconciled single unit.

This is a retrospective race holdout in one House cycle, not independent human
review, second-cycle House certification, or validation of every election rule.
Only five new early-stage cases were available; early-stage publication remains
disabled. The full all-stage results, including weaker early-stage performance,
remain in `data/results/probability-house-forward-validation.json`.

The public adapter is limited to an exactly two-candidate Democratic/Republican
House plurality field. In that special case the tested D/R comparison is the
entire candidate-win vector. It must not be applied to a multicandidate field,
ranked-choice election, runoff, or governor's legislative contingency.

## Inputs and release checks

The 2026 means and uncertainties come from FEA's November 2 forecast, preserved
in commit `4b2845d76040aa258d8e92f07567bccf2d4bcf3a`. Those are priors, not fixed
predictions. Live counts remain untouched. Historical geography must reconcile
and the reviewed/local and NBC rosters must agree. Four otherwise eligible
races are withheld because historical geographic sources disagree: AL-06,
CA-08, CA-18 and TX-10. No neighboring geography or guessed turnout substitutes.

The normal model uses NBC only. Every model area needs a positive count and a
positive source estimate; source 100% is not proof of completion. Turnout and
remaining vote stay uncertain. The model runs 20,000 backend simulations;
unchanged inputs do not create additional simulations or history points.

The release binds the validation artifact, trained calibration and current
implementation. It checks scope, sample size, state-cluster skill, interval
coverage, false-confidence cases, roster identities, and as-of provenance.
Approval is explicitly automated checks plus agent source review; it does not
claim an independent human reviewer.

`probability-release.json` on durable runtime storage remains an operator
override. Otherwise the server reads `data/results/probability-release.json`
from the deployed repository. Invalid configuration fails closed. Git contains
configuration and evidence, never a high-frequency results or history database.

## Delay, correction and persistence behavior

NBC snapshots older than five minutes are labelled stale. On startup, a valid
dated snapshot up to 48 hours old can produce a clearly stale initial estimate;
it cannot masquerade as current data. Provider failure retains the last model
point. CivicAPI fallback does not supply new model probabilities.

Small newer verified NBC count revisions append a documented correction. Large
resets still require explicit review. Compatible points survive model/prior
revisions and carry their original model/input identities. Each current race
series remains bounded to 240 points and uses atomic runtime writes.

Actual worker, unchanged-heartbeat, percentage-only update, correction,
restart/readback, stale-start, and model-revision tests passed locally. That is
not a claim of a separately performed live Render restart test.

## Reproduction

The research and source commands are documented in
`docs/probability-partial-count-validation.md`. To score the expanded cohort:

```text
python scripts/results/probability-house-forward-score.py .runtime .runtime/probability-house-cohort-forecasts.json .runtime/probability-house-cohort-frames.json .runtime/probability-house-cohort-scores.json
```

The release compiler consumes the private reconciled-input inventory and
geographic crosscheck. It strips live votes, calls and raw NBC responses:

```text
node scripts/results/build-partial-probability-release.mjs .runtime/probability-real-partial-expanded-points.json .runtime/probability-nbc-prior-margin-audit.json data/results/probability-release.json
```

Do not call the 506-race objective complete until production board and coverage
API checks actually demonstrate the full requested coverage.
