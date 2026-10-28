import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  mergeRoster,
  parseLouisiana,
  genericName,
} from "./candidate-roster.mjs";
const root = new URL("../../", import.meta.url),
  read = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));
const catalogue = await read("data/election-night-races.json"),
  officialFile = "data/results/louisiana-ballot-2026.json";
let official;
if (process.argv.includes("--refresh-louisiana")) {
  const base = "https://voterportal.sos.la.gov",
    page = await (await fetch(base + "/CandidateInquiry")).text();
  const election = page.match(
    /<option[^>]*value="(\d+)"[^>]*>11\/03\/2026<\/option>/,
  )?.[1];
  if (!election) throw Error("2026 election not listed");
  const officesPage = await (
    await fetch(
      base +
        "/CandidateInquiry/StatewideCandidate/OfficeList?electionId=" +
        election,
    )
  ).text();
  const offices = [
    ...officesPage.matchAll(/<label for="cb_(\d+)">([\s\S]*?)<\/label>/g),
  ]
    .filter((m) => /U\. S\. (Senator|Representative)/.test(m[2]))
    .map((m) => m[1]);
  if (offices.length !== 7) throw Error("Federal offices incomplete");
  const body = new URLSearchParams({ electionId: election });
  for (const id of offices) body.append("officeIds", id);
  const response = await fetch(
    base + "/CandidateInquiry/StatewideCandidate/CandidateList",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!response.ok) throw Error("Official roster unavailable");
  const html = await response.text();
  official = {
    electionDate: "2026-11-03",
    retrievedAt: new Date().toISOString(),
    sourceUrl: base + "/CandidateInquiry",
    sourceSha256: createHash("sha256").update(html).digest("hex"),
    races: parseLouisiana(html),
  };
  await writeFile(
    new URL(officialFile, root),
    JSON.stringify(official, null, 2) + "\n",
  );
} else official = await read(officialFile).catch(() => ({ races: [] }));
const metadata = new Map();
for (const [kind, file, key] of [
  ["house", "data/house-forecast.json", "districts"],
  ["senate", "data/forecast.json", "races"],
  ["governor", "data/governor-forecast.json", "races"],
]) {
  const data = await read(file);
  for (const row of data[key] || []) {
    const id = kind === "house" ? "house-" + row.id : kind + "-" + row.state;
    const values = [
      ...(Array.isArray(row.candidates) ? row.candidates : []),
      { name: row.demCandidate || row.dem, party: "D" },
      { name: row.repCandidate || row.rep, party: "R" },
      ...(row.independents || []).map((c) =>
        typeof c === "string" ? { name: c, party: "I" } : c,
      ),
    ].filter((c) => !genericName(c.name));
    metadata.set(
      id,
      values.map((c) => ({ ...c, rosterSource: file })),
    );
  }
}
const reviewed = await read("data/results/reviewed-ballots-2026.json").catch(
  () => ({ races: [] }),
);
const officialRows = [...official.races, ...reviewed.races.filter(r => r.official !== false)];
const reviewedRows = reviewed.races.filter(r => r.official === false);
const removed = catalogue.races
  .flatMap((r) => r.candidates || [])
  .filter((c) => genericName(c.name)).length;
catalogue.races = catalogue.races.map((r) =>
  mergeRoster(r, {
    official: officialRows.find((o) => o.id === r.id),
    reviewed: reviewedRows.find((o) => o.id === r.id),
    metadata: metadata.get(r.id) || [],
  }),
);
const priorities = await read("data/results/candidate-summary-priorities.json");
for (const priority of priorities.races) {
  const race = catalogue.races.find(r=>r.id===priority.id);
  for (const name of priority.candidates) {
    const candidate = race?.candidates.find(c=>c.name===name || c.aliases?.includes(name));
    if (!candidate) throw Error(`Summary candidate missing from reviewed roster: ${priority.id}: ${name}`);
    candidate.summaryVisible = true;
  }
}
await writeFile(
  new URL("data/election-night-races.json", root),
  JSON.stringify(catalogue, null, 2) + "\n",
);
const audit = {
  generatedAt: new Date().toISOString(),
  genericNamesRemoved: removed,
  emptyRaces: catalogue.races.filter(r=>!r.candidates.length).map(r=>r.id),
  fillerCandidates: catalogue.races.flatMap(r=>r.candidates.filter(c=>genericName(c.name)||c.placeholder).map(c=>({id:r.id,name:c.name}))),
  reviewedRaces: catalogue.races.filter(r=>r.rosterReviewed).length,
  totalCandidates: catalogue.races.reduce((n,r)=>n+r.candidates.length,0),
  reviewedIdentityRaces: reviewedRows.map(r => ({ id: r.id, sourceUrl: r.sourceUrl, checkedAt: r.checkedAt, candidates: r.candidates.length })),
  officialRaces: officialRows.map((r) => ({
    id: r.id,
    candidates: r.candidates.length,
  })),
  uncertifiedRaces: catalogue.races
    .filter((r) => !r.rosterVerified)
    .map((r) => ({ id: r.id, candidates: r.candidates.length })),
  rule: "Identity only; probabilities, shares, winners and calls are never imported.",
};
await writeFile(
  new URL("data/results/candidate-roster-audit.json", root),
  JSON.stringify(audit, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    removed,
    official: audit.officialRaces,
    uncertified: audit.uncertifiedRaces.length,
  }),
);
