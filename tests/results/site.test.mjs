import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
const repository = resolve(".");
test("Countdown has one fixed Eastern target, renders days/hours/minutes and expires without negative values", async () => {
  const code = await readFile("assets/countdown.js", "utf8");
  for (const [clock, expected] of [
    ["2026-10-27T05:00:00Z", "07"],
    ["2026-11-03T05:00:00Z", "00"],
    ["2026-11-04T12:00:00Z", "00"],
  ]) {
    const nodes = new Map();
    const get = (id) => {
      if (!nodes.has(id)) nodes.set(id, { textContent: "", hidden: false });
      return nodes.get(id);
    };
    vm.runInNewContext(code, {
      Date: { now: () => Date.parse(clock), parse: Date.parse },
      document: { getElementById: get },
      setInterval: () => {},
    });
    assert.equal(get("countdown-days").textContent, expected);
    if (clock >= "2026-11-03T05:00:00Z") {
      assert.equal(get("countdown-digits").hidden, true);
      assert.match(get("countdown-message").textContent, /Live results/);
    }
  }
});
test("All public primary navigation uses Home, Results, Videos, Articles; no ratings dropdown", async () => {
  const { readdir } = await import("node:fs/promises");
  let checked = 0;
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        [
          "node_modules",
          ".git",
          ".runtime",
          "work",
          "admin",
          "data",
          "assets",
          "scripts",
          "tests",
          "docs",
        ].includes(entry.name)
      )
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".html")) {
        const html = await readFile(path, "utf8");
        const nav = html.match(
          /<nav class="site-nav" aria-label="Primary navigation">([\s\S]*?)<\/nav>/,
        )?.[1];
        if (nav) {
          assert.deepEqual(
            [...nav.matchAll(/<a[^>]*>(.*?)<\/a>/g)].map((m) => m[1]),
            ["Home", "Results", "Videos", "Articles"],
            path,
          );
          checked++;
        }
      }
    }
  }
  await walk(repository);
  assert.ok(checked >= 20);
  const results = await readFile("assets/election-night.js", "utf8");
  assert.doesNotMatch(
    results,
    /house-forecast\.json|governor-forecast\.json|data\/forecast\.json|demProbability|forecastMargin/,
  );
});
test("HTTP integration: admin auth, calls, detail and summary refresh, no forecast reads, safe routes and save rejection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fea-server-test-"));
  await mkdir(join(root, "scripts/results"), { recursive: true });
  await mkdir(join(root, "data"));
  for (const file of [
    "server.mjs",
    "scripts/generate-live-results.mjs",
    "scripts/results/control.mjs",
    "scripts/results/storage.mjs",
    "scripts/results/roster-audit.mjs",
    "scripts/results/readiness.mjs",
    "scripts/results/audit-candidates.mjs",
    "scripts/results/candidate-roster.mjs",
    "scripts/results/change-feed.mjs",
    "scripts/results/history.mjs",
    "scripts/results/nbc-provider.mjs",
    "admin.html",
    "index.html",
    "results.html",
    "election-night.html",
  ])
    await cp(join(repository, file), join(root, file));
  const race = {
    id: "house-CO-4",
    type: "house",
    state: "CO",
    district: 4,
    electionName: "Colorado 4",
    electionDate: "2026-11-03",
    candidates: [
      { name: "Alex Example", party: "D", votes: 0 },
      { name: "Blair Example", party: "R", votes: 0 },
    ],
  };
  await writeFile(
    join(root, "data/election-night-races.json"),
    JSON.stringify({ races: [race] }),
  );
  await writeFile(
    join(root, "data/result-calls.json"),
    JSON.stringify({ races: {} }),
  );
  await writeFile(
    join(root, "data/results-provider.json"),
    JSON.stringify({ sources: [] }),
  );
  await writeFile(join(root, ".env"), "PRIVATE_TEST_SECRET=do-not-serve");
  const port = 18000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_SECRET: "local-test-only",
      GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GITHUB_REPOSITORY: "",
      RESULTS_MODE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("server startup timeout")),
      10000,
    );
    child.stdout.on("data", (b) => {
      if (String(b).includes("server running")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`server exited ${code}`));
    });
  });
  const base = `http://localhost:${port}`;
  const auth = {
    "x-admin-secret": "local-test-only",
    "Content-Type": "application/json",
  };
  for (const route of ["/", "/results", "/fea-results-lab-26", "/1234ab"])
    assert.equal((await fetch(base + route)).status, 200, route);
  for (const route of [
    "/.env",
    "/.runtime/results-state.json",
    "/data/result-calls.json",
    "/data/RESULT-CALLS.JSON",
    "/data/result-calls.json.",
    "/server.mjs",
    "/scripts/results/control.mjs",
    "/admin.html",
  ])
    assert.equal((await fetch(base + route)).status, 404, route);
  assert.equal((await fetch(base + "/api/admin/bootstrap")).status, 401);
  const bootstrap = await (
    await fetch(base + "/api/admin/bootstrap", { headers: auth })
  ).json();
  assert.equal(bootstrap.races[0].id, "house-CO-4");
  await assert.rejects(readFile(join(root,"data/live-results-races/house-CO-4.json")),{code:"ENOENT"});
  let response = await fetch(base + "/api/live-results");
  assert.equal(response.status, 200);
  const tag = response.headers.get("etag");
  const initialVersion=(await response.json()).version;
  const unchangedVersion=await fetch(base+"/api/results-version",{headers:{"if-none-match":tag}});
  assert.equal(unchangedVersion.status,304);
  assert.equal((await unchangedVersion.text()).length,0);
  assert.deepEqual((await (await fetch(base+"/api/live-results/changes?since="+initialVersion)).json()).races,[]);
  assert.equal((await (await fetch(base+"/api/live-results/changes?since=expired")).json()).reset,true);
  assert.equal(
    (
      await fetch(base + "/api/live-results", {
        headers: { "if-none-match": tag },
      })
    ).status,
    304,
  );
  response = await fetch(base + "/api/admin/calls", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      raceId: "house-CO-4",
      calls: [{ candidate: "Alex Example", status: "projected" }],
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).calls[0].source, "fea-manual");
  const summary = await (
    await fetch(base + "/api/live-results", {
      headers: { "if-none-match": tag },
    })
  ).json();
  assert.equal(summary.groups[0].races[0].calls[0].candidate, "Alex Example");
  const delta=await (await fetch(base+"/api/live-results/changes?since="+initialVersion)).json();
  assert.equal(delta.races.length,1);
  assert.equal(delta.races[0].calls[0].candidate,"Alex Example");
  assert.equal(delta.races[0].counties,undefined);
  assert.equal(delta.races[0].voteHistory,undefined);
  assert.equal(delta.races[0].providerCall,undefined);
  const detail = await (
    await fetch(base + "/api/live-results/race?id=house-CO-4")
  ).json();
  assert.equal(detail.status, "called");
  assert.equal(detail.candidates[0].isWinner, true);
  const disk = JSON.parse(
    await readFile(
      join(root, "data/live-results-races/house-CO-4.json"),
      "utf8",
    ),
  );
  assert.equal(disk.calls[0].source, "fea-manual");
  const control = await (
    await fetch(base + "/api/admin/results-control", { headers: auth })
  ).json();
  assert.equal(control.health.overrides, 1);
  assert.ok(control.audit.some((e) => e.action === "manual"));
  assert.equal(
    (
      await fetch(base + "/api/admin/calls", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          raceId: "house-CO-4",
          calls: [{ candidate: "Wrong race", status: "projected" }],
        }),
      })
    ).status,
    400,
  );
  const after = await (
    await fetch(base + "/api/live-results/race?id=house-CO-4")
  ).json();
  assert.equal(after.calls[0].candidate, "Alex Example");
  assert.ok(!(await fetch(base + "/.env")).ok);
});

