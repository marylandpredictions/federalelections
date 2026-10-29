# Reversible NBC activation

**October 29 status: DISABLED / UNVERIFIED.** The production source list is empty. Synthetic contract fixtures prove adapter behavior, not the actual 2026 NBC contract.

## Public source investigation

| Source | Classification | Evidence / limit |
|---|---|---|
| `https://www.nbcnews.com/politics/2026-elections` | UNAVAILABLE | Current public research request inaccessible; no raw general-election contract obtained. No bypass attempted. |
| Existing proposed 2026 senate/house/governor page routes in `election-night-2026.md` | PREDICTED | Existing proposed routes; not confirmed JSON sources. |
| Existing primary/PPE/historical schema examples | REJECTED for production | Wrong election or test/historical environment. Retained only as synthetic adapter research; not live general-election evidence. |
| Real general-election JSON endpoint | UNAVAILABLE | None publicly verified through available authorized access. No invented endpoint was activated. |

These classifications concern what was verified, not a claim that NBC has no internal or licensed feed.

## Activation sequence

1. Preserve the current manifest and private runtime backup. Use staging/replay first. Observe a public/authorized JSON endpoint from the actual results page; record URL, retrieved date, election identity and authorization/redistribution limits.
2. Add exact `feaRaceId` ↔ `providerRaceId` mappings to a proposed manifest. Check all source configurations before requests. Current adapter deliberately accepts only confirmed HTTPS `www.nbcnews.com/firecracker/` feeds for `2026-general`, with redirects rejected. If NBC's real contract differs, implement and test that evidenced contract; never simply relax the gate.
3. Verify every candidate's source ID/name/party against the reviewed local roster, including minors and write-ins. Store reviewed aliases only for known identities. Missing/unexpected/ambiguous candidates must be quarantined, not merged by surname or party.
4. Verify raw vote totals, percent units, expected-vote versus precinct reporting, source timestamps, state/district and county/municipal IDs. A leader flag is not a projection. Record the exact NBC projection meaning and explicit withdrawal semantics before setting `projection.verified=true` and its supported `candidateFlag`. The current adapter requires an explicit boolean for every candidate when that contract is enabled; sparse flags need an evidenced withdrawal contract and targeted adapter tests, not a guessed false value.
5. Save a small permitted/sanitized real-schema fixture with provenance. The repository's current provider fixtures are explicitly synthetic. Test `parseNbcResults` strictly against the fixture and each mapping; include false/missing flags and retraction. Add ETag/Last-Modified fixtures if the real endpoint supports them. The transport already reuses validated bodies after 304, caps concurrency at eight and isolates failing states.
6. Run `npm run audit:results-candidates`, `npm run test:results`, `npm run test:results-restart`, then `npm run certify:results`. Inspect every quarantine/mismatch; the offline audit correctly reports actual-provider mismatches NOT_TESTED until real samples exist.
7. Start an isolated/staged server pointing at separate runtime storage, with GitHub backup credentials unset. Keep auto-accept paused while observing real data. Confirm public APIs/OBS exclude NBC_PENDING through grace, hold/release/manual/return-to-NBC and explicit correction flows.
8. Promote only the reviewed manifest. Restart the service to load it, run admin self-test, inspect health/audit/deltas/OBS, then resume automation deliberately. Monitor delayed sources, quarantines and persistence errors.
9. To reverse: pause automation, restore the previous manifest, restart and retain last-good runtime state. Reversing configuration must not erase published calls or votes. Restore a private runtime backup only with writers stopped and a reviewed rollback plan.
