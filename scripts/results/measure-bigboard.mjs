import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
const read = (f) => readFileSync(f),
  before = (f) =>
    execFileSync("git", ["show", "HEAD:" + f], { maxBuffer: 50e6 });
const assets = (html) =>
  [
    ...html.matchAll(
      /(?:src|href)="(assets\/[^"?]+\.(?:js|css))(?:\?[^\"]*)?"/g,
    ),
  ].map((m) => m[1]);
const maps = JSON.parse(read("data/results/map-assets.json"));
const shared = [
  "data/results/map-assets.json",
  "data/election-night-watchlist.json",
  "data/result-comparison-baselines.json",
  "data/baselines/pres-2024-states.json",
  maps.states,
  maps.house,
  maps.highways,
];
const calc = (files, reader) =>
  files.map((file) => {
    const b = reader(file);
    return {
      file,
      raw: b.length,
      encoded: file.endsWith(".gz")
        ? b.length
        : gzipSync(b, { level: 9 }).length,
    };
  });
const sum = (rows) => ({
  requests: rows.length,
  raw: rows.reduce((n, r) => n + r.raw, 0),
  encoded: rows.reduce((n, r) => n + r.encoded, 0),
});
const oldRows = calc(
  ["results.html", ...assets(before("results.html").toString()), ...shared],
  before,
);
const newRows = calc(
  [
    "results.html",
    ...assets(read("results.html").toString()),
    ...shared,
    "data/results/poll-closes.json",
  ],
  read,
);
const result = {
  measuredAt: new Date().toISOString(),
  scope:
    "Own required static resources for national House; precompressed map bytes retained, gzip level 9 for other resources. Excludes API response, external CDN libraries, fonts, icon and HTTP headers. Reuses existing display geometry.",
  before: sum(oldRows),
  after: sum(newRows),
  rows: { before: oldRows, after: newRows },
};
const base = process.argv.find((x) => x.startsWith("--url="))?.slice(6);
if (base) {
  const response = await fetch(base + "/api/live-results");
  const bytes = Buffer.from(await response.arrayBuffer());
  const etag = (await fetch(base + "/api/results-version")).headers.get("etag");
  const unchanged = await fetch(base + "/api/results-version", {
    headers: { "If-None-Match": etag },
  });
  result.http = {
    summaryDecoded: bytes.length,
    summaryEqualGzip: gzipSync(bytes).length,
    versionStatus: unchanged.status,
    versionBodyBytes: (await unchanged.arrayBuffer()).byteLength,
    summaryCacheControl: response.headers.get("cache-control"),
    summaryContentEncoding: response.headers.get("content-encoding"),
    summaryContentLength: response.headers.get("content-length"),
  };
  const polls = [];
  for (let i = 0; i < 10; i++) {
    const poll = await fetch(base + "/api/results-version", { headers: { "If-None-Match": etag } });
    polls.push({ status: poll.status, bodyBytes: (await poll.arrayBuffer()).byteLength });
  }
  result.http.unchangedPolls = polls;
}
writeFileSync(
  "docs/bigboard-performance.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { before: result.before, after: result.after, http: result.http },
    null,
    2,
  ),
);
