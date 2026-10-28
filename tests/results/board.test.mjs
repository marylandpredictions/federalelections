import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import UI from "../../assets/results-ui.js";
import { buildPresidentialRows } from "../../scripts/results/build-presidential-comparisons.mjs";
const source = {
  id: "pres-2024",
  status: "available",
  appliesTo: ["house", "senate", "governor"],
};
const votes = (margin) => ({
  demVotes: 500 + margin * 5,
  repVotes: 500 - margin * 5,
  totalVotes: 1000,
});
test("Signed shift math: D+5 vs D+2, R+4 vs R+10, D+2 vs R+3", () => {
  for (const [now, base, expected] of [
    [5, 2, 3],
    [-4, -10, 6],
    [2, -3, 5],
  ])
    assert.equal(UI.shift(now, base), expected);
  assert.ok(Number.isNaN(UI.shift(5, null)));
});
test("House district lookup requires current geometry; never falls back to statewide president", () => {
  const race = {
    type: "house",
    state: "CO",
    district: 4,
    geometryId: "verified-2026-map",
  };
  const datasets = {
    state: {
      marginBasis: "all-votes",
      states: [{ state: "CO", ...votes(20) }],
    },
    district: {
      marginBasis: "all-votes",
      districts: [
        {
          id: "CO-04",
          geographyVerified: true,
          geometryId: "verified-2026-map",
          ...votes(-3),
        },
      ],
    },
  };
  assert.equal(UI.baselineMargin(race, source, datasets), -3);
  assert.ok(
    Number.isNaN(UI.baselineMargin(race, source, { state: datasets.state })),
  );
  assert.ok(
    Number.isNaN(
      UI.baselineMargin(
        { ...race, geometryId: "different-map" },
        source,
        datasets,
      ),
    ),
  );
  assert.ok(
    Number.isNaN(
      UI.baselineMargin({ ...race, geometryId: null }, source, datasets),
    ),
  );
  assert.equal(
    UI.baselineMargin({ type: "senate", state: "CO" }, source, datasets),
    20,
  );
});
test("Missing/invalid baseline and missing totals cannot become a zero or a synthetic margin", () => {
  assert.ok(
    Number.isNaN(
      UI.baselineMargin({ type: "governor", state: "CO" }, source, {}),
    ),
  );
  assert.ok(Number.isNaN(UI.margin({ ...votes(5), totalVotes: null })));
  assert.ok(
    Number.isNaN(
      UI.margin({ demVotes: 1000, repVotes: 400, totalVotes: 1000 }),
    ),
  );
  assert.ok(
    Number.isNaN(
      UI.baselineMargin({ type: "senate", state: "CO" }, source, {
        state: {
          marginBasis: "all-votes",
          states: [{ state: "CO", valid: false, ...votes(5) }],
        },
      }),
    ),
  );
});
test("Watch and Toss-up are separate; missing metadata yields no invented editorial labels", () => {
  const rows = UI.watchMetadata(
    {
      races: {
        a: { tossup: true },
        b: { watch: true },
        c: { watch: true, tossup: true },
        unknown: { tossup: true },
      },
    },
    [{ id: "a" }, { id: "b" }, { id: "c" }],
  );
  assert.equal(rows.size, 3);
  assert.equal(UI.watchLabel(rows.get("a")), "Toss-up");
  assert.equal(UI.watchLabel(rows.get("b")), "To watch");
  assert.equal(UI.watchLabel(rows.get("c")), "Toss-up");
  assert.equal(UI.watchMetadata(null).size, 0);
});
test("Current local watch metadata has verified source dates, correct office counts, and exact catalogue IDs", async () => {
  const metadata = JSON.parse(
    await readFile("data/election-night-watchlist.json", "utf8"),
  );
  const catalog = JSON.parse(
    await readFile("data/election-night-races.json", "utf8"),
  ).races;
  const map = UI.watchMetadata(metadata, catalog);
  assert.equal(map.size, Object.keys(metadata.races).length);
  for (const [office, count] of [
    ["house", 17],
    ["senate", 7],
    ["governor", 3],
  ]) {
    assert.equal(
      [...map].filter(([id, row]) => id.startsWith(office + "-") && row.tossup)
        .length,
      count,
    );
    assert.ok(metadata.sources[office].sourceDate);
    assert.ok(metadata.sources[office].url.includes("cookpolitical.com"));
  }
  assert.equal(UI.watchLabel(map.get("house-CO-4")), "To watch");
  assert.equal(map.get("house-CO-8").tossup, false);
});
test("Presidential aggregation chooses TOTAL once, ignores total/under/overvote bookkeeping, and includes third-party denominator", () => {
  const common = {
    year: 2024,
    state_po: "CO",
    county_fips: "8001",
    county_name: "Adams",
    totalvotes: "1000",
  };
  const rows = [
    {
      candidate: "Harris",
      party: "DEMOCRAT",
      candidatevotes: "500",
      mode: "TOTAL",
    },
    {
      candidate: "Trump",
      party: "REPUBLICAN",
      candidatevotes: "400",
      mode: "TOTAL",
    },
    {
      candidate: "OTHER",
      party: "OTHER",
      candidatevotes: "100",
      mode: "TOTAL",
    },
    {
      candidate: "TOTAL VOTES CAST",
      party: "",
      candidatevotes: "1000",
      mode: "TOTAL",
    },
    {
      candidate: "UNDERVOTES",
      party: "OTHER",
      candidatevotes: "20",
      mode: "TOTAL",
    },
    {
      candidate: "Harris",
      party: "DEMOCRAT",
      candidatevotes: "300",
      mode: "EARLY",
    },
  ].map((r) => ({ ...common, ...r }));
  const built = buildPresidentialRows(rows, 2024, new Set(["08001"]));
  assert.equal(built.states[0].demVotes, 500);
  assert.equal(built.states[0].margin, 10);
  assert.equal(built.invalid.length, 0);
  assert.equal(built.rows.length, 1);
});
test("Rebuilt presidential data passes totals checks and known FEC statewide anchors; Alaska is not joined as counties", async () => {
  for (const year of [2020, 2024]) {
    const d = JSON.parse(
      await readFile(`data/baselines/pres-${year}-states.json`, "utf8"),
    );
    assert.equal(d.states.length, 51);
    assert.equal(d.marginBasis, "all-votes");
    if(year===2020)assert.equal(d.invalid.length, 0);
    for (const row of d.states)
      assert.ok(row.demVotes + row.repVotes <= row.totalVotes);
    const counties = JSON.parse(
      await readFile(`data/baselines/pres-${year}-counties.json`, "utf8"),
    );
    assert.ok(counties.rows.every((r) => r.state !== "AK"));
  }
  const d = JSON.parse(
    await readFile("data/baselines/pres-2024-states.json", "utf8"),
  );
  for (const [state, dem, rep] of [
    ["AR", 396905, 759241],
    ["CO", 1728159, 1377441],
    ["NC", 2715375, 2898423],
  ]) {
    const r = d.states.find((r) => r.state === state);
    assert.equal(r.demVotes, dem);
    assert.equal(r.repVotes, rep);
  }
});
test("All House comparison choices remain unavailable without verified district geography", async () => {
  const manifest = JSON.parse(
    await readFile("data/result-comparison-baselines.json", "utf8"),
  );
  assert.ok(
    manifest.sources
      .filter((s) => s.id !== "live" && s.status === "available")
      .every((s) => !s.appliesTo.includes("house")),
  );
  assert.ok(
    manifest.sources
      .find((s) => s.id === "pres-2024")
      .appliesTo.includes("senate"),
  );
  assert.ok(
    manifest.sources
      .find((s) => s.id === "pres-2024")
      .appliesTo.includes("governor"),
  );
});
test("Board has no site header/footer/hero, a two-item overflow, and decorative city labels", async () => {
  for (const file of ["results.html", "election-night.html"]) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(
      html,
      /<header|<footer|site-header|site-footer|election-night-hero/,
    );
    assert.match(html, /id="board-menu-button"[^>]*aria-expanded="false"/);
    assert.match(html, /Return to main site/);
    assert.match(html, /data-desk-appearance>Appearance/);
    assert.doesNotMatch(html, /Donate|Ratings|Videos|Articles/);
  }
  const js = await readFile("assets/election-night.js", "utf8");
  assert.doesNotMatch(js, /KEY_RACE_IDS|renderRaceContext/);
  assert.match(js, /\.attr\("aria-hidden", "true"\)/);
  assert.match(js, /\.attr\("pointer-events", "none"\)/);
  const css = await readFile("assets/results-board.css", "utf8");
  assert.match(css, /100dvh/);
  assert.match(css, /user-select:\s*none/);
});
test("Operator labels translate state and feed diagnostics; technical details stay in Advanced", async () => {
  for (const state of [
    "UNCALLED",
    "NBC_PENDING",
    "NBC_HELD",
    "NBC_IGNORED",
    "MANUAL_OVERRIDE",
    "NBC_AUTO_ACCEPTED",
    "MANUAL_FEA_CALL",
  ])
    assert.doesNotMatch(UI.stateLabel(state), /_/);
  assert.equal(
    UI.feedLabel({ status: "CONNECTED", stale: false }),
    "Connected",
  );
  assert.equal(
    UI.feedLabel({ status: "CONNECTION FAILED", stale: true }),
    "Results may be delayed",
  );
  const html = await readFile("admin.html", "utf8");
  assert.match(html, /data-workspace="system" class="advanced-nav">Advanced/);
  assert.match(html, /data-workspace="ticker">Broadcast/);
  assert.doesNotMatch(html, /ADMIN_SECRET/);
});

