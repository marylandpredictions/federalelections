import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const resultSignature = (row) =>
  JSON.stringify([
    row.expectedVotePercent ?? row.estimatedVoteReporting ?? null,
    row.reportingPercent ?? row.percentReporting ?? null,
    (row.candidates || [])
      .map((c) => [c.name, c.partyCode || c.party, c.votes])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ]);
export function historyPoint(row, at = new Date().toISOString()) {
  return {
    at,
    sourceUpdatedAt: row.lastUpdated || row.updatedAt || "",
    expectedVotePercent:
      row.expectedVotePercent ?? row.estimatedVoteReporting ?? null,
    precinctReporting: row.reportingPercent ?? row.percentReporting ?? null,
    candidates: (row.candidates || []).map((c) => ({
      name: c.name,
      party: c.partyCode || c.party,
      votes: c.votes,
    })),
  };
}
// One sparse row per changed county. No unchanged county state is appended.
export class CountyHistory {
  constructor(root) {
    this.directory = join(root, ".runtime", "county-history");
    this.latest = new Map();
  }
  record(race, at = new Date().toISOString()) {
    if (!/^[\w-]+$/.test(race.id)) throw Error("Invalid race ID");
    if (!this.latest.has(race.id)) {
      this.latest.set(race.id, new Map());
    }
    const previous = this.latest.get(race.id),
      changes = [];
    for (const county of race.counties || []) {
      if (String(county.type || "County").toLowerCase() !== "county") continue;
      if (!/^\d{5}$/.test(county.fips)) continue;
      if (!previous.has(county.fips)) {
        const prior = this.read(race.id, county.fips).at(-1);
        previous.set(county.fips, prior ? resultSignature(prior) : null);
      }
      const signature = resultSignature(county);
      if (previous.get(county.fips) === signature) continue;
      if (
        !(county.candidates || []).some((c) => c.votes > 0) &&
        previous.get(county.fips) === null
      )
        continue;
      changes.push({ fips: county.fips, ...historyPoint(county, at) });
      previous.set(county.fips, signature);
    }
    if (changes.length) {
      mkdirSync(join(this.directory, race.id), { recursive: true });
      for (const row of changes)
        appendFileSync(
          join(this.directory, race.id, `${row.fips}.ndjson`),
          JSON.stringify(row) + "\n",
        );
    }
    return changes;
  }
  read(id, fips = "") {
    if (!/^[\w-]+$/.test(id) || !/^\d{5}$/.test(fips)) return [];
    try {
      return readFileSync(join(this.directory, id, `${fips}.ndjson`), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const row = JSON.parse(line);
            return !fips || row.fips === fips ? [row] : [];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
}
