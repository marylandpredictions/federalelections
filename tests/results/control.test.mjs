import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultsControl } from "../../scripts/results/control.mjs";
import {
  NbcProvider,
  parseNbcResults,
} from "../../scripts/results/nbc-provider.mjs";
const catalogue = [
  {
    id: "house-CO-4",
    type: "house",
    state: "CO",
    district: 4,
    electionName: "Colorado 4",
    candidates: [
      { name: "Alex Example", party: "D", votes: 0 },
      { name: "Blair Example", party: "R", votes: 0 },
    ],
  },
];
// Synthetic schema fixture derived from the repository's existing primary adapter.
// NOT a downloaded historical NBC payload, and NOT proof of general-election call semantics.
const source = {
  url: "https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/colorado-house-results",
  status: "CONFIRMED",
  election: "2026-general",
  races: [{ feaRaceId: "house-CO-4", providerRaceId: "123" }],
  projection: { verified: true, candidateFlag: "isWinner" },
};
function fixture({
  call = true,
  votes = 100,
  time = "2026-11-04T01:00:00Z",
} = {}) {
  return {
    stateAbbr: "CO",
    electionDate: "2026-11-03",
    lastUpdated: time,
    races: [
      {
        summary: {
          raceId: 123,
          officeName: "US House",
          district: 4,
          percentIn: 62,
          precinctsReportingPercent: 40,
          candidates: [
            {
              candidateId: 1,
              name: "Alex Example",
              party: "DEM",
              votes,
              percentVote: 55,
              isWinner: call,
            },
            {
              candidateId: 2,
              name: "Blair Example",
              party: "GOP",
              votes: 80,
              percentVote: 45,
            },
          ],
        },
        areas: [
          {
            name: "Adams",
            fips: "08001",
            percentIn: 30,
            candidates: [
              { name: "Alex Example", party: "DEM", votes: 20, percentVote: 60 },
            ],
          },
        ],
      },
    ],
  };
}
async function setup(t, { graceSeconds = 30 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "fea-results-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await writeFile(
    join(root, "data/election-night-races.json"),
    JSON.stringify({ races: catalogue }),
  );
  await writeFile(
    join(root, "data/result-calls.json"),
    JSON.stringify({ races: {} }),
  );
  let clock = Date.parse("2026-11-04T01:00:00Z");
  let data = fixture();
  let fail = false;
  const provider = {
    async fetchResults() {
      if (fail) throw Error("NBC connection failed");
      return parseNbcResults(data, source, catalogue);
    },
  };
  const control = await new ResultsControl({
    root,
    provider,
    graceSeconds,
    now: () => clock,
    pollSeconds: 15,
  }).init();
  return {
    root,
    control,
    provider,
    advance: (ms) => {
      clock += ms;
    },
    setData: (d) => {
      data = d;
    },
    outage: () => {
      fail = true;
    },
    now: () => clock,
  };
}
test("NBC normalizes vote, expected vote and precinct percentages separately; retains IDs and FIPS", () => {
  const [r] = parseNbcResults(fixture(), source, catalogue);
  assert.equal(r.id, "house-CO-4");
  assert.equal(r.providerRaceId, "123");
  assert.equal(r.expectedVotePercent, 62);
  assert.equal(r.reportingPercent, 40);
  assert.equal(r.candidates[0].percent, 55);
  assert.equal(r.counties[0].fips, "08001");
  assert.equal(r.providerCall.candidate, "Alex Example");
  assert.equal(r.candidates[0].isWinner, false);
});
test("No call inferred from lead, vote share, percent in or unverified winner flags", () => {
  const unverified = {
    ...source,
    projection: { verified: false, candidateFlag: "isWinner" },
  };
  assert.equal(
    parseNbcResults(fixture(), unverified, catalogue)[0].providerCall,
    null,
  );
  assert.equal(
    parseNbcResults(fixture({ call: false }), source, catalogue)[0]
      .providerCall,
    null,
  );
});
test("Reject primary data, malformed races, negative votes, ambiguous projection, unknown mapping", () => {
  for (const mutate of [
    (d) => (d.electionDate = "2026-03-03"),
    (d) => (d.races = []),
    (d) => (d.races[0].summary.candidates[0].votes = -1),
    (d) => (d.races[0].summary.candidates[1].isWinner = true),
    (d) => (d.races[0].summary.raceId = 456),
  ]) {
    const d = fixture();
    mutate(d);
    assert.throws(() => parseNbcResults(d, source, catalogue));
  }
});
test("No configured source fails closed; unconfirmed/PPE source cannot be production", async () => {
  await assert.rejects(
    new NbcProvider().fetchResults(catalogue),
    /No verified/,
  );
  for (const invalid of [
    { ...source, status: "PREDICTED" },
    { ...source, url: "https://ppe.nbcnews.com/firecracker/test" },
    { ...source, election: "primary" },
  ])
    await assert.rejects(
      new NbcProvider({ sources: [invalid] }).fetchResults(catalogue),
      /verified public/,
    );
});
test("Provider timeout/HTTP failure propagated without inventing data", async () => {
  const provider = new NbcProvider({
    sources: [source],
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(provider.fetchResults(catalogue), /503/);
});
test("NBC pending grace, exact deadline acceptance, provenance, audit, repeated refresh deduplicates", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  let s = x.control.calls.races["house-CO-4"];
  assert.equal(s.callState, "NBC_PENDING");
  assert.equal(x.control.results().groups[0].races[0].calls.length, 0);
  x.advance(29000);
  await x.control.tick();
  assert.equal(s.callState, "NBC_PENDING");
  x.advance(1000);
  await x.control.tick();
  assert.equal(s.callState, "NBC_AUTO_ACCEPTED");
  assert.equal(s.calls[0].source, "nbc-auto");
  await x.control.poll();
  assert.equal(
    x.control.runtime.audit.filter((e) => e.action === "auto-accepted").length,
    1,
  );
  assert.equal(s.calls.length, 1);
  assert.equal(
    x.control.results().groups[0].races[0].candidates[0].isWinner,
    true,
  );
});
test("Publish now, hold and ignore survive refresh/restart", async (t) => {
  for (const action of ["hold", "ignore", "publish"]) {
    const x = await setup(t);
    await x.control.poll();
    await x.control.action({ action, raceId: "house-CO-4" });
    x.advance(60000);
    await x.control.poll();
    await x.control.tick();
    let s = x.control.calls.races["house-CO-4"];
    assert.equal(
      s.callState,
      { hold: "NBC_HELD", ignore: "NBC_IGNORED", publish: "NBC_AUTO_ACCEPTED" }[
        action
      ],
    );
    const restarted = await new ResultsControl({
      root: x.root,
      provider: x.provider,
      now: x.now,
    }).init();
    assert.equal(restarted.calls.races["house-CO-4"].callState, s.callState);
    if (action === "publish") assert.equal(s.calls[0].source, "nbc-accepted");
  }
});
test("Manual override (including uncall) stays authoritative until explicit return to auto", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  await x.control.action({
    action: "manual",
    raceId: "house-CO-4",
    calls: [{ candidate: "Blair Example", status: "winner" }],
  });
  x.advance(60000);
  await x.control.poll();
  assert.equal(
    x.control.calls.races["house-CO-4"].calls[0].candidate,
    "Blair Example",
  );
  assert.equal(
    x.control.calls.races["house-CO-4"].callState,
    "MANUAL_OVERRIDE",
  );
  await assert.rejects(
    x.control.action({ action: "publish", raceId: "house-CO-4" }),
    /Return/,
  );
  await x.control.action({ action: "manual", raceId: "house-CO-4", calls: [] });
  assert.equal(x.control.calls.races["house-CO-4"].manualOverride, true);
  await x.control.action({ action: "auto", raceId: "house-CO-4" });
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
  assert.equal(x.control.calls.races["house-CO-4"].calls.length, 0);
  x.advance(30000);
  await x.control.tick();
  assert.equal(
    x.control.calls.races["house-CO-4"].calls[0].candidate,
    "Alex Example",
  );
});
test("Manual call works without any provider; candidate mismatch rejected", async (t) => {
  const x = await setup(t);
  await assert.rejects(
    x.control.action({
      action: "manual",
      raceId: "house-CO-4",
      calls: [{ candidate: "Unknown", status: "projected" }],
    }),
    /valid candidates/,
  );
  await x.control.action({
    action: "manual",
    raceId: "house-CO-4",
    calls: [{ candidate: "Alex Example", status: "projected" }],
  });
  assert.equal(
    x.control.calls.races["house-CO-4"].callState,
    "MANUAL_FEA_CALL",
  );
  assert.equal(
    x.control.results().groups[0].races[0].calls[0].source,
    "fea-manual",
  );
});
test("Pause, resume, hold-all and return-all preserve overridden races", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  await x.control.action({ action: "pause" });
  x.advance(30000);
  await x.control.tick();
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
  await x.control.action({ action: "resume" });
  await x.control.tick();
  assert.equal(
    x.control.calls.races["house-CO-4"].callState,
    "NBC_AUTO_ACCEPTED",
  );
  await x.control.action({ action: "auto", raceId: "house-CO-4" });
  await x.control.action({ action: "hold-all" });
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_HELD");
  await x.control.action({ action: "return-all" });
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
  await x.control.action({ action: "manual", raceId: "house-CO-4", calls: [] });
  await x.control.action({ action: "return-all" });
  assert.equal(x.control.calls.races["house-CO-4"].manualOverride, true);
});
test("Outage retains last valid votes/calls and suspends pending auto publication; backoff", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  x.outage();
  x.advance(30000);
  await x.control.poll();
  await x.control.tick();
  assert.equal(x.control.health().status, "CONNECTION FAILED");
  assert.equal(x.control.health().stale, true);
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
  assert.equal(x.control.results().groups[0].races[0].candidates[0].votes, 100);
  assert.ok(Date.parse(x.control.health().nextAttemptAt) > x.now());
  await x.control.action({ action: "publish", raceId: "house-CO-4" });
  assert.equal(x.control.calls.races["house-CO-4"].calls.length, 1);
  x.advance(60000);
  await x.control.poll();
  assert.equal(x.control.calls.races["house-CO-4"].calls.length, 1);
});
test("Successful unchanged data distinguished from stale data; no fabricated upstream timestamp", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  const changed = x.control.health().lastChangedResult;
  x.advance(15000);
  await x.control.poll();
  assert.equal(x.control.health().lastChangedResult, changed);
  assert.equal(x.control.health().status, "CONNECTED");
  x.advance(181000);
  await x.control.poll();
  assert.equal(x.control.health().status, "DATA STALE");
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
});
test("Conflicting upstream projection held and never silently replaces a published call", async (t) => {
  const x = await setup(t, { graceSeconds: 0 });
  await x.control.poll();
  const d = fixture();
  d.races[0].summary.candidates[0].isWinner = false;
  d.races[0].summary.candidates[1].isWinner = true;
  x.setData(d);
  x.advance(15000);
  await x.control.poll();
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_HELD");
  assert.equal(
    x.control.calls.races["house-CO-4"].calls[0].candidate,
    "Alex Example",
  );
});
test("Withdrawn pending projection held for human review, not published", async (t) => {
  const x = await setup(t);
  await x.control.poll();
  x.setData(fixture({ call: false }));
  x.advance(15000);
  await x.control.poll();
  x.advance(15000);
  await x.control.tick();
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_HELD");
  assert.equal(x.control.calls.races["house-CO-4"].calls.length, 0);
});

