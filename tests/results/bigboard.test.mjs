import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseNbcResults } from "../../scripts/results/nbc-provider.mjs";
import {
  mergeRoster,
  genericName,
} from "../../scripts/results/candidate-roster.mjs";
const require = createRequire(import.meta.url),
  T = require("../../assets/desk-theme.js"),
  desk = require("../../assets/results-desk.js");
const clone = (x) => JSON.parse(JSON.stringify(x));
test("Provider preserves unusual identities, IDs, fusion labels, no-party and write-ins; rejects generic parties as names", () => {
  const local = { id: "house-LA-1", state: "LA", type: "house", district: 1 },
    source = { races: [{ feaRaceId: local.id, providerRaceId: "la1" }] },
    rows = [
      {
        candidateId: "a",
        name: 'Caleb "With a C" Walker',
        party: "DEM",
        votes: 5,
        partyLabels: ["Democratic", "Working Families"],
      },
      {
        candidateId: "b",
        name: 'E. "Liddy" Glass',
        party: "NO PARTY",
        votes: 4,
      },
      { candidateId: "c", name: "Write-ins", party: "OTHER", votes: 1 },
      {
        candidateId: "d",
        name: "Other actual candidate",
        party: "LIB",
        votes: 0,
      },
    ];
  const data = {
    stateAbbr: "LA",
    electionDate: "2026-11-03",
    races: [
      {
        summary: {
          raceId: "la1",
          officeName: "US House",
          district: 1,
          candidates: rows,
        },
      },
    ],
  };
  const result = parseNbcResults(data, source, [local])[0];
  assert.equal(result.candidates.length, 4);
  assert.equal(result.candidates[0].id, "a");
  assert.equal(result.candidates[0].percent, 50);
  assert.deepEqual(result.candidates[0].partyLabels, [
    "Democratic",
    "Working Families",
  ]);
  assert.equal(result.candidates[1].party, "NP");
  assert.equal(result.providerCall, null);
  rows[0].name = "Democrat";
  assert.throws(
    () => parseNbcResults(data, source, [local]),
    /Invalid NBC candidate/,
  );
});
test("Theme schema rejects unsupported versions, CSS injection, unknown tokens and missing party colors", () => {
  for (const mutate of [
    (t) => (t.schemaVersion = 2),
    (t) => (t.baseColor = "url(https://bad)"),
    (t) => (t.advanced.selector = "#ffffff"),
    (t) => delete t.partyColors.I,
  ]) {
    const t = clone(T.presets[0]);
    mutate(t);
    assert.throws(() => T.validate(t));
  }
  const malicious = clone(T.presets[0]);
  malicious.name = "<img onerror=alert(1)>";
  assert.equal(T.validate(malicious).name, malicious.name); // Display uses textContent.
});
test("Built-in and radically different generated palettes preserve readable text and surface hierarchy", () => {
  for (const baseColor of ["#ff0099", "#00ff66", "#000000", "#ffffff"])
    for (const mode of ["light", "dark"]) {
      const r = T.resolve({ ...T.presets[0], mode, baseColor });
      assert.equal(r.warnings.length, 0);
      assert.notEqual(r.tokens["board-bg"], r.tokens["panel-bg"]);
      assert.ok(
        T.contrast(r.tokens["text-primary"], r.tokens["panel-bg"]) >= 4.5,
      );
    }
  assert.equal(T.resolve(T.presets[2], false).mode, "light");
  assert.equal(T.resolve(T.presets[2], true).mode, "dark");
});
test("Malformed storage and schema mismatch fall back safely; advanced contrast is diagnosed", () => {
  for (const value of [
    "{",
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({ schemaVersion: 1, current: {}, saved: [] }),
  ])
    assert.equal(T.read({ getItem: () => value }).current.id, "fea-night");
  const t = clone(T.presets[0]);
  t.advanced = { "text-primary": "#ffffff", "panel-bg": "#ffffff" };
  assert.ok(T.resolve(t).warnings.length);
  const saved = {
    schemaVersion: 1,
    current: { ...T.presets[0], id: "custom-green", name: "Green" },
    saved: [{ ...T.presets[0], id: "custom-green", name: "Green" }],
  };
  assert.equal(
    T.read({ getItem: () => JSON.stringify(saved) }).saved[0].name,
    "Green",
  );
});
test("Party palette does not change when only interface color changes; same-party identities are distinguishable", () => {
  const a = { name: "A", party: "D" },
    b = { name: "B", party: "D" },
    peers = [a, b];
  T.apply(T.presets[0]);
  const first = T.candidateColor(a, peers);
  assert.notEqual(first, T.candidateColor(b, peers));
  T.apply({ ...T.presets[0], baseColor: "#ff00cc" });
  assert.equal(T.candidateColor(a, peers), first);
  assert.equal(
    T.candidateColor({ name: "Minor", party: "L" }),
    T.candidateColor({ name: "Minor", party: "L" }),
  );
  T.apply(T.presets[0]);
});
test("Official Louisiana source preserves every ballot identity and arbitrary candidate count", () => {
  const source = JSON.parse(
      readFileSync("data/results/louisiana-ballot-2026.json"),
    ),
    races = JSON.parse(readFileSync("data/election-night-races.json")).races;
  assert.deepEqual(
    source.races.map((r) => r.candidates.length),
    [2, 4, 5, 6, 5, 9, 10],
  );
  for (const row of source.races) {
    const live = races.find((r) => r.id === row.id);
    assert.deepEqual(
      live.candidates.map((c) => [c.name, c.party]),
      row.candidates.map((c) => [c.name, c.party]),
    );
    assert.ok(live.rosterVerified);
    assert.ok(
      live.candidates.every(
        (c) => !c.isWinner && !c.votes && c.percent === null,
      ),
    );
  }
  assert.ok(
    source.races
      .flatMap((r) => r.candidates)
      .some((c) => c.name === 'Caleb "With a C" Walker'),
  );
  assert.ok(
    source.races
      .flatMap((r) => r.candidates)
      .some((c) => c.name === 'E. "Liddy" Glass'),
  );
  assert.ok(
    races.every((r) => r.candidates.every((c) => !genericName(c.name))),
  );
});
test("Roster sync removes generic names and cannot import forecast probabilities, winner flags or duplicate stale identities", () => {
  const r = mergeRoster(
    {
      id: "x",
      candidates: [
        { name: "Known", party: "D" },
        { name: "Republican", party: "R" },
      ],
    },
    {
      metadata: [
        { name: "Stale other D", party: "D" },
        { name: "Actual", party: "R", votes: 900, percent: 96, isWinner: true },
      ],
    },
  );
  assert.deepEqual(
    r.candidates.map((c) => c.name),
    ["Known", "Actual"],
  );
  assert.ok(
    r.candidates.every(
      (c) => c.votes === 0 && c.percent === null && !c.isWinner,
    ),
  );
  assert.equal(r.rosterVerified, false);
  const official = mergeRoster(r, {
    official: {
      sourceUrl: "official",
      candidates: [
        { name: "A", party: "D" },
        { name: "B", party: "D" },
        { name: "C", party: "I" },
        { name: "D", party: "G" },
      ],
    },
  });
  assert.equal(official.candidates.length, 4);
  const reviewed = mergeRoster(r, { reviewed: { sourceName: "Reviewed source", sourceUrl: "reviewed", candidates: [{ name: "Named write-in", party: "R", writeIn: true }] } });
  assert.equal(reviewed.rosterVerified, false);
  assert.equal(reviewed.rosterIncomplete, true);
  assert.equal(reviewed.candidates[0].writeIn, true);
  assert.equal(reviewed.candidates[0].rosterSource, "reviewed");
});
test("Multi-candidate D-R descriptive metrics sum all same-party candidates and all-vote denominator", () => {
  const m = desk.metrics({
    candidates: [
      { name: "A", party: "D", votes: 30 },
      { name: "B", party: "D", votes: 20 },
      { name: "C", party: "R", votes: 40 },
      { name: "I", party: "I", votes: 10 },
    ],
  });
  assert.equal(m.margin, 10);
  assert.equal(m.rawMargin, 10);
});
test("Poll schedule covers each state once, preserves split-district exceptions and November standard time", () => {
  const p = JSON.parse(readFileSync("data/results/poll-closes.json")),
    states = p.events.flatMap((e) => e.states);
  assert.equal(states.length, 51);
  assert.equal(new Set(states).size, 51);
  assert.equal(
    p.events.find((e) => e.states.includes("OH")).at,
    "2026-11-04T00:30:00Z",
  );
  assert.equal(p.districtExceptions.FL["1"], "2026-11-04T01:00:00Z");
  assert.equal(p.districtExceptions.FL.default, "2026-11-04T00:00:00Z");
});
test("Adaptive polling schedules one timer with 15s active, 60s pre-election and 120s hidden cadence", () => {
  let duration,
    count = 0;
  const context = {
    window: {},
    FEADeskTheme: T,
    FEAResultsUI: {},
    document: { hidden: false },
    Date: { now: () => Date.parse("2026-11-03T22:00:00Z"), parse: Date.parse },
    setTimeout: (_, ms) => {
      duration = ms;
      count++;
      return count;
    },
    clearTimeout: () => {},
  };
  vm.runInNewContext(
    readFileSync("assets/desk-experience.js", "utf8"),
    context,
  );
  class Page {}
  context.window.FEACompleteBoard(Page);
  const p = new Page();
  p.dataByMode = { house: [] };
  p.query = new URLSearchParams();
  p.scheduleDeskPoll();
  assert.equal(duration, 15000);
  context.document.hidden = true;
  p.scheduleDeskPoll();
  assert.equal(duration, 120000);
  context.document.hidden = false;
  context.Date.now = () => Date.parse("2026-10-28T00:00:00Z");
  p.scheduleDeskPoll();
  assert.equal(duration, 60000);
});
