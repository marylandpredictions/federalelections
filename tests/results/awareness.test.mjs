import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { auditRosters } from "../../scripts/results/roster-audit.mjs";
import { genericName } from "../../scripts/results/candidate-roster.mjs";
import vm from "node:vm";
const require = createRequire(import.meta.url),
  N = require("../../assets/night-awareness.js"),
  desk = require("../../assets/results-desk.js");
const schedule = JSON.parse(readFileSync("data/results/poll-closes.json"));
const row = (id = "senate-OH", votes = 0) => ({
  id,
  type: "senate",
  state: "OH",
  candidates: [
    { name: "Alex Example", party: "D", votes },
    { name: "Blair Example", party: "R", votes: Math.round(votes * 0.8) },
  ],
  calls: [],
});
test("Presentation states use actual votes, reporting, calls, schedule and wave; never manufacture election data", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row("race-" + i));
  const initial = structuredClone(rows),
    at = Date.parse("2026-11-04T05:00:00Z");
  assert.equal(
    N.presentation(rows, schedule, at, { desk }).state,
    "PRE_ELECTION",
  );
  assert.equal(
    N.presentation(rows, schedule, at, { desk, waveAt: at }).state,
    "POLL_CLOSE_WAVE",
  );
  rows[0] = row("race-0", 100);
  assert.equal(
    N.presentation(rows, schedule, at, { desk }).state,
    "EARLY_RESULTS",
  );
  for (const r of rows) r.candidates[0].votes = 100;
  assert.equal(
    N.presentation(rows, schedule, at, { desk, recent: 5 }).state,
    "ACTIVE_COUNT",
  );
  for (const r of rows.slice(0, 15)) r.calls = [{ candidate: "Alex Example" }];
  assert.equal(
    N.presentation(rows, schedule, at, { desk }).state,
    "LATE_NIGHT",
  );
  for (const r of rows) r.calls = [{ candidate: "Alex Example" }];
  assert.equal(
    N.presentation(rows, schedule, at, { desk }).state,
    "MOSTLY_COMPLETE",
  );
  assert.equal(initial[0].candidates[0].votes, 0);
});
test("Activity distinguishes first results, lead change, observed votes, correction and true published calls", () => {
  const a = new N.Activity(),
    before = row(),
    after = row("senate-OH", 100),
    now = 100000;
  assert.deepEqual(a.observe(null, after, now), []);
  assert.equal(a.observe(before, after, now)[0].kind, "first-results");
  const changed = structuredClone(after);
  changed.candidates[1].votes = 140;
  assert.ok(
    a.observe(after, changed, now + 1).some((e) => e.kind === "leader"),
  );
  assert.ok(!a.items.some((e) => e.kind === "call"));
  const called = {
    ...changed,
    calls: [
      { candidate: "Blair Example", provider: "NBC", status: "projected" },
    ],
  };
  assert.equal(a.observe(changed, called, now + 2)[0].source, "NBC");
  const retracted = { ...called, calls: [] };
  assert.ok(
    a
      .observe(called, retracted, now + 3)
      .some((e) => e.kind === "correction" && e.retracted),
  );
  assert.deepEqual(a.changed(now + 4), ["senate-OH"]);
  assert.deepEqual(a.changed(now + 60004), []);
});
test("Largest recent net drops include downward corrections, exclude counties and do not double count national/county totals", () => {
  const a = new N.Activity();
  a.add({ race: "a", kind: "votes", votes: 100 }, 1000);
  a.add({ race: "a", kind: "vote-correction", votes: -20 }, 1001);
  a.add({ race: "a", county: "39001", kind: "votes", votes: 999 }, 1002);
  a.add({ race: "b", kind: "votes", votes: 90 }, 1003);
  assert.deepEqual(a.drops(1004), [
    { race: "b", votes: 90 },
    { race: "a", votes: 80 },
  ]);
});
test("Six accelerated hours keep activity and CallTracker in-memory deduplication bounded", () => {
  const a = new N.Activity(),
    tracker = new desk.CallTracker();
  let r = row("senate-OH", 100);
  tracker.observe([r]);
  for (let i = 0; i < 1440; i++) {
    let next = structuredClone(r);
    next.candidates[0].votes += 10;
    a.observe(r, next, i * 15000);
    r = next;
  }
  assert.ok(a.items.length <= 200);
  assert.ok(a.changed(21600000).length <= 1);
  for (let i = 0; i < 2300; i++)
    tracker.observe([
      {
        ...r,
        calls: [
          { candidate: "Alex Example", provider: "NBC", calledAt: String(i) },
        ],
      },
    ]);
  assert.ok(tracker.seen.size <= 2000);
});
test("Tiny sparklines require dated, changing observed bipartisan margin history", () => {
  const history = [0, 1, 2].map((i) => {
    const r = row("r", 100 + i * 10);
    r.candidates[1].votes = 80;
    return { ...r, at: new Date(100000 + i * 60000).toISOString() };
  });
  assert.equal(N.sparkline(history.slice(0, 2)), null);
  assert.ok(N.sparkline(history));
  assert.equal(
    N.sparkline(
      history.map((r) => ({ ...r, candidates: r.candidates.slice(0, 1) })),
    ),
    null,
  );
});
test("History hit targets are bounded while the full observed series and both endpoints remain intact", () => {
  const points = Array.from({ length: 2400 }, (_, i) => ({ at: i })),
    targets = N.historyTargets(points);
  assert.equal(targets.length, 120);
  assert.equal(targets[0], points[0]);
  assert.equal(targets.at(-1), points.at(-1));
  assert.equal(points.length, 2400);
  assert.equal(N.historyTargets(points.slice(0, 3)).length, 3);
});
test("Shareable URL state is validated and does not serialize themes or private operator settings", () => {
  const view = N.parseView(
    "?office=senate&race=senate-OH&tab=trends&county=39001&theme=secret&admin=1",
  );
  assert.deepEqual(view, {
    office: "senate",
    race: "senate-OH",
    tab: "trends",
    county: "39001",
  });
  const url = N.viewUrl(
    { ...view, theme: "bad" },
    "https://example.test/fea-results-lab-26?theme=bad&admin=secret",
  );
  assert.equal(url.searchParams.has("theme"), false);
  assert.equal(url.searchParams.has("admin"), false);
  assert.equal(url.pathname, "/results");
  assert.deepEqual(
    N.parseView("?office=bogus&race=../../private&tab=admin&county=0"),
    {},
  );
});
test("Restoring a county Trends link keeps the requested tab after county lock and saves national office changes", async () => {
  const context = { window: { FEANight: N }, FEANight: N };
  vm.runInNewContext(
    readFileSync("assets/night-awareness-board.js", "utf8"),
    context,
  );
  class Page {
    async switchMode(mode) {
      this.selectedMode = mode;
      this.currentRace = null;
    }
  }
  context.window.FEANightAwareness(Page);
  const p = new Page(),
    race = { id: "senate-OH", type: "senate" };
  p.selectedMode = "senate";
  p.findDeskRace = () => race;
  p.selectRace = async (r) => {
    p.currentRace = r;
  };
  p.panelData = () => ({ counties: [{ fips: "39049" }] });
  p.lockCounty = (fips) => {
    p.lockedCounty = fips;
    p.focusedPanelTab = "counties";
  };
  p.renderFocusedRace = () => {};
  let saved = 0;
  p.saveNightView = () => saved++;
  await p.restoreNightView({ race: race.id, county: "39049", tab: "trends" });
  assert.equal(p.lockedCounty, "39049");
  assert.equal(p.focusedPanelTab, "trends");
  await p.switchMode("house");
  assert.equal(p.selectedMode, "house");
  assert.equal(p.currentRace, null);
  assert.ok(saved >= 2);
});
test("Fullscreen handles unavailable and denied APIs; presets stay inside the available viewport", async () => {
  assert.equal(await N.fullscreen({}), false);
  assert.equal(
    await N.fullscreen({
      fullscreenEnabled: true,
      documentElement: {
        requestFullscreen: async () => {
          throw Error("denied");
        },
      },
    }),
    false,
  );
  let entered = false;
  assert.equal(
    await N.fullscreen({
      fullscreenEnabled: true,
      documentElement: {
        requestFullscreen: async () => {
          entered = true;
        },
      },
    }),
    true,
  );
  assert.ok(entered);
  for (const k of ["compact", "analysis", "map-first", "tv"]) {
    const [w, h] = N.panelPreset(k, 1024, 768);
    assert.ok(w <= 988 && h <= 598);
  }
  assert.equal(N.panelPreset("missing", 1024, 768), null);
});
test("Greedy labels favor selected/locked geography, omit overlaps, and keep labels in the viewport", () => {
  const labels = [
    { id: "city", x: 5, y: 5, width: 100, height: 20, priority: 10 },
    { id: "locked", x: 7, y: 7, width: 100, height: 20, priority: 100 },
    { id: "outside", x: -50, y: 5, width: 20, height: 20 },
  ];
  assert.deepEqual(N.visibleLabels(labels, { width: 500, height: 500 }), [
    "locked",
  ]);
});
test("Poll-close T-2/T-1/T/T+1/T+60 transitions are exact in every office and all seven district exceptions", () => {
  const all = JSON.parse(readFileSync("data/election-night-races.json")).races;
  for (const office of ["house", "senate", "governor"]) {
    const rows = all.filter((r) => r.type === office),
      groups = N.closeGroups(rows, schedule, desk);
    for (const g of groups) {
      for (const offset of [-2000, -1000])
        assert.deepEqual(
          desk.raceOutlineIds(rows, schedule, "next", g.at + offset).sort(),
          g.raceIds.sort(),
        );
      for (const offset of [0, 1000, 60000])
        assert.ok(
          desk
            .raceOutlineIds(rows, schedule, "next", g.at + offset)
            .every((id) => !g.raceIds.includes(id)),
        );
    }
  }
  for (const [state, early, late] of [
    ["IN", 2, 1],
    ["KY", 3, 1],
    ["FL", 3, 1],
    ["KS", 2, 1],
    ["MI", 2, 1],
    ["TX", 1, 16],
    ["ID", 2, 1],
  ])
    assert.equal(
      desk.racePollCloseAt({ state, type: "house", district: late }, schedule) -
        desk.racePollCloseAt(
          { state, type: "house", district: early },
          schedule,
        ),
      3600000,
    );
  const first = N.closeGroups(
    all.filter((r) => r.type === "house"),
    schedule,
    desk,
  )[0];
  assert.equal(
    new Date(first.at).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }),
    "6:00 PM",
  );
});
test("Deployment gate catches generic punctuation variants, aliases, duplicate IDs, malformed names, missing source and missing reviewed candidates", () => {
  for (const name of [
    "Democrat.",
    "Democratic Party",
    "Republican-Party",
    " GOP! ",
    "G.O.P.",
    "T.B.D.",
    "TBA",
    "Candidate",
    "UNKNOWN?",
  ])
    assert.ok(genericName(name), name);
  for (const name of ["Other Johnson", "Republican Smith", "Independent Jones"])
    assert.ok(!genericName(name), name);
  const good = {
    ...row(),
    rosterReviewed: true,
    rosterVerified: false,
    rosterIncomplete: false,
    candidateStatus: "Reviewed",
    candidates: [
      {
        id: "1",
        name: "Alex Example",
        party: "D",
        rosterSource: "https://example.test",
      },
      {
        id: "2",
        name: "Blair Example",
        party: "R",
        rosterSource: "https://example.test",
      },
    ],
  };
  assert.ok(auditRosters([good]).passed);
  const duplicate = structuredClone(good);
  duplicate.candidates[1].aliases = ["Alex Example"];
  assert.ok(!auditRosters([duplicate]).passed);
  for (const mutate of [
    (r) => (r.candidates = []),
    (r) => (r.candidates[0].id = "2"),
    (r) => (r.candidates[0].name = "<Candidate>"),
    (r) => delete r.candidates[0].rosterSource,
    (r) => (r.rosterReviewed = false),
  ]) {
    const r = structuredClone(good);
    mutate(r);
    assert.ok(!auditRosters([r]).passed);
  }
  assert.ok(
    !auditRosters(
      [{ ...good, candidates: good.candidates.slice(0, 1) }],
      new Map([[good.id, good]]),
    ).passed,
  );
});
test("Actual poll-clock notices fire once at T, survive refresh deduplication and never replay a hidden-tab close", () => {
  const all = JSON.parse(
      readFileSync("data/election-night-races.json"),
    ).races.filter((r) => r.type === "house"),
    at = Date.parse("2026-11-03T23:00:00Z"),
    stored = new Map(),
    node = {};
  const context = {
    window: { FEANight: N },
    FEANight: N,
    FEADesk: desk,
    FEADeskTheme: {},
    FEAResultsUI: {},
    Date,
    sessionStorage: { setItem: (k, v) => stored.set(k, v) },
    document: { hidden: false, getElementById: () => node },
  };
  vm.runInNewContext(
    readFileSync("assets/desk-experience.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEACompleteBoard(Page);
  const p = new Page();
  p.pollSchedule = schedule;
  p.pollEventsSeen = new Set();
  p.lastPollClock = at - 3000;
  p.modeRaces = () => all;
  p.updateRaceOutlines = () => {};
  let count = 0;
  p.showPollClose = (e) => {
    count++;
    assert.deepEqual([...e.states].sort(), ["IN", "KY"]);
  };
  for (const offset of [-2000, -1000, 0, 1000, 60000])
    p.updatePollClock(at + offset);
  assert.equal(count, 1);
  assert.match(node.textContent, /7:00 PM ET/);
  const restored = new Set(JSON.parse(stored.get("feaPollCloseSeen.v1")));
  p.pollEventsSeen = restored;
  p.lastPollClock = at - 1;
  p.updatePollClock(at + 1);
  assert.equal(count, 1);
  const next = at + 3600000;
  p.lastPollClock = next - 1;
  context.document.hidden = true;
  p.updatePollClock(next + 1);
  context.document.hidden = false;
  p.updatePollClock(next + 60000);
  assert.equal(count, 1);
});
test("Actual lazy county geometry and race-detail caches remain bounded when many races are visited", async () => {
  const context = {
    window: {},
    FEADesk: desk,
    FEAResultsUI: {},
    stateFipsForElectionNight: (s) => s,
  };
  vm.runInNewContext(
    readFileSync("assets/results-desk-board.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEAEnhanceBoard(Page);
  const p = new Page();
  p.countyGeometries = new Map();
  p.mapAssets = { counties: {} };
  p.safeJson = async (file) => ({ features: [file] });
  for (let i = 0; i < 30; i++) {
    const state = String(i);
    p.mapAssets.counties[state] = state + ".json";
    await p.loadCountyFeatures(state);
  }
  assert.equal(p.countyGeometries.size, 6);
  assert.ok(!p.countyGeometries.has("0"));
  p.liveRaceDetails = new Map();
  p.currentRace = { id: "r0" };
  p.renderProviderStatus = () => {};
  p.safeJson = async (url) => ({
    id: new URL(url, "https://test").searchParams.get("id"),
    version: "v",
    candidates: [],
  });
  for (let i = 0; i < 60; i++)
    await p.findLiveDetailForRace({ id: "r" + i, version: "v" });
  assert.equal(p.liveRaceDetails.size, 24);
  assert.ok(p.liveRaceDetails.has("r0"));
});
test("A slow earlier race selection cannot replace a newer selection after its roads arrive", async () => {
  const context = { window: {}, FEADesk: desk, FEAResultsUI: {} };
  vm.runInNewContext(
    readFileSync("assets/results-desk-board.js", "utf8"),
    context,
  );
  const selected = [];
  class Page {
    async selectRace(r) {
      selected.push(r.id);
    }
  }
  context.window.FEAEnhanceBoard(Page);
  const p = new Page();
  p.renderFocusedRace = () => {};
  p.restorePanelSize = () => {};
  p.mapAssets = { highwaysByState: { OH: "oh", TX: "tx" } };
  const waits = new Map();
  p.safeJson = (url) => new Promise((resolve) => waits.set(url, resolve));
  const a = p.selectRace({ id: "senate-OH", state: "OH" }),
    b = p.selectRace({ id: "senate-TX", state: "TX" });
  waits.get("tx")({ features: [] });
  await b;
  waits.get("oh")({ features: [] });
  await a;
  assert.deepEqual(selected, ["senate-TX"]);
  assert.equal(p.currentRace.id, "senate-TX");
});
test("An older delayed race detail cannot overwrite a newer matching version", async () => {
  const context = { window: {}, FEADesk: desk, FEAResultsUI: {} };
  vm.runInNewContext(
    readFileSync("assets/results-desk-board.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEAEnhanceBoard(Page);
  const p = new Page();
  p.liveRaceDetails = new Map();
  p.currentRace = { id: "senate-OH" };
  p.liveRaceIndex = [{ id: "senate-OH", version: "one" }];
  p.renderProviderStatus = () => {};
  const pending = [];
  p.safeJson = () => new Promise((resolve) => pending.push(resolve));
  const old = p.findLiveDetailForRace({ id: "senate-OH", version: "one" });
  p.liveRaceIndex = [{ id: "senate-OH", version: "two" }];
  const fresh = p.findLiveDetailForRace({ id: "senate-OH", version: "two" });
  pending[1]({
    id: "senate-OH",
    version: "two",
    candidates: [],
    counties: [{ name: "New" }],
  });
  await fresh;
  pending[0]({
    id: "senate-OH",
    version: "one",
    candidates: [],
    counties: [{ name: "Old" }],
  });
  await old;
  assert.equal(p.liveRaceDetails.get("senate-OH").version, "two");
  assert.equal(p.liveRaceDetails.get("senate-OH").counties[0].name, "New");
});
test("Blocked browser storage does not prevent board construction or office changes", async () => {
  const context = {
    document: { readyState: "loading", addEventListener() {} },
    window: { location: { search: "", pathname: "/results" } },
    URLSearchParams,
  };
  Object.defineProperty(context, "localStorage", {
    get() {
      throw Error("Storage blocked");
    },
  });
  vm.runInNewContext(
    readFileSync("assets/election-night.js", "utf8") +
      "\nElectionNightPage.prototype.init=function(){};globalThis.page=new ElectionNightPage();",
    context,
  );
  const p = context.page;
  assert.equal(p.selectedMode, "house");
  assert.equal(p.comparisonMode, "live");
  for (const key of [
    "normalizeComparisonModeForCurrentMap",
    "updateModeButtons",
    "renderSummary",
    "hideFocusPanel",
    "preloadLikelyDetailAssets",
  ])
    p[key] = () => {};
  p.renderMap = async () => {};
  await p.switchMode("senate");
  assert.equal(p.selectedMode, "senate");
});
test("District county geometry stays bounded across many inspected House races", async () => {
  const context = {
    document: { readyState: "loading", addEventListener() {} },
    window: { location: { search: "", pathname: "/results" } },
    localStorage: { getItem: () => null },
    URLSearchParams,
  };
  vm.runInNewContext(
    readFileSync("assets/election-night.js", "utf8") +
      "\nElectionNightPage.prototype.init=function(){};globalThis.page=new ElectionNightPage();",
    context,
  );
  const p = context.page;
  p.safeJson = async (file) => ({ features: [{ properties: { file } }] });
  for (let i = 1; i <= 60; i++)
    await p.loadDistrictCountyFeatures({
      type: "house",
      state: i <= 52 ? "CA" : "TX",
      district: i <= 52 ? i : i - 52,
    });
  assert.equal(p.districtCountyFeatures.size, 24);
  assert.equal(p.districtCountyFeaturePromises.size, 0);
});