test("Lab stages use actual page methods and never seed production or live-provider mode", async () => {
  const code =
    (await readFile("assets/election-night.js", "utf8")).split(
      "function initElectionNight()",
    )[0] + "\nglobalThis.Page = ElectionNightPage;";
  for (const phase of [
    "pre_election",
    "polls_open",
    "polls_closed_no_votes",
    "early_reporting",
    "reporting",
    "nbc_pending",
    "nbc_accepted",
    "manual_override",
    "provider_outage",
    "near_complete",
    "completed",
  ]) {
    const timers = [];
    const scope = {
      URLSearchParams,
      structuredClone,
      console,
      window: {
        location: { pathname: "/fea-results-lab-26" },
        setTimeout: (fn) => timers.push(fn),
      },
    };
    vm.createContext(scope);
    vm.runInContext(code, scope);
    const race = {
      id: "house-CO-4",
      type: "house",
      state: "CO",
      district: 4,
      candidates: [
        { name: "A", party: "D", votes: 0, percent: 0 },
        { name: "B", party: "R", votes: 0, percent: 0 },
      ],
    };
    const page = Object.create(scope.Page.prototype);
    Object.assign(page, {
      isLabPage: true,
      query: new URLSearchParams({ phase }),
      dataByMode: { house: [race], senate: [], governor: [] },
      renderSummary() {},
    });
    page.applyLabMode();
    if (
      ["pre_election", "polls_open", "polls_closed_no_votes"].includes(phase)
    ) {
      assert.equal(race.candidates[0].votes, 0);
      assert.equal(race.calls.length, 0);
    } else assert.ok(race.candidates.some((c) => c.votes > 0));
    if (phase === "nbc_pending") {
      assert.equal(race.callState, "NBC_PENDING");
      timers[0]();
      assert.equal(race.callState, "NBC_AUTO_ACCEPTED");
      assert.equal(race.calls[0].provider, "NBC");
    }
    if (phase === "manual_override")
      assert.equal(race.calls[0].source, "fea-manual");
    if (phase === "provider_outage") assert.equal(race.feedError, true);
    const clean = structuredClone({
      ...race,
      candidates: [{ name: "A", party: "D", votes: 0, percent: 0 }],
    });
    page.dataByMode.house = [clean];
    page.isLabPage = false;
    page.applyLabMode();
    assert.equal(clean.candidates[0].votes, 0);
    page.isLabPage = true;
    page.query = new URLSearchParams("live=true");
    page.applyLabMode();
    assert.equal(clean.candidates[0].votes, 0);
  }
});

