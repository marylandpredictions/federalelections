import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ResultsControl } from "../../scripts/results/control.mjs";
import {
  parseNbcResults,
  NbcProvider,
} from "../../scripts/results/nbc-provider.mjs";
import { CountyHistory } from "../../scripts/results/history.mjs";
import {
  ResultsChangeFeed,
  publishedCallBackup,
} from "../../scripts/results/change-feed.mjs";
import { gzipSync } from "node:zlib";
import { auditCandidateFiles } from "../../scripts/results/audit-candidates.mjs";
import { spawnSync } from "node:child_process";
const repo = process.cwd();
test("Public backup retains published call provenance and excludes pending decisions, overrides and audit", () => {
  const backup = publishedCallBackup({
    automation: { paused: true },
    races: {
      r: {
        manualOverride: true,
        providerCall: { candidate: "Private pending name" },
        publishAt: "private",
        calls: [
          {
            candidate: "Public name",
            provider: "NBC",
            source: "nbc-auto",
            status: "projected",
            internal: "private",
          },
        ],
      },
    },
  });
  assert.equal(backup.races.r.calls[0].provider, "NBC");
  assert.ok(!JSON.stringify(backup).includes("Private pending name"));
  assert.ok(!JSON.stringify(backup).includes("manualOverride"));
  assert.ok(!JSON.stringify(backup).includes("internal"));
});
test("Deployment candidate CLI blocks corrupted names and missing summary priorities unless an explicit override is supplied", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fea-candidate-gate-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  await mkdir(join(root, "data/results"), { recursive: true });
  await mkdir(join(root, "data/live-results-races"));
  for (const file of [
    "data/election-night-races.json",
    "data/live-results.json",
    "data/results/reviewed-ballots-2026.json",
    "data/results/louisiana-ballot-2026.json",
    "data/results/candidate-summary-priorities.json",
  ])
    await cp(join(repo, file), join(root, file));
  const catalogue = JSON.parse(
    await readFile(join(root, "data/election-night-races.json"), "utf8"),
  );
  await Promise.all(
    catalogue.races.map((r) =>
      cp(
        join(repo, "data/live-results-races", r.id + ".json"),
        join(root, "data/live-results-races", r.id + ".json"),
      ),
    ),
  );
  catalogue.races[0].candidates[0].name = "G.O.P.";
  catalogue.races
    .find((r) => r.id === "senate-SD")
    .candidates.find((c) => c.name === "Brian Bengs").summaryVisible = false;
  await writeFile(
    join(root, "data/election-night-races.json"),
    JSON.stringify(catalogue),
  );
  const report = auditCandidateFiles(root);
  assert.equal(report.passed, false);
  assert.ok(report.placeholders > 0);
  assert.ok(
    report.issues.some((i) => i.message.includes("Prominent candidate")),
  );
  const blocked = spawnSync(
    process.execPath,
    [join(repo, "scripts/results/audit-candidates.mjs")],
    {
      cwd: root,
      env: { ...process.env, ALLOW_UNREVIEWED_RESULTS_ROSTER: "" },
      encoding: "utf8",
    },
  );
  assert.equal(blocked.status, 1);
  const overridden = spawnSync(
    process.execPath,
    [join(repo, "scripts/results/audit-candidates.mjs")],
    {
      cwd: root,
      env: { ...process.env, ALLOW_UNREVIEWED_RESULTS_ROSTER: "1" },
      encoding: "utf8",
    },
  );
  assert.equal(overridden.status, 0);
  assert.match(overridden.stderr, /Explicit candidate deployment override/);
});
const race = (i) => ({
  id: "house-CO-" + i,
  state: "CO",
  district: i,
  type: "house",
  electionName: "Colorado " + i,
  candidates: [
    { name: "Alex Example", party: "D", votes: 0 },
    { name: "Blair Example", party: "R", votes: 0 },
  ],
});
async function fixture(t, n = 2) {
  const root = await mkdtemp(join(tmpdir(), "fea-resilience-"));
  t.after(async () => {
    assert.ok(
      resolve(root).startsWith(resolve(tmpdir()) + "\\fea-resilience-") ||
        resolve(root).startsWith(resolve(tmpdir()) + "/fea-resilience-"),
    );
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  await mkdir(join(root, "data"));
  const catalogue = Array.from({ length: n }, (_, i) => race(i + 1));
  await writeFile(
    join(root, "data/election-night-races.json"),
    JSON.stringify({ races: catalogue }),
  );
  await writeFile(
    join(root, "data/results-provider.json"),
    JSON.stringify({ sources: [] }),
  );
  await writeFile(
    join(root, "data/result-calls.json"),
    JSON.stringify({ races: {} }),
  );
  return { root, catalogue };
}
const result = (r) => ({
  ...r,
  lastUpdated: new Date().toISOString(),
  provider: "NBC",
  providerRaceId: r.id,
  candidates: r.candidates.map((c, i) => ({ ...c, votes: i ? 80 : 100 })),
  counties: [
    {
      name: "Adams",
      type: "County",
      fips: "08001",
      candidates: [{ name: "Alex Example", party: "D", votes: 20 }],
    },
  ],
  providerCall: null,
});
test("Malformed, missing and regressed normalized races are quarantined while healthy races advance", async (t) => {
  const { root, catalogue } = await fixture(t);
  let rows = catalogue.map(result),
    clock = Date.now();
  const c = await new ResultsControl({
    root,
    now: () => clock,
    provider: { fetchResults: async () => rows },
  }).init();
  await c.poll();
  const first = c.results().groups[0].races;
  rows = [
    { ...rows[0], candidates: [{ name: "TBD", votes: -1 }] },
    {
      ...rows[1],
      candidates: rows[1].candidates.map((x) => ({
        ...x,
        votes: x.votes + 50,
      })),
    },
  ];
  clock += 60000;
  await c.poll();
  assert.equal(c.results().groups[0].races[0].candidates[0].votes, 100);
  assert.equal(c.results().groups[0].races[1].candidates[0].votes, 150);
  assert.equal(c.runtime.health.quarantined.length, 1);
  rows = [
    {
      ...rows[1],
      lastUpdated: "2020-01-01T00:00:00Z",
      candidates: [{ name: "Alex Example", votes: 1 }],
    },
  ];
  clock += 60000;
  await c.poll();
  assert.equal(c.results().groups[0].races[1].candidates[0].votes, 150);
  assert.equal(
    c.results().groups[0].races[0].candidates[0].votes,
    first[0].candidates[0].votes,
  );
  rows = [{ ...result(catalogue[0]), candidates: catalogue[0].candidates }];
  clock += 900000;
  await c.poll();
  assert.equal(c.results().groups[0].races[0].candidates[0].votes, 100);
  assert.match(c.runtime.health.quarantined[0].reason, /zero-vote reset/);
});
test("NBC adapter isolates one malformed mapped race but strict verification remains available", () => {
  const catalogue = [race(1), race(2)],
    source = {
      races: catalogue.map((r, i) => ({
        feaRaceId: r.id,
        providerRaceId: String(i + 1),
      })),
    };
  const data = {
    stateAbbr: "CO",
    electionDate: "2026-11-03",
    races: catalogue.map((r, i) => ({
      summary: {
        raceId: i + 1,
        officeName: "US House",
        district: i + 1,
        candidates: [
          { name: i ? "Alex Example" : "TBD", party: "DEM", votes: 100 },
        ],
      },
    })),
  };
  assert.throws(() => parseNbcResults(data, source, catalogue));
  const issues = [],
    rows = parseNbcResults(data, source, catalogue, {
      onInvalid: (i) => issues.push(i),
    });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "house-CO-2");
  assert.equal(issues[0].race, "house-CO-1");
});
test("Restoring a published NBC backup preserves NBC attribution and holds automation for review", async (t) => {
  const { root, catalogue } = await fixture(t, 1);
  await writeFile(
    join(root, "data/result-calls.json"),
    JSON.stringify({
      races: {
        [catalogue[0].id]: {
          calls: [
            {
              candidate: "Alex Example",
              source: "nbc-auto",
              status: "projected",
            },
          ],
        },
      },
    }),
  );
  const c = await new ResultsControl({ root }).init();
  assert.equal(c.calls.races[catalogue[0].id].manualOverride, false);
  assert.equal(c.calls.races[catalogue[0].id].callState, "NBC_HELD");
  const r = c.results().groups[0].races[0];
  assert.equal(r.calls[0].provider, "NBC");
  assert.equal(r.candidates[0].callLabel, "NBC projects");
});
test("Timeout, HTTP 500, invalid JSON, schema mismatch and empty responses retain votes and manual calls until recovery", async (t) => {
  const { root, catalogue } = await fixture(t, 1);
  let mode = "good",
    clock = Date.now();
  const provider = {
    fetchResults: async () => {
      if (mode !== "good") throw Error(mode);
      return catalogue.map(result);
    },
  };
  const c = await new ResultsControl({
    root,
    provider,
    now: () => clock,
    pollSeconds: 15,
  }).init();
  await c.poll();
  await c.action({
    action: "manual",
    raceId: catalogue[0].id,
    calls: [{ candidate: "Blair Example", status: "winner" }],
  });
  for (const failure of [
    "connection timeout",
    "HTTP 500",
    "invalid JSON",
    "schema mismatch",
    "empty payload",
  ]) {
    mode = failure;
    clock += 900000;
    await c.poll();
    const r = c.results().groups[0].races[0];
    assert.equal(r.candidates[0].votes, 100);
    assert.equal(r.calls[0].candidate, "Blair Example");
    assert.ok(c.health().stale);
  }
  mode = "good";
  clock += 900000;
  await c.poll();
  assert.equal(c.health().connection, "connected");
  assert.equal(
    c.results().groups[0].races[0].calls[0].candidate,
    "Blair Example",
  );
});
test("Actual NBC transport rejects timeout, invalid JSON, HTTP error, empty and schema mismatch", async () => {
  const source = {
    status: "CONFIRMED",
    election: "2026-general",
    url: "https://www.nbcnews.com/firecracker/test",
    races: [{ feaRaceId: "house-CO-1", providerRaceId: "1" }],
  };
  for (const fetchImpl of [
    async () => {
      throw Error("timeout");
    },
    async () => new Response("error", { status: 500 }),
    async () => new Response("invalid JSON"),
    async () => new Response("{}"),
    async () => new Response('{"races":[]}'),
  ]) {
    await assert.rejects(
      new NbcProvider({ sources: [source], fetchImpl }).fetchResults([race(1)]),
    );
  }
});
test("Fifteen explicit calls and retraction preserve provenance, audit and delta versions", async (t) => {
  const { root, catalogue } = await fixture(t, 15),
    clock = Date.now();
  let rows = catalogue.map((r) => ({
    ...result(r),
    providerCall: { candidate: "Alex Example", provider: "NBC" },
  }));
  const c = await new ResultsControl({
    root,
    provider: { fetchResults: async () => rows },
    now: () => clock,
    graceSeconds: 0,
  }).init();
  const feed = new ResultsChangeFeed();
  feed.update(c.results());
  const baseline = feed.metadata().version;
  await c.poll();
  feed.update(c.results());
  const delta = feed.changes(baseline);
  assert.equal(delta.races.length, 15);
  assert.ok(delta.races.every((r) => r.calls[0]?.provider === "NBC"));
  await c.action({ action: "manual", raceId: catalogue[0].id, calls: [] });
  const r = c.results().groups[0].races[0];
  assert.equal(r.calls.length, 0);
  assert.ok(r.candidates.every((c) => !c.winner && !c.isWinner));
  assert.ok(
    c.runtime.audit.some((a) => a.race === r.id && a.actor !== "system"),
  );
  const full = JSON.stringify(feed.full(c.results())),
    one = JSON.stringify({ races: [delta.races[0]] });
  console.log(
    JSON.stringify({
      measurement: "synthetic-wire",
      fullGzip: gzipSync(full).length,
      fifteenRaceDeltaGzip: gzipSync(JSON.stringify(delta)).length,
      singleRaceDeltaGzip: gzipSync(one).length,
    }),
  );
});
async function start(root, storage) {
  const port = 20000 + Math.floor(Math.random() * 20000),
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        RESULTS_STORAGE_DIR: storage,
        ADMIN_SECRET: "restart-test",
        GITHUB_TOKEN: "",
        GH_TOKEN: "",
        GITHUB_REPOSITORY: "",
        RESULTS_MODE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  let errors = "";
  child.stderr.on("data", (b) => (errors += b));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server start timeout " + errors)),
      10000,
    );
    child.stdout.on("data", (b) => {
      if (String(b).includes("server running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(Error("Server exited " + code + " " + errors));
    });
  });
  return {
    url: "http://127.0.0.1:" + port,
    child,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, "exit");
        child.kill();
        await exit;
      }
    },
  };
}
test("Real server process restart and fresh-checkout redeploy simulation recover calls, overrides, audit, votes, race and county history from a separate storage directory", async (t) => {
  const { root, catalogue } = await fixture(t, 1),
    storage = join(root, "persistent-disk");
  const control = await new ResultsControl({
    root,
    storageDir: storage,
    provider: { fetchResults: async () => catalogue.map(result) },
  }).init();
  await control.poll();
  await control.action({
    action: "manual",
    raceId: catalogue[0].id,
    calls: [{ candidate: "Blair Example", status: "winner" }],
  });
  await mkdir(join(storage, "race-details"), { recursive: true });
  await writeFile(
    join(storage, "race-details", catalogue[0].id + ".json"),
    JSON.stringify({
      ...result(catalogue[0]),
      voteHistory: [
        {
          at: new Date().toISOString(),
          candidates: result(catalogue[0]).candidates,
        },
      ],
    }),
  );
  await mkdir(join(storage, "county-history", catalogue[0].id), {
    recursive: true,
  });
  await writeFile(
    join(storage, "county-history", catalogue[0].id, "08001.ndjson"),
    JSON.stringify({
      fips: "08001",
      at: new Date().toISOString(),
      candidates: [{ name: "Alex Example", party: "D", votes: 20 }],
    }) + "\n",
  );
  for (const name of ["checkout-a", "checkout-b"]) {
    const checkout = join(root, name);
    await mkdir(join(checkout, "data"), { recursive: true });
    await mkdir(join(checkout, "scripts"), { recursive: true });
    for (const file of [
      "server.mjs",
      "scripts/generate-live-results.mjs",
      "scripts/results",
    ])
      await cp(join(repo, file), join(checkout, file), { recursive: true });
    for (const file of [
      "election-night-races.json",
      "results-provider.json",
      "result-calls.json",
    ])
      await cp(join(root, "data", file), join(checkout, "data", file));
    for (
      let restart = 0;
      restart < (name === "checkout-a" ? 2 : 1);
      restart++
    ) {
      const server = await start(checkout, storage);
      t.after(() => server.stop());
      try {
        const data = await (
            await fetch(server.url + "/api/live-results")
          ).json(),
          r = data.groups[0].races[0];
        assert.equal(r.candidates[0].votes, 100);
        assert.equal(r.calls[0].candidate, "Blair Example");
        const admin = await (
          await fetch(server.url + "/api/admin/results-control", {
            headers: { "x-admin-secret": "restart-test" },
          })
        ).json();
        assert.equal(
          (await fetch(server.url + "/data/result-calls.json")).status,
          404,
        );
        const beforeSelfTest = await readFile(
          join(storage, "result-calls.json"),
          "utf8",
        );
        await fetch(server.url + "/api/admin/results-self-test", {
          headers: { "x-admin-secret": "restart-test" },
        });
        assert.equal(
          await readFile(join(storage, "result-calls.json"), "utf8"),
          beforeSelfTest,
        );
        assert.ok(admin.states[r.id].manualOverride);
        assert.ok(admin.audit.length);
        const detail = await (
          await fetch(server.url + "/api/live-results/race?id=" + r.id)
        ).json();
        assert.ok(detail.voteHistory.length);
        const county = await (
          await fetch(
            server.url + "/api/live-results/race?id=" + r.id + "&county=08001",
          )
        ).json();
        assert.ok(county.voteHistory.some((p) => p.candidates[0].votes === 20));
        const heartbeat = await fetch(server.url + "/api/results-version", {
          headers: { "If-None-Match": '"' + data.version + '"' },
        });
        assert.equal(heartbeat.status, 304);
        assert.equal((await heartbeat.arrayBuffer()).byteLength, 0);
      } finally {
        await server.stop();
      }
    }
  }
});
test("A quarantined pending race cannot auto-publish while healthy races clear grace and later recovery resumes it", async (t) => {
  const { root, catalogue } = await fixture(t, 2);
  let clock = Date.now(),
    rows = catalogue.map((r) => ({
      ...result(r),
      providerCall: { candidate: "Alex Example", provider: "NBC" },
    }));
  const c = await new ResultsControl({
    root,
    provider: { fetchResults: async () => rows },
    now: () => clock,
    graceSeconds: 30,
    pollSeconds: 15,
  }).init();
  await c.poll();
  rows = [{ ...rows[0], candidates: [{ name: "TBD", votes: -1 }] }, rows[1]];
  clock += 60000;
  await c.poll();
  assert.equal(c.calls.races[catalogue[0].id].calls.length, 0);
  assert.equal(c.calls.races[catalogue[1].id].callState, "NBC_AUTO_ACCEPTED");
  rows = catalogue.map((r) => ({
    ...result(r),
    providerCall: { candidate: "Alex Example", provider: "NBC" },
  }));
  clock += 60000;
  await c.poll();
  assert.equal(c.calls.races[catalogue[0].id].callState, "NBC_AUTO_ACCEPTED");
});
