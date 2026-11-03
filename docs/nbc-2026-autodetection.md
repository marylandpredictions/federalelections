# Autonomous NBC 2026 results discovery

Starting point: `46737f91905081c5841cf0ff60e234e40f0b690e` on `main`.

## What happens without an operator

`Detect NBC 2026 general-election results` checks every five minutes from October
29 through November 7, 2026 (UTC). GitHub schedules are best effort and can be
delayed. A date guard makes subsequent years' scheduled runs exit without network
requests. **Run workflow** also permits a check outside that window, without
bypassing verification. Scheduled workflows require this file on the default
branch; this repository uses `main`.
Ordinary checks use a shallow, sparse checkout of detector/configuration files.
Full assets/history and installed dependencies are needed only after a verified
configuration change.

1. An isolated Node script checks a small set of historical NBC route families
   and rotating state routes. It also follows bounded 2026 results links found
   on NBC hubs, including hubs that cannot themselves qualify as results apps.
2. Every resource and redirect must be HTTPS on `nbcnews.com` or
   `www.nbcnews.com`. The reader checks robots policy first, stops on access
   denial/rate limits/challenges, and limits requests, response size and duration.
   It never executes downloaded JavaScript, uses credentials, or tries alternate
   hosts to evade a denial. Network errors leave configuration unchanged.
3. Acceptance requires NBC 2026 election-results title/metadata plus either
   structured November 3 general-election race/office application data, or a
   strong production application shell with election scripts, application mount,
   cross-linked results pages and pre-election/results copy. Articles, old
   elections, primaries, previews, homepages, soft 404s and challenges fail closed.
   Zero votes, null votes and empty race lists are fine when the application
   identity is independently established. HTTP 200 alone is never enough.
4. A verified application adds canonical `automaticDiscovery.pageUrls` to
   `data/results-provider.json`. The existing public provider metadata exposes
   the first link as **NBC 2026 results** in the board's overflow menu. A page is
   never passed to a JSON parser as a polling source.
5. The watcher inspects referenced public JSON URLs and up to three referenced
   application scripts for endpoint strings. It does not guess race IDs or
   expand undocumented URL templates. A feed is added only if its actual date,
   state, office, district, candidates and votes pass the existing NBC adapter
   and complete reviewed local roster. Existing sources/mappings are preserved.
   Unmatched races are logged and retried on later runs; healthy matched races
   can activate independently.
6. Only a changed registry is staged. The job installs dependencies, runs the
   candidate gate and complete results tests, then commits
   **Auto-enable NBC 2026 general election results** and pushes `main` using the
   repository's built-in token. A concurrent push triggers a rebase and renewed
   checks; conflicts fail safely. There is no force push or external secret.
7. Unchanged checks create no commits/deploys. `PAGE_CONFIRMED` means link only;
   `DATA_PARTIAL` means some compatible races; `ACTIVE` means all local races
   have confirmed source mappings. Fully active checks exit without NBC requests.
   Dates and votes are not rewritten on every check.
   Only four stable application entry points are retained; discovering another
   state's page alone does not keep generating deployments.

## Deployment and permissions

