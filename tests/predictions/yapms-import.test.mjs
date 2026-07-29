import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../assets/admin-predictions.js", import.meta.url), "utf8");
const instrumented = source.replace(
  /\n\s*init\(\);\s*\n\}\)\(\);\s*$/,
  `
  globalThis.__yapmsImportTest = {
    state,
    canonicalRaceToken,
    importedRating,
    extractYapmsRatings,
    applyImportedRatings
  };
})();`
);

const classList = { add() {}, remove() {}, toggle() {} };
const context = {
  console,
  fetch: async () => {
    throw new Error("Network access is not expected in this test.");
  },
  localStorage: { getItem: () => "", setItem() {} },
  document: {
    body: { classList },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => []
  },
  window: {
    FeaPredictionMaps: {
      allowedRatings: [
        "Safe Democratic", "Likely Democratic", "Lean Democratic", "Tilt Democratic",
        "Tossup",
        "Tilt Independent", "Lean Independent", "Likely Independent", "Safe Independent",
        "Tilt Republican", "Lean Republican", "Likely Republican", "Safe Republican"
      ],
      normalizeRating: (value) => String(value || "Tossup"),
      ratingParty: (rating) => rating.includes("Democratic") ? "D"
        : rating.includes("Republican") ? "R"
          : rating.includes("Independent") ? "I"
            : "Tossup"
    },
    addEventListener() {},
    setTimeout
  },
  setTimeout,
  clearTimeout,
  structuredClone
};

vm.createContext(context);
vm.runInContext(instrumented, context, { filename: "admin-predictions.js" });

const importer = context.__yapmsImportTest;

test("YAPms importer accepts party aliases, normalizes district IDs, and preserves candidates", () => {
  importer.state.office = "house";
  importer.state.data = {
    races: [
      { raceId: "CA-01", state: "CA", district: 1, prediction: { rating: "Tossup" }, candidates: [{ name: "Candidate A" }] },
      { raceId: "CA-02", state: "CA", district: 2, prediction: { rating: "Tossup" }, candidates: [{ name: "Candidate B" }] },
      { raceId: "CA-03", state: "CA", district: 3, prediction: { rating: "Tossup" }, candidates: [{ name: "Candidate C" }] },
      { raceId: "TX-01", state: "TX", district: 1, prediction: { rating: "Tossup" }, candidates: [{ name: "Candidate D" }] },
      { raceId: "TX-02", state: "TX", district: 2, prediction: { rating: "Tossup" }, candidates: [{ name: "Candidate E" }] },
      { raceId: "NE-02", state: "NE", district: 2, prediction: { rating: "Safe Republican" }, candidates: [{ name: "Candidate F" }] }
    ]
  };

  const candidatesBefore = JSON.stringify(importer.state.data.races.map((race) => race.candidates));
  const payload = {
    tossup: { id: "t", name: "Tossup", margins: [{ color: "#cccccc" }] },
    candidates: [
      { id: "d1", name: "Democrats", margins: [{ color: "#1c408c" }] },
      { id: "d2", name: "Democrat", margins: [{ color: "#1c408c" }] },
      { id: "d3", name: "Democratic", margins: [{ color: "#1c408c" }] },
      { id: "r1", name: "Republicans", margins: [{ color: "#bf1d29" }] },
      { id: "r2", name: "Republican", margins: [{ color: "#bf1d29" }] }
    ],
    regions: [
      { id: "CA-1", candidates: [{ id: "d1", count: 1, margin: 0 }] },
      { id: "CA-2", candidates: [{ id: "d2", count: 1, margin: 1 }] },
      { id: "CA-3", candidates: [{ id: "d3", count: 1, margin: 2 }] },
      { id: "TX-1", candidates: [{ id: "r1", count: 1, margin: 3 }] },
      { id: "TX-2", candidates: [{ id: "r2", count: 1, margin: 0 }] },
      { id: "NE-2", candidates: [{ id: "t", count: 1, margin: 0 }] }
    ]
  };

  const result = importer.extractYapmsRatings(payload);
  assert.deepEqual(
    Object.fromEntries(result.matches),
    {
      "CA-01": "Safe Democratic",
      "CA-02": "Likely Democratic",
      "CA-03": "Lean Democratic",
      "TX-01": "Tilt Republican",
      "TX-02": "Safe Republican",
      "NE-02": "Tossup"
    }
  );
  assert.equal(importer.applyImportedRatings(result.matches), 6);
  assert.equal(JSON.stringify(importer.state.data.races.map((race) => race.candidates)), candidatesBefore);
});

test("current YAPms House geometry contains every FEA House race exactly once", async () => {
  const [svgSource, predictionsSource] = await Promise.all([
    readFile(new URL("../../data/maps/yapms/usa-house-2026153-blank.svg", import.meta.url), "utf8"),
    readFile(new URL("../../data/predictions/2026-house-predictions.json", import.meta.url), "utf8")
  ]);
  const predictions = JSON.parse(predictionsSource);
  const regionGroup = svgSource.match(/<g\b[^>]*map-type="regions"[^>]*>([\s\S]*?)<\/g>/i)?.[1] || "";
  const pathTags = [...regionGroup.matchAll(/<path\b[^>]*>/gi)].map((match) => match[0]);
  const normalizeKey = (value) => {
    const match = String(value || "").toUpperCase().match(/^([A-Z]{2})-(AL|\d{1,2})$/);
    if (!match) return "";
    return `${match[1]}-${match[2] === "AL" || Number(match[2]) === 0 ? "AL" : String(Number(match[2])).padStart(2, "0")}`;
  };
  const mapKeys = pathTags
    .filter((tag) => !/\bdisabled="true"/i.test(tag))
    .map((tag) => {
      const shortName = tag.match(/\bshort-name="([^"]+)"/i)?.[1] || "";
      const region = tag.match(/\bregion="([^"]+)"/i)?.[1] || "";
      return normalizeKey(shortName) || normalizeKey(region);
    })
    .filter(Boolean);
  const raceKeys = predictions.races.map((race) => normalizeKey(race.raceId));

  assert.equal(mapKeys.length, 435);
  assert.equal(new Set(mapKeys).size, 435);
  assert.equal(raceKeys.length, 435);
  assert.deepEqual([...new Set(raceKeys.filter((key) => !mapKeys.includes(key)))], []);
  assert.deepEqual([...new Set(mapKeys.filter((key) => !raceKeys.includes(key)))], []);
});
