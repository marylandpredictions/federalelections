# Live probability continuation — November 8, 2026

Handoff after recovering Codex's unfinished work on `main` at
`66b89cd` ("WIP win probability stuff") and continuing implementation.

## Recovered state

| Item | Value |
| --- | --- |
| Branch / HEAD at recovery | `main` @ `66b89cd` (clean working tree, tracking `origin/main`) |
| Render deploy branch | `main` (`render.yaml`) |
| Production host | https://fedelectionsanalysis.com |
| Local results suite | `npm run test:results` → **351 pass / 0 fail** |
| Authorized configs at recovery | **146** (126 geographic House + 20 race-total House/governor) |
| Authorized configs after identity expansion | **159** (rebuild from same validation gates + verified aliases) |
| Senate configs | **0** |
| Production coverage at recovery | total 506; **live 144**; **stale 2**; waiting 0; unavailable 360 |

Production sample (`house-FL-2`) returned `status: live`, model
`fea-live-partial-count-1`, 20,000 simulations, NBC provenance, and retained
history across model-revision points.

## What Codex already completed

- NBC national/county ingestion repairs, Maine ballot denominators, Alaska
  native units, Vermont municipality aggregation, municipal→county priors.
- Calibrated geographic partial-count model with scoped release gate.
- Conservative race-total fallback with 2022 exploratory + 2024 frozen
  confirmation evidence; 60% reporting floor preserved.
- Identity reconciliation for several House races; release expanded to 146.
- Worker/outage/restart/correction/history tests; Python↔JS numerical port.
- WIP research (count-only, ballot, statewide, ranked, runoff, joint studies)
  committed as evidence, **not** as production authorization.

## Approved model families

1. **Geographic partial-count** (`inputMode` omitted): two-candidate D/R House
   plurality, ≥25% source reporting, positive counts/estimates in every model
   area, reconciled geography, 20,000 simulations.
2. **Race-total fallback** (`inputMode: "race-total"`): complete two-candidate
   D/R House or governor plurality, ≥60% source reporting, no invented counties.

Release file: `data/results/probability-release.json`. Runtime override at the
results disk root still takes precedence if an operator installs one.

## Nationwide refresh capacity

Documentation previously cited a **one race / 15 s** background county queue
(~126 minutes for 506 races). Current code already schedules up to **three**
eligible county refreshes every **1.5 s**, reserving one NBC request slot for
public detail (`server.mjs`, `LiveProbability.nextCountyRaces`,
`NbcCountyProvider.availableRequests`).

Nominal math: 506 ÷ 3 × 1.5 s ≈ **254 s** per full county sweep, under the
five-minute freshness window, **if** upstream latency and rate limits allow.
Race-total races skip county hydration. Synthetic round-robin coverage is
covered in `tests/results/win-probability.test.mjs`. Actual Render throughput
at full geographic scope remains a live measurement, not a lab claim.

Unchanged inputs still skip simulations and history writes.

## Remaining blockers to 506 published odds

| Blocker class | Approximate scale | Notes |
| --- | --- | --- |
| Multi-candidate / non-D–R ballots | ~235–298 House+statewide | Need full-ballot winner model + validation |
| Special rules (RCV, runoff, VT contingency) | 29 catalogue races | Separate rule models; unresolved mass when required |
| Identity / roster mismatches | Dozens of otherwise two-candidate races | Fixable with verified aliases; do not guess |
| Senate geographic extension | Held-out Senate failed vs prior | See `docs/probability-state-extension-validation.md` |
| Governor geographic expansion | Encouraging but thin competitive sample | Race-total governors only where evidence binds |
| Early-stage / <60% race-total | Several CA House races in Nov 7 audit | Keep 60% floor until new holdout evidence |
| Completion notices | None verified for production inputs | Source % ≠ completion |

Failed experiments (count-only cross-cycle, full-ballot analogs, statewide
turnout blend, Senate geographic transfer, Alaska transfer sensitivity) remain
documented in `docs/win-probability-research.md`. Do not re-tune on the same
holdouts.

## Reproduction

```text
npm run test:results
node scripts/results/build-partial-probability-release.mjs \
  .runtime/probability-real-partial-expanded-points.json \
  .runtime/probability-nbc-prior-margin-audit.json \
  data/results/probability-release.json \
  .runtime/probability-aggregate-2026-audit.json
```

Private NBC captures and scoring frames stay under `.runtime/` (gitignored).

## Continuation priorities

1. Reconcile verified candidate identities and expand race-total coverage under
   existing gates.
2. Keep geographic model preferred wherever reconciled inputs exist.
3. Measure production county-refresh latency before claiming nationwide
   five-minute freshness for hundreds of geographic races.
4. Develop special-rule and multi-candidate models only with independent
   evidence; otherwise leave races unavailable.
