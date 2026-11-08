# Cross-office validation — November 8, 2026

This research does not authorize Senate/governor publication. The production
House release remains separately bound to its validated evidence. The overall
506-race objective remains incomplete.

## Source collection and frozen method

The evaluation plan was committed as `fe5e08e2` before expanded forecasts were
calculated. The existing candidate-and-uncertainty method and 2020 count
likelihood were unchanged. Explicit normalized source hashes were subsequently
added to make the same statistical implementation reproducible across platforms.

Discovery used the first archived URL capture from November 9–10, 2022, without
selecting on the winner or margin. After one retry of connection failures, 67
race responses and two pre-election forecast CSVs passed archive checksums.
Louisiana's non-General/ambiguous resource was rejected. Lieutenant-governor,
ballot-question and non-state URLs were excluded by office identity. Source
metadata is in `data/results/probability-state-cohort-manifest.json`; raw archive
responses remain private research inputs.

Candidate forecasts are the September 24 archived FiveThirtyEight deluxe
toplines, with actual forecast rows dated September 23. The parser checks
pre-election availability, bytes, candidate identities and uncertainty. Final
returns enter scoring and reconciliation only, never a predictor or its seed.

## Results, including the failed extension

Candidate/geography/count checks admitted 21 Senate and 16 governor frames.
Frozen candidate matching admitted 20 Senate forecasts and all 16 governor
forecasts. Previously inspected cases and stages below 25% are reported
separately. Full metrics and quarantine reasons are preserved in
`data/results/probability-state-forward-validation.json`.

| New races with at least 25% reporting | Senate | Governor |
| --- | ---: | ---: |
| Races / independent state clusters | 13 | 13 |
| Model Brier score | .06363 | .000000102 |
| Frozen prior Brier score | .02764 | .01762 |
| 80% margin interval coverage | 76.9% | 76.9% |
| Wrong forecasts above 95% confidence | 0 | 0 |
| State-bootstrap 95% Brier difference | [-.02676, .13599] | [-.04150, -.0000631] |
| Prior-competitive cases | 2 | 3 |

Lower Brier is better. The Senate extension does **not** demonstrate an
improvement over the frozen prior. North Carolina at 39.01% reporting received
85.8% Democratic conditional win probability; the Republican won. The model's
median was D+4.72 with an 80% interval from R+1.06 to D+10.47, versus an actual
R+3.23. This miss remains in every applicable score. It is not excluded or
corrected with knowledge of the final outcome.

Governor results are encouraging but contain only three newly inspected
prior-competitive cases. Neither sample certifies a full multicandidate win
vector, major independent, ranked-choice transfer, runoff or legislative choice.

## Parser correction

The certified governor transcription includes explicitly labeled aggregate
write-ins, scattering and none-of-the-above votes without a named candidate.
These are now retained as ballot categories for reconciliation. They are never
invented named candidates. Unknown unnamed rows still invalidate the control;
a category exceeding the named pair also prevents the pair from being treated
as the winner comparison. Existing source, checksum and election checks remain.

Some official results are hosted on contracted/non-`.gov` sites. The existing
strict authority filter still withholds those controls until their official
delegation is verified. This explains several remaining governor exclusions.

## Reproduction

With the archived inputs and pinned transcription in `.runtime`:

```text
node scripts/results/probability-senate-county-frames.mjs .runtime senate data/results/probability-state-cohort-manifest.json .runtime/probability-state-extension-captures .runtime/probability-state-extension-senate-frames.json
node scripts/results/probability-senate-county-frames.mjs .runtime governor data/results/probability-state-cohort-manifest.json .runtime/probability-state-extension-captures .runtime/probability-state-extension-governor-frames.json
python scripts/results/probability-frozen-state-study.py senate
python scripts/results/probability-frozen-state-study.py governor
python scripts/results/probability-state-forward-score.py
```

Next work must investigate counting-order uncertainty and expand independent
competitive cases. No race-specific adjustment or outcome-based sample removal
is justified by this result.
