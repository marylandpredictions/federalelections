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