The workflow has read permission by default and grants only its publishing job
`contents: write`. Existing branch protection must permit this bot to push;
repository policy cannot be bypassed by YAML. The workflow runs quality checks
itself because a `GITHUB_TOKEN` push does **not** launch another push workflow.
See [GitHub's workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

`render.yaml` explicitly declares `branch: main` and
`autoDeployTrigger: commit`, preserving the existing persistent disk, startup
and build commands. A Render service following that Blueprint deploys the bot's
commit through its normal Git integration. This checkout cannot establish
whether the live Render service has applied the Blueprint or has dashboard
overrides: **live Render auto-deployment is not certified here**. See
[Render Blueprint configuration](https://render.com/docs/blueprint-spec).

## Calls and limits

**URL discovery does not establish NBC Decision Desk projection semantics.**
Automatically discovered feeds use `projection.verified: false`. They can update
votes, reporting and maps, but ambiguous `isWinner` flags cannot publish calls.
The existing NBC grace/hold/manual workflow and independently verified source
projection configuration remain intact. No pending call is exposed.

The current strict adapter supports NBC state/race JSON described in
`scripts/results/nbc-provider.mjs`. Alternative *observed* NBC routes require
detector provenance; all runtime responses still pass that strict adapter.
If NBC launches an incompatible schema, blocks automated access, omits complete
candidate rosters, or publishes only browser-executed endpoint templates, the
watcher can safely link a verified app but **cannot promise automatic data or
call activation**. It logs the reason and continues checking. It deliberately
does not weaken validation to make an unknown source work.

## Testing and operation

```sh
npm run test:nbc-detector
npm run audit:results-candidates
npm run test:results
npm run detect:nbc-results                 # dry run; never writes
npm run detect:nbc-results -- --manual     # bypass date window only
```

Local mocked tests cover the required nine page classes, application shells,
alternate-route discovery, robots and redirects, access denial, request/size
bounds, roster rejection, ignored unverified winners, existing-provider
preservation, repeat-run stability, a no-network fully active run, CLI write
safety and the public menu link. They do not depend on NBC's changing website.

Successful discovery prints **NBC 2026 GENERAL-ELECTION RESULTS DETECTED**,
canonical URLs and mapped race coverage. Each tested page/feed logs its status,
final URL and short acceptance/rejection reason, never its full response body.

To roll back an activation, revert the registry commit on `main`. Pause the
workflow first if the discovery itself needs investigation, otherwise the next
scheduled run may legitimately rediscover the same application. No production
calls, runtime storage or fallback providers are deleted by the detector.

## Verification performed October 29, 2026

- Installation and the production candidate gate passed: 506 reviewed races,
  81 official-source verified, zero placeholders/review issues.
- All 171 results tests passed (142 existing plus 29 detector/integration tests),
  with zero failures or skips; the five restart checks also passed separately. A
  restricted local-server attempt failed; the full suite passed when allowed
  to start its isolated restart/recovery servers.
- Inspection of newer remote CI runs found a static certification bug: importing
  committed call state into a disposable empty disk incorrectly triggered the
  production missing-envelope guard. Certification now explicitly seeds its own
  empty calls fixture; the production recovery safeguard remains unchanged.
- A disposable local bare Git remote exercised the publishing path: a verified
  configuration commit rebased over a concurrent operator commit and pushed
  successfully while runner-specific installed dependency metadata remained
  uncommitted. No actual NBC activation was fabricated for this test.
- A live dry run fetched NBC's robots policy. The candidate hub returned 404;
  remaining checks stopped under access policy. No real application/feed was
  verified and the production registry remained unchanged.
- An isolated browser fixture rendered the external NBC menu link, with one
  link, safe new-tab attributes, readable computed text color and an on-screen
  189 by 46 pixel target. Screenshot capture timed out, so this is rendered
  DOM/accessibility verification, not a completed screenshot review.
- Dependency installation reported an existing high-severity `sharp` advisory.
  No detector dependency was added; the suggested breaking dependency upgrade
  was kept outside this focused change.


## Owner-supplied public page links — November 3, 2026

`publicResultsPages` in `data/results-provider.json` contains the Senate, House
and Governor result pages supplied by the owner. Public provider health exposes
these links; the Results menu selects the matching office immediately when the
user switches maps. These are website links, not polling endpoints. They do not
mark automatic discovery ACTIVE or authorize votes/calls.

The live detector dry run on November 3 returned the NBC elections hub as 404
and reported robots/access policy disallowing the three office-page requests.
The web reader also could not access those pages. No data endpoint, race mapping,
2026 schema, or Decision Desk projection semantics was verified. `sources` remains
empty. The watcher continues its existing policy-respecting checks. Activation
still requires an authorized accessible JSON source and strict adapter/mapping
validation; webpage URLs must never be substituted as JSON sources.


## National Firecracker feeds activated — November 3, 2026

The owner supplied three public API routes under
`https://www.nbcnews.com/firecracker/api/v2/national-results/2026-elections/`:
`house-results`, `senate-results`, and `governor-results`. These endpoints were
accessible even though the webpage reader above was blocked. All three returned
HTTP 200 and identified `brand: news`, `electionType: general`, election season
2026, election date 2026-11-03, the matching office, and `updaterIntervalMs: 15000`.
The observed payloads had zero votes: production pre-election data, not simulated
results. All 435 House / 35 Senate / 36 Governor contests mapped successfully.

Integration extends `scripts/results/nbc-provider.mjs` with the observed
`nbc-national-v2` format. The registry contains explicit mapData-to-FEA mappings
and `pollSeconds: 15`; an explicit `NBC_POLL_SECONDS` operator override still
wins. Three national requests run concurrently. Conditional ETag/Last-Modified
requests, error backoff, last-good persistence, deltas, history and existing call
controls remain in use. No frontend NBC requests, forecast inputs, credentials
or new storage service were added.

Reference inspected: [romainhedouin/USA-elections-predictor, nbc_api.py](https://github.com/romainhedouin/USA-elections-predictor/blob/main/nbc_api.py).
Only endpoint/schema/geographic behavior was consulted. No prediction/model code
or party-level candidate aggregation was imported. Every candidate retains an
individual observed vote count. House at-large NBC district 01 maps to FEA AL.
The US party rollup and states without a configured race are excluded. Florida
and Ohio Senate's observed `P`-coded entries are accepted only with the exact
special-election route, configured exception, general national header and Nov. 3
date. Other primary payloads remain rejected.

Live NBC candidate lists take precedence over older local rosters, including
before votes arrive. Conservative alias reconciliation retains known identities;
ambiguous identities quarantine the race. Added/missing/party-different names
are recorded in admin diagnostics as `rosterMismatchCount` and up to 100
`rosterMismatches`. The first observed capture had 254 race-level differences
(including missing local write-ins and changed party labels); this is not an
assertion that every difference is a ballot error. Static reviewed provenance
is preserved. Recovery validates the persisted provider mapping and roster,
so a newer NBC candidate does not prevent restart. Manual calls are checked
against the current recovered race roster.

Totals must equal the sum of safe, nonnegative candidate vote integers. Malformed
races and missing office/race payloads are quarantined independently. Backward
timestamps, whole-race zeroing, drops below half an existing total of at least
100 votes, and established candidate counts resetting to zero are held for
review. Small downward corrections remain allowed. These guards are descriptive
safety checks, not predictions; a genuinely large correction requires operator
review. Last-good votes/calls survive outage and local controller restart.

National feeds do not provide county results here. Existing county geometry,
history and demographics remain available; previously stored county returns are
preserved rather than erased by a national update. Separate county/unit feed
activation is outside this national-feed change.

**Calls:** `projection.verified` remains false. `isWinner`, map winner styling,
and unverified callStatus codes never become an NBC Decision Desk projection.
Live votes work; NBC automatic projection publication still requires a verified
call contract. Existing FEA manual calls, overrides and pending-call controls are
preserved. An unverified national heartbeat cannot retract an existing call.

Validation: small zero-vote real-schema fixtures; wrong election/office/state,
malformed/duplicate candidates, total mismatch, invalid JSON, HTTP 500, timeout,
empty/partial payloads, 304 reuse, reset guards, small corrections, outage,
controller restart and recovery, zero-vote provider roster, manual calls and
unchanged-race delta tests. Actual isolated server HTTP checks returned CONNECTED
and 506 contests with 15-second refresh; real House/Senate/Governor detail APIs
and the public board were checked. An actual isolated server process restart with
NBC unavailable retained all 506 real zero-vote race rosters and a delay warning.
Small positive-vote recovery and call preservation were tested with isolated
synthetic fixtures, not manufactured public election results.
Live Render restart/redeploy/storage was not tested by this work.