test("OBS consumes one shared call, preserves NBC/FEA provenance and survives date rollover", async () => {
  let code = await readFile("assets/call-overlay.js", "utf8");
  code = code.replace(
    /  update\(\);\s*setInterval\(update, 5000\);/,
    "  globalThis.overlay = {collectCalls,renderCallCard};",
  );
  const scope = {
    URLSearchParams,
    document: { getElementById: () => ({}) },
    window: { location: { search: "" } },
    console,
  };
  vm.createContext(scope);
  vm.runInContext(code, scope);
  for (const provider of ["NBC", "FEA"]) {
    const call = {
      candidate: "A",
      status: "projected",
      calledAt: "2026-11-04T06:00:00Z",
      provider,
      source: provider === "NBC" ? "nbc-auto" : "fea-manual",
    };
    const race = {
      id: "house-CO-4",
      type: "house",
      state: "CO",
      district: 4,
      electionName: "Colorado 4",
      electionScope: "General",
      electionDate: "2026-11-03",
      calls: [call],
      candidates: [
        { name: "A", party: "D", partyCode: "D", votes: 100 },
        { name: "B", party: "R", votes: 80 },
      ],
    };
    const entries = scope.overlay.collectCalls(
      { races: { [race.id]: { calls: [call] } } },
      [race],
    );
    assert.equal(entries.length, 1);
    const html = scope.overlay.renderCallCard(entries[0]);
    assert.match(
      html,
      provider === "NBC"
        ? /NBC projects/
        : /Race called by Federal Elections Analysis/,
    );
    const uncalled = {
      ...race,
      calls: [],
      candidates: [{ ...race.candidates[0], apiWinner: true }],
    };
    assert.equal(
      scope.overlay.collectCalls({ races: {} }, [uncalled]).length,
      0,
    );
  }
});
