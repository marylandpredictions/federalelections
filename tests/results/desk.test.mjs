import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultsChangeFeed } from "../../scripts/results/change-feed.mjs";
import {
  CountyHistory,
  resultSignature,
} from "../../scripts/results/history.mjs";
import {
  normalizeDemographics,
  censusKeyFromEnv,
} from "../../scripts/results/build-county-demographics.mjs";
import { NbcProvider } from "../../scripts/results/nbc-provider.mjs";
import { gunzipSync } from "node:zlib";
import { feature } from "topojson-client";
import vm from "node:vm";
const require = createRequire(import.meta.url),
  desk = require("../../assets/results-desk.js");
const candidates = (d = 55, r = 40) => [
  { name: "A", party: "D", votes: d },
  { name: "B", party: "R", votes: r },
  { name: "C", party: "I", votes: 5 },
];
const race = (id = "senate-OH") => ({
  id,
  type: "senate",
  state: "OH",
  candidates: candidates(),
  calls: [],
  counties: [{ fips: "39001", candidates: candidates() }],
  voteHistory: [{ at: "test" }],
  providerCall: { candidate: "A" },
  sourceUrl: "private-source",
  callState: "NBC_PENDING",
});
const data = (races) => ({
  groups: [{ state: "senate", races }],
  provider: {
    status: "CONNECTED",
    stale: false,
    lastAttempt: new Date().toISOString(),
  },
  generatedAt: new Date().toISOString(),
});
test("Change feed: stable unchanged versions, one-race deltas, batches and expired-client reset", () => {
  const feed = new ResultsChangeFeed({ capacity: 2 });
  const first = feed.update(data([race(), race("senate-TX")]));
  const unchanged = feed.update(data([race(), race("senate-TX")]));
  assert.equal(first.version, unchanged.version);
  const changed = race();
  changed.candidates = candidates(60, 45);
  feed.update(data([changed, race("senate-TX")]));
  assert.deepEqual(
    feed.changes(first.version).races.map((r) => r.id),
    ["senate-OH"],
  );
  const now = feed.current.version;
  const other = race("senate-TX");
  other.candidates = candidates(100, 90);
  changed.calls = [{ candidate: "A", provider: "NBC", source: "nbc-auto" }];
  feed.update(data([changed, other]));
  assert.equal(feed.changes(now).races.length, 2);
  assert.equal(feed.changes(first.version).reset, true);
});
test("Public summaries never contain counties, history, private pending calls, URLs or control state", () => {
  const feed = new ResultsChangeFeed();
  const d = data([race()]);
  feed.update(d);
  const full = feed.full(d),
    row = full.groups[0].races[0];
  for (const key of [
    "counties",
    "voteHistory",
    "providerCall",
    "sourceUrl",
    "callState",
  ])
    assert.equal(row[key], undefined);
  assert.deepEqual(row.calls, []);
  assert.equal(full.provider.lastAttempt, undefined);
});
test("A county-only detail version invalidates only that race; fetch timestamps do not change versions", () => {
  const feed = new ResultsChangeFeed(),
    r = race();
  r.detailVersion = "a";
  r.lastUpdated = "2026-11-04T00:00:00Z";
  const a = feed.update(data([r])).version;
  r.lastUpdated = "2026-11-04T00:01:00Z";
  assert.equal(feed.update(data([r])).version, a);
  r.detailVersion = "b";
  feed.update(data([r]));
  assert.equal(feed.changes(a).races.length, 1);
});
test("Public projection tracker: no historical replay, pending never alerts, published calls/corrections distinct, refresh persistence", () => {
  const storage = {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_, v) {
      this.value = v;
    },
  };
  const tracker = new desk.CallTracker(storage),
    r = race();
  assert.deepEqual(tracker.observe([r]), []);
  assert.deepEqual(tracker.observe([r]), []);
  r.calls = [
    {
      candidate: "A",
      provider: "NBC",
      source: "nbc-auto",
      calledAt: "2026-11-04T01:00Z",
    },
  ];
  assert.equal(tracker.observe([r])[0].correction, false);
  assert.equal(new desk.CallTracker(storage).observe([r]).length, 0);
  r.calls = [
    { candidate: "B", source: "fea-manual", calledAt: "2026-11-04T01:01Z" },
  ];
  assert.equal(tracker.observe([r])[0].correction, true);
  r.calls = [];
  assert.equal(tracker.observe([r])[0].correction, true);
  assert.equal(tracker.observe([r]).length, 0);
});
test("Metrics use all votes, distinguish revisions, and never infer remaining votes from precinct reporting", () => {
  const current = { candidates: candidates(), expectedVotePercent: 50 },
    prior = { candidates: candidates(45, 30) };
  const m = desk.metrics(current, prior, {
    demVotes: 40,
    repVotes: 55,
    totalVotes: 100,
  });
  assert.equal(m.votes, 100);
  assert.equal(m.margin, 15);
  assert.equal(m.shift, 30);
  assert.equal(m.remaining, 100);
  assert.equal(m.delta, 20);
  assert.equal(m.batchShares[0].share, 50);
  assert.equal(
    desk.metrics({ candidates: candidates(), percentReporting: 50 }).remaining,
    null,
  );
  assert.equal(desk.metrics(prior, current).batchShares.length, 0);
  assert.equal(desk.metrics({ candidates: [] }).margin, null);
  assert.equal(
    desk.metrics({
      candidates: [
        { name: "Missing", party: "D", votes: null },
        { name: "B", party: "R", votes: 100 },
      ],
    }).margin,
    null,
  );
});
test("Sparse county history writes changed counties only, survives restart and separates expected from precincts", () => {
  const root = mkdtempSync(join(tmpdir(), "fea-county-history-"));
  try {
    const h = new CountyHistory(root),
      r = race();
    r.counties.push({ fips: "39003", candidates: candidates() });
    assert.equal(h.record(r).length, 2);
    const path = join(root, ".runtime/county-history/senate-OH/39001.ndjson"),
      size = statSync(path).size;
    assert.equal(h.record(r).length, 0);
    assert.equal(statSync(path).size, size);
    r.counties[0].candidates = candidates(60, 40);
    assert.equal(h.record(r).length, 1);
    assert.equal(h.read(r.id, "39001").length, 2);
    assert.equal(h.read(r.id, "39003").length, 1);
    assert.equal(new CountyHistory(root).record(r).length, 0);
    r.counties[0].estimatedVoteReporting = 70;
    assert.equal(h.record(r).length, 1);
    assert.equal(h.read(r.id, "39001").at(-1).expectedVotePercent, 70);
    assert.notEqual(
      resultSignature({ candidates: candidates(), expectedVotePercent: 50 }),
      resultSignature({ candidates: candidates(), expectedVotePercent: 51 }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Census transforms correct denominators and missing/suppressed estimates; statewide rows remain direct estimates", () => {
  const keys = [
    "NAME",
    "state",
    "county",
    "B01003_001E",
    "B03002_003E",
    "B02001_003E",
    "B03003_003E",
    "B02001_005E",
    "B15003_001E",
    "B19013_001E",
    ...[20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49].map(
      (n) => `B01001_${String(n).padStart(3, "0")}E`,
    ),
    ...[22, 23, 24, 25].map((n) => `B15003_${String(n).padStart(3, "0")}E`),
  ];
  const row = [
    "County",
    "39",
    "001",
    1000,
    600,
    100,
    200,
    50,
    500,
    -666666666,
    ...Array(12).fill(10),
    ...Array(4).fill(50),
  ];
  const result = normalizeDemographics([keys, row])["39001"];
  assert.equal(result.whiteNH, 60);
  assert.equal(result.age65, 12);
  assert.equal(result.bachelors, 40);
  assert.equal(result.income, null);
  const stateHeader = keys.filter((k) => k !== "county"),
    stateRow = row.filter((_, i) => i !== 2);
  assert.ok(normalizeDemographics([stateHeader, stateRow])["39"]);
});
test("An empty Census key cannot accidentally consume another secret from the following .env line", () => {
  assert.equal(
    censusKeyFromEnv("CENSUS_API_KEY=\r\nADMIN_SECRET=private-test\r\n"),
    "",
  );
  assert.equal(
    censusKeyFromEnv('CENSUS_API_KEY="local-test-value"\n'),
    "local-test-value",
  );
});
test("Trends retain reporting-only changes and discard identical repeated samples", () => {
  const p = {
    at: "2026-11-04T01:00:00Z",
    candidates: candidates(),
    expectedVotePercent: 50,
  };
  assert.equal(
    desk.trendPoints([
      p,
      { ...p, at: "2026-11-04T01:01:00Z" },
      { ...p, at: "2026-11-04T01:02:00Z", expectedVotePercent: 51 },
    ]).length,
    2,
  );
});
test("NBC conditional requests reuse only a validated body, retain upstream time, and preserve verification gates", async () => {
  const local = { id: "senate-OH", state: "OH", type: "senate" };
  const source = {
    url: "https://www.nbcnews.com/firecracker/verified-fixture",
    status: "CONFIRMED",
    election: "2026-general",
    races: [{ feaRaceId: local.id, providerRaceId: "123" }],
    projection: { verified: true, candidateFlag: "isWinner" },
  };
  const payload = {
    stateAbbr: "OH",
    electionDate: "2026-11-03",
    lastUpdated: "2026-11-04T01:00:00Z",
    races: [
      {
        summary: {
          raceId: 123,
          officeName: "Senate",
          candidates: [
            {
              candidateId: 1,
              name: "A",
              party: "DEM",
              votes: 100,
              isWinner: true,
            },
          ],
        },
      },
    ],
  };
  let n = 0,
    headers;
  const provider = new NbcProvider({
    sources: [source],
    fetchImpl: async (_, options) => {
      headers = options.headers;
      return ++n === 1
        ? new Response(JSON.stringify(payload), {
            headers: {
              etag: '"fixture"',
              "last-modified": "Wed, 04 Nov 2026 01:00:00 GMT",
            },
          })
        : new Response(null, { status: 304 });
    },
  });
  const first = await provider.fetchResults([local]),
    second = await provider.fetchResults([local]);
  assert.deepEqual(first, second);
  assert.equal(headers["If-None-Match"], '"fixture"');
  assert.ok(headers["If-Modified-Since"]);
  assert.equal(second[0].lastUpdated, "2026-11-04T01:00:00.000Z");
  source.status = "PREDICTED";
  await assert.rejects(() => provider.fetchResults([local]), /verified/);
  assert.equal(n, 2);
});
test("Optimized House topology preserves every source feature and a nonzero selectable polygon for each district", () => {
  const manifest = JSON.parse(readFileSync("data/results/map-assets.json")),
    topology = JSON.parse(gunzipSync(readFileSync(manifest.house)));
  const decoded = feature(topology, topology.objects.districts).features,
    source = JSON.parse(
      readFileSync("data/house-districts-119.geojson"),
    ).features;
  assert.deepEqual(
    decoded.map((f) => f.properties.id).sort(),
    source.map((f) => f.properties.id).sort(),
  );
  const ringArea = (ring) =>
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0),
    );
  for (const f of decoded) {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    assert.ok(
      polygons.some((p) => ringArea(p[0]) > 0),
      f.properties.id,
    );
  }
  assert.ok(statSync(manifest.house).size < 2 * 1024 * 1024);
});
test("Client deltas invalidate changed detail only, preserve selected objects/zoom/county, and recover a full snapshot without rebuilding the map", async () => {
  const ui = require("../../assets/results-ui.js"),
    requests = [];
  let delta = {
      version: "two",
      races: [{ ...race("senate-TX"), candidates: candidates(70, 50) }],
    },
    version = "two",
    unchanged = false;
  const a = race(),
    b = race("senate-TX");
  const selected = { ...a },
    other = { ...b };
  const context = vm.createContext({
    window: {},
    FEADesk: desk,
    FEAResultsUI: ui,
    normalizeElectionRace: (r) => ({ ...r }),
    CustomEvent,
    fetch: async (url) => {
      requests.push(url);
      if (unchanged) return { status: 304 };
      return {
        status: 200,
        ok: true,
        json: async () =>
          url === "/api/results-version"
            ? { version }
            : url === "/api/live-results"
              ? { version, groups: [{ races: [a, b] }] }
              : delta,
      };
    },
  });
  vm.runInContext(
    readFileSync("assets/results-desk-board.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEAEnhanceBoard(Page);
  const p = new Page();
  p.dataByMode = { house: [], senate: [selected, other], governor: [] };
  p.liveRaceIndex = [a, b];
  p.liveRaceDetails = new Map([
    [a.id, { ...a }],
    [b.id, { ...b }],
  ]);
  p.currentRace = selected;
  p.selectedMode = "senate";
  p.resultsVersion = "one";
  p.watchlist = new Map();
  p.lockedCounty = "39001";
  p.transform = { k: 3, x: 20, y: 40 };
  p.events = new EventTarget();
  p.callTracker = new desk.CallTracker();
  p.callTracker.observe([a, b]);
  let redraws = 0,
    detailLoads = 0,
    alerts = 0;
  p.renderMap = () => redraws++;
  p.renderSummary = () => {};
  p.updateMapFills = () => {};
  p.renderFocusedRace = () => {};
  p.renderProviderStatus = () => {};
  p.findLiveDetailForRace = async (r) => {
    detailLoads++;
    p.liveRaceDetails.set(r.id, { ...r });
  };
  p.events.addEventListener("call-change", () => alerts++);
  const transform = p.transform;
  await p.refreshResults();
  assert.equal(p.liveRaceDetails.has(b.id), false);
  assert.equal(p.liveRaceDetails.has(a.id), true);
  assert.equal(p.dataByMode.senate[1], other);
  assert.equal(other.candidates[0].votes, 70);
  assert.equal(detailLoads, 0);
  delta = {
    version: "three",
    races: [
      {
        ...a,
        candidates: candidates(80, 60),
        calls: [{ candidate: "A", provider: "NBC", source: "nbc-auto" }],
      },
    ],
  };
  version = "three";
  await p.refreshResults();
  assert.equal(detailLoads, 1);
  assert.equal(alerts, 1);
  assert.equal(p.currentRace, selected);
  assert.equal(p.transform, transform);
  assert.equal(p.lockedCounty, "39001");
  assert.equal(redraws, 0);
  delta = { reset: true, version: "four" };
  version = "four";
  await p.refreshResults();
  assert.ok(requests.includes("/api/live-results"));
  assert.equal(redraws, 0);
  assert.equal(p.transform, transform);
  assert.equal(p.lockedCounty, "39001");
  const before = requests.length;
  unchanged = true;
  await p.refreshResults();
  assert.equal(requests.length - before, 1);
});
test("A failed selected-detail fetch retains county/history data and retries even when the national version is unchanged", async () => {
  let available = false,
    requests = 0;
  const r = { ...race(), version: "new" },
    old = {
      ...race(),
      version: "old",
      voteHistory: [{ at: "2026-11-04T01:00Z", candidates: candidates() }],
    },
    fresh = {
      ...r,
      counties: [{ fips: "39001", candidates: candidates(70, 30) }],
    };
  const context = vm.createContext({
    window: {},
    FEADesk: desk,
    FEAResultsUI: require("../../assets/results-ui.js"),
    fetch: async () => {
      requests++;
      return { ok: available, json: async () => fresh };
    },
  });
  vm.runInContext(
    readFileSync("assets/results-desk-board.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEAEnhanceBoard(Page);
  const p = new Page();
  p.liveRaceDetails = new Map([[r.id, old]]);
  p.currentRace = r;
  p.renderProviderStatus = () => {};
  p.renderFocusedRace = () => {};
  p.updateMapFills = () => {};
  assert.equal(await p.findLiveDetailForRace(r), old);
  assert.equal(p.panelData(r).counties, old.counties);
  assert.equal(p.detailRetryID, r.id);
  available = true;
  await p.retrySelectedDetail();
  assert.equal(p.liveRaceDetails.get(r.id), fresh);
  assert.equal(p.detailRetryID, null);
  assert.equal(requests, 2);
});
test("Compiled ACS artifact covers the mapped counties, keeps real Census controls, and contains only bounded valid estimates", () => {
  const d = JSON.parse(
    readFileSync("data/results/county-demographics.min.json"),
  );
  assert.equal(d.status, "available");
  assert.equal(d.vintage, 2024);
  assert.equal(Object.keys(d.counties).length, 3222);
  assert.equal(Object.keys(d.states).length, 52);
  assert.equal(d.sourceControls.usPopulation, 334922499);
  assert.equal(d.counties["01001"].population, 59947);
  assert.equal(
    Object.entries(d.states)
      .filter(([fips]) => fips !== "72")
      .reduce((s, [, r]) => s + r.population, 0),
    d.sourceControls.usPopulation,
  );
  for (const f of JSON.parse(readFileSync("data/result-counties.geojson"))
    .features)
    assert.ok(d.counties[f.properties.GEOID], f.properties.GEOID);
  for (const row of [...Object.values(d.counties), ...Object.values(d.states)])
    for (const key of [
      "whiteNH",
      "black",
      "hispanic",
      "asian",
      "age65",
      "bachelors",
    ])
      assert.ok(row[key] === null || (row[key] >= 0 && row[key] <= 100));
});
test("County hover never substitutes statewide vote totals or statewide projection checks for missing county results", () => {
  const code = readFileSync("assets/election-night.js", "utf8"),
    start = code.indexOf("function countyTooltipRowsClean"),
    end = code.indexOf("function countyDescriptionForFeature", start);
  const context = vm.createContext({
    candidateByName: (r, name) => r.candidates.find((c) => c.name === name),
    candidateColor: () => "blue",
    normalizedPartyCode: () => "D",
    escapeHtml: (v) => String(v),
    formatVotes: (n) => n.toLocaleString("en-US"),
    formatPercent: (n) => n.toFixed(1) + "%",
    formatReportingPercent: (n) => n,
    countyDescriptionForFeature: () => "",
    countyTopCandidatesForElectionNight: (c) => c?.candidates || [],
    topCandidates: (r) => r.candidates,
  });
  vm.runInContext(code.slice(start, end), context);
  const r = {
    candidates: [
      { name: "State candidate", votes: 123456, percent: 60, isWinner: true },
    ],
  };
  const missing = context.countyTooltipMarkupClean(
    null,
    { properties: { NAME: "Test County" } },
    new Map(),
    r,
    "",
  );
  assert.ok(!missing.includes("123,456"));
  assert.ok(!missing.includes("tooltip-call-mark"));
  const actual = context.countyTooltipMarkupClean(
    {
      name: "Test",
      candidates: [
        { name: "State candidate", votes: 10, percent: null },
        { name: "Other", votes: 0, percent: null },
      ],
    },
    { properties: {} },
    new Map(),
    r,
    "",
  );
  assert.ok(actual.includes("100.0%"));
  assert.ok(!actual.includes("tooltip-call-mark"));
});