test("Failed save preserves memory and existing call decision; retry remains possible", async (t) => {
  const { rename } = await import("node:fs/promises");
  const x = await setup(t);
  await x.control.poll();
  const path = join(x.root, "data/result-calls.json");
  await rename(path, path + ".saved");
  await mkdir(path);
  await assert.rejects(
    x.control.action({
      action: "manual",
      raceId: "house-CO-4",
      calls: [{ candidate: "Blair Example", status: "winner" }],
    }),
  );
  assert.equal(x.control.calls.races["house-CO-4"].callState, "NBC_PENDING");
  assert.equal(x.control.calls.races["house-CO-4"].calls.length, 0);
  assert.ok(x.control.health().persistenceError);
  assert.equal(x.control.health().stale, true);
  assert.equal(x.control.health().automation, "DEGRADED");
  await rm(path, { recursive: true });
  await rename(path + ".saved", path);
  await x.control.action({
    action: "manual",
    raceId: "house-CO-4",
    calls: [{ candidate: "Blair Example", status: "winner" }],
  });
  assert.equal(
    x.control.calls.races["house-CO-4"].calls[0].candidate,
    "Blair Example",
  );
  assert.equal(x.control.health().persistenceError, null);
});

test("Public results cannot observe an uncommitted call while a save is in progress", async (t) => {
  const x = await setup(t);
  let release, started;
  const gate = new Promise((resolve) => (release = resolve));
  const saving = new Promise((resolve) => (started = resolve));
  const original = x.control.save.bind(x.control);
  x.control.save = async () => {
    started();
    await gate;
    return original();
  };
  const action = x.control.action({
    action: "manual",
    raceId: "house-CO-4",
    calls: [{ candidate: "Blair Example", status: "projected" }],
  });
  await saving;
  assert.equal(x.control.results().groups[0].races[0].calls.length, 0);
  assert.equal(x.control.adminSnapshot().health.overrides, 0);
  release();
  await action;
  assert.equal(
    x.control.results().groups[0].races[0].calls[0].candidate,
    "Blair Example",
  );
});

test('A stale zero-vote runtime roster cannot reintroduce filler or hide catalogue summary priorities', async t => {
 const x=await setup(t);
 x.control.catalogue[0].candidates[0].summaryVisible=true;
 x.control.visible.runtime.races['house-CO-4']={candidates:[{name:'independent longshot, caucus not credited',party:'I',votes:0}]};
 const race=x.control.results().groups[0].races[0];
 assert.deepEqual(race.candidates.map(c=>c.name),['Alex Example','Blair Example']);
 assert.equal(race.candidates[0].summaryVisible,true);
 assert.equal(race.candidates[1].summaryVisible,undefined);
});
