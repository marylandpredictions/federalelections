import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, relative } from "node:path";
import { parseDelimited } from "./csv.mjs";
export function buildPresidentialRows(rows, year, countyFips = new Set()) {
  const groups = new Map(),
    states = new Map(),
    invalid = [];
  for (const row of rows) {
    if (
      Number(row.year) !== year ||
      !row.state_po ||
      !/^\d+$/.test(row.county_fips)
    )
      continue;
    const key = `${row.state_po}:${row.county_fips.padStart(5, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const counties = [];
  for (const [key, group] of groups) {
    const totals = group.filter((r) => r.mode === "TOTAL");
    const chosen = totals.length ? totals : group;
    const [state, fips] = key.split(":");
    const entry = {
      state,
      fips,
      county: group[0].county_name,
      demVotes: 0,
      repVotes: 0,
      totalVotes: Math.max(...chosen.map((r) => Number(r.totalvotes) || 0)),
      valid: true,
    };
    let allCandidates = 0;
    const seen = new Set();
    for (const row of chosen) {
      if (/^(?:(?:OVER|UNDER)VOTES|TOTAL VOTES CAST)$/i.test(row.candidate))
        continue;
      const n = Number(row.candidatevotes);
      if (!Number.isSafeInteger(n) || n < 0) {
        if (["DEMOCRAT", "REPUBLICAN"].includes(row.party)) entry.valid = false;
        continue;
      }
      const id = `${row.candidate}:${row.party}`;
      if (
        totals.length &&
        seen.has(id) &&
        ["DEMOCRAT", "REPUBLICAN"].includes(row.party)
      )
        entry.valid = false;
      seen.add(id);
      allCandidates += n;
      if (row.party === "DEMOCRAT") entry.demVotes += n;
      if (row.party === "REPUBLICAN") entry.repVotes += n;
    }
    if (
      !entry.totalVotes ||
      entry.demVotes + entry.repVotes > entry.totalVotes ||
      allCandidates > entry.totalVotes
    )
      entry.valid = false;
    entry.demShare = (entry.demVotes / entry.totalVotes) * 100;
    entry.repShare = (entry.repVotes / entry.totalVotes) * 100;
    entry.margin = entry.demShare - entry.repShare;
    if (!states.has(state))
      states.set(state, {
        state,
        demVotes: 0,
        repVotes: 0,
        totalVotes: 0,
        valid: true,
      });
    const sum = states.get(state);
    for (const field of ["demVotes", "repVotes", "totalVotes"])
      sum[field] += entry[field];
    sum.valid &&= entry.valid;
    if (!entry.valid)
      invalid.push({
        state,
        fips,
        reason: "Inconsistent or duplicate source rows",
      });
    // Alaska source units are legislative reporting districts, not Census counties.
    if (entry.valid && state !== "AK" && countyFips.has(fips))
      counties.push(entry);
  }
  const stateRows = [...states.values()].map((row) => ({
    ...row,
    demShare: (row.demVotes / row.totalVotes) * 100,
    repShare: (row.repVotes / row.totalVotes) * 100,
    margin: ((row.demVotes - row.repVotes) / row.totalVotes) * 100,
  }));
  return {
    states: stateRows.sort((a, b) => a.state.localeCompare(b.state)),
    rows: counties.sort((a, b) => a.fips.localeCompare(b.fips)),
    invalid,
  };
}
export function writePresidentialBaselines(
  file = "data/baselines/source/countypres_2000-2024.csv",
  root = process.cwd(),
) {
  const input = parseDelimited(readFileSync(resolve(root, file), "utf8"));
  const geo = JSON.parse(
    readFileSync(resolve(root, "data/result-counties.geojson"), "utf8"),
  );
  const fips = new Set(geo.features.map((f) => f.properties.GEOID));
  for (const year of [2020, 2024]) {
    const data = buildPresidentialRows(input, year, fips);
    const meta = {
      source:
        "MIT Election Data and Science Lab county presidential returns; official state records",
      sourceUrl: "https://doi.org/10.7910/DVN/VOQCHQ",
      sourceFile: relative(root, resolve(root, file)).replaceAll("\\", "/"),
      sourceVersion: [...new Set(input
        .filter(row => Number(row.year) === year)
        .map(row => row.version))].sort().join(","),
      updatedAt: "2026-10-27",
      marginBasis: "all-votes",
      aggregation:
        "Use TOTAL when present; otherwise sum source ballot partitions once. Never add TOTAL to its component modes. County map excludes unmatched Census FIPS and Alaska reporting districts.",
      invalid: data.invalid,
    };
    for (const kind of ["states", "counties"])
      writeFileSync(
        resolve(root, `data/baselines/pres-${year}-${kind}.json`),
        JSON.stringify(
          {
            ...meta,
            [kind === "states" ? "states" : "rows"]:
              data[kind === "states" ? "states" : "rows"],
          },
          null,
          2,
        ) + "\n",
      );
    if (year === 2024) {
      const official = JSON.parse(readFileSync(
        resolve(root, "data/baselines/source/fec-president-2024-states.json"), "utf8",
      ));
      const keys = ["demVotes", "repVotes", "totalVotes"];
      const checks = official.states.reduce((sum, row) => {
        for (const key of keys) sum[key] += row[key];
        return sum;
      }, { demVotes: 0, repVotes: 0, totalVotes: 0 });
      if (official.states.length !== 51 || checks.demVotes !== 75017613 ||
          checks.repVotes !== 77302580 || checks.totalVotes !== 155238302)
        throw new Error("Official FEC statewide controls do not match");
      const differences = official.states.flatMap(row => {
        const county = data.states.find(r => r.state === row.state);
        const delta = {};
        for (const key of keys)
          if (county?.[key] !== row[key]) delta[key] = (county?.[key] || 0) - row[key];
        return Object.keys(delta).length
          ? [{ state: row.state, countyMinusOfficial: delta }] : [];
      });
      writeFileSync(resolve(root, "data/baselines/pres-2024-states.json"), JSON.stringify({
        ...official,
        updatedAt: "2026-10-27",
        marginBasis: "all-votes",
        countyAggregationDifferences: differences,
        states: official.states.map(row => ({
          ...row,
          demShare: row.demVotes / row.totalVotes * 100,
          repShare: row.repVotes / row.totalVotes * 100,
          margin: (row.demVotes - row.repVotes) / row.totalVotes * 100,
        })),
      }, null, 2) + "\n");
    }
    console.log(
      year,
      "states",
      data.states.length,
      "invalid",
      data.states.filter((r) => !r.valid).map((r) => r.state),
      "counties",
      data.rows.length,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  writePresidentialBaselines();