test("Manual override cards display the FEA choice, not the conflicting NBC candidate", () => {
  const p = UI.callPresentation({
    manualOverride: true,
    callState: "MANUAL_OVERRIDE",
    calls: [{ candidate: "Candidate B", source: "fea-manual" }],
    providerCall: { candidate: "Candidate A" },
  });
  assert.equal(p.candidate, "Candidate B");
  assert.equal(p.label, "FEA call");
  assert.equal(p.nbcCandidate, "Candidate A");
  assert.equal(
    UI.callPresentation({
      manualOverride: true,
      calls: [],
      providerCall: { candidate: "Candidate A" },
    }).candidate,
    "Not called",
  );
  assert.equal(
    UI.callPresentation({
      manualOverride: false,
      calls: [],
      providerCall: { candidate: "Candidate A" },
    }).candidate,
    "Candidate A",
  );
});

test('Published 2024 statewide presidential comparisons match all three FEC national controls',async()=>{
 const data=JSON.parse(await readFile('data/baselines/pres-2024-states.json','utf8'));
 assert.match(data.sourceUrl,/fec.gov/);const sum=data.states.reduce((n,r)=>{n.d+=r.demVotes;n.r+=r.repVotes;n.total+=r.totalVotes;return n;},{d:0,r:0,total:0});assert.deepEqual(sum,{d:75017613,r:77302580,total:155238302});
 const manifest=JSON.parse(await readFile('data/result-comparison-baselines.json','utf8'));assert.equal(manifest.sources.find(s=>s.id==='pres-2020').status,'unavailable');
});
