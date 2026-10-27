import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync, gunzipSync, brotliCompressSync, constants } from "node:zlib";
import { ResultsChangeFeed } from "./change-feed.mjs";
const size = (body) => ({
  raw: body.length,
  gzip: gzipSync(body, { level: 9 }).length,
  brotli: brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
  }).length,
});
const before = (file) => {
  let body = execFileSync("git", ["show", `HEAD:${file}`], {
    maxBuffer: 50 * 1024 * 1024,
  });
  if (
    existsSync(file) &&
    readFileSync(file).includes(Buffer.from("\r\n")) &&
    !body.includes(Buffer.from("\r\n"))
  )
    body = Buffer.from(body.toString().replaceAll("\n", "\r\n"));
  return body;
};
const read = (file) => readFileSync(file);
const assets = JSON.parse(read("data/results/map-assets.json"));
const unpack = (file) =>
  file.endsWith(".gz") ? gunzipSync(read(file)) : read(file);
const old = JSON.parse(before("data/live-results.json")),
  feed = new ResultsChangeFeed();
feed.update(old);
const current = feed.full(old);
const pairs = [
  ["Initial HTML", "results.html", "results.html"],
  ["Shared CSS", "assets/wiki.css", "assets/wiki.css"],
  ["Board CSS", "assets/results-board.css", "assets/results-board.css"],
  [
    "Map interaction JS",
    "assets/election-night.js",
    "assets/election-night.js",
  ],
  ["State geometry", "data/result-us-states.geojson", assets.states],
  ["House geometry", "data/house-districts-119.geojson", assets.house],
  [
    "National county geometry → Ohio on demand",
    "data/result-counties.geojson",
    assets.counties["39"],
  ],
  [
    "Highways → national display lines",
    "data/result-major-highways.geojson",
    assets.highways,
  ],
];
const rows = pairs.map(([label, a, b]) => ({
  label,
  before: { file: a, ...size(before(a)) },
  after: {
    file: b,
    ...size(unpack(b)),
    ...(b.endsWith(".gz") ? { precompressedTransfer: read(b).length } : {}),
  },
}));
rows.push({
  label: "National summary (wire JSON, not pretty snapshot)",
  before: size(Buffer.from(JSON.stringify(old))),
  after: size(Buffer.from(JSON.stringify(current))),
});
for (const file of [
  "assets/results-desk.js",
  "assets/results-desk-board.js",
  "data/results/county-demographics.min.json",
])
  if (existsSync(file)) rows.push({ label: file, after: size(read(file)) });
const html = read("results.html").toString();
const oldInitialFiles = [
  "results.html",
  "assets/theme.js",
  "assets/wiki.css",
  "assets/results-board.css",
  "assets/results-ui.js",
  "assets/election-night.js",
  "data/election-night-races.json",
  "data/result-county-descriptions.json",
  "data/result-comparison-baselines.json",
  "data/result-analysis-notes.json",
  "data/election-night-watchlist.json",
  "data/baselines/pres-2024-states.json",
  "data/baselines/pres-2024-counties.json",
  "data/result-us-states.geojson",
  "data/house-districts-119.geojson",
  "data/result-major-highways.geojson",
];
const newInitialFiles = [
  "results.html",
  "assets/theme.js",
  "assets/wiki.css",
  "assets/results-board.css",
  "assets/results-ui.js",
  "assets/results-desk.js",
  "assets/results-desk-board.js",
  "assets/election-night.js",
  "data/results/map-assets.json",
  "data/election-night-watchlist.json",
  "data/result-comparison-baselines.json",
  "data/baselines/pres-2024-states.json",
  assets.states,
  assets.house,
  assets.highways,
];
const totals = (files, reader) =>
  files.reduce(
    (sum, file) => {
      const b = reader(file),
        s = size(b);
      for (const key of Object.keys(s)) sum[key] += s[key];
      return sum;
    },
    { raw: 0, gzip: 0, brotli: 0 },
  );
const initialBefore = totals(oldInitialFiles, before),
  initialAfter = totals(newInitialFiles, unpack);
const summaryBefore = size(Buffer.from(JSON.stringify(old))),
  summaryAfter = size(Buffer.from(JSON.stringify(current)));
for (const key of ["raw", "gzip", "brotli"]) {
  initialBefore[key] += summaryBefore[key];
  initialAfter[key] += summaryAfter[key];
}
const version = feed.current.version,
  empty = feed.changes(version);
const changed = structuredClone(old);
changed.groups[0].races[0].candidates[0].votes += 100;
feed.update(changed);
const delta = feed.changes(version);
const report = {
  builtAt: new Date().toISOString(),
  method:
    "Before is HEAD; after is working tree. Compression sizes are local gzip level 9 / Brotli quality 4. Initial House totals exclude external D3/TopoJSON/font/icon requests and before's idle preloads of up to 16 district maps; excludes HTTP headers. Ohio is a representative lazy statewide selection, not a national county-file replacement. Render production traffic is not measured.",
  rows,
  initialHouse: {
    before: { requests: oldInitialFiles.length + 1, ...initialBefore },
    after: { requests: newInitialFiles.length + 1, ...initialAfter },
  },
  polling: {
    seconds: 15,
    beforeFull: summaryBefore,
    unchangedVersionResponseBody: 0,
    versionResponse: size(Buffer.from(JSON.stringify(feed.metadata()))),
    noChanges: size(Buffer.from(JSON.stringify(empty))),
    oneRaceDelta: size(Buffer.from(JSON.stringify(delta))),
    fullRecovery: summaryAfter,
  },
  htmlBytes: Buffer.byteLength(html),
};
mkdirSync("docs", { recursive: true });
writeFileSync(
  "docs/election-desk-payloads.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.initialHouse, null, 2));
console.log(JSON.stringify(report.polling, null, 2));
