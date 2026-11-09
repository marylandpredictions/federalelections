/**
 * Offline hydrate: pull NBC county pages for every House race missing counties,
 * persist detail files, and write a static national aggregate for the atlas.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { getResultsControl } from "./control.mjs";
import { buildRaceResultDetailWithHistory, buildLiveResults, writeLiveResultsSnapshot } from "../generate-live-results.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const detailDir = resolve(root, "data", "live-results-races");
const outJson = resolve(root, "data", "election-night-house-counties.json");
const outGz = resolve(root, "data", "election-night-house-counties.json.gz");
const BATCH = Math.max(4, Math.min(24, Number(process.env.HOUSE_COUNTY_BATCH) || 16));
const PASSES = Math.max(1, Math.min(40, Number(process.env.HOUSE_COUNTY_PASSES) || 24));

function choroplethFips(fips) {
  const id = String(fips || "");
  if (/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id) || id === "AK-OA") return id;
  if (/^\d{5}$/.test(id)) return id;
  if (/^\d{10}$/.test(id)) return id.slice(0, 5);
  return "";
}

function fold(byFips, detail) {
  for (const county of detail?.counties || []) {
    const fips = choroplethFips(county?.fips);
    if (!fips) continue;
    const row = byFips.get(fips) || { fips, name: /^\d{5}$/.test(String(county.fips)) ? (county.name || fips) : fips, D: 0, R: 0, other: 0 };
    if (/^\d{5}$/.test(String(county.fips)) && county.name) row.name = county.name;
    for (const candidate of county.candidates || []) {
      const votes = Number(candidate.votes);
      if (!Number.isSafeInteger(votes) || votes < 0) continue;
      const code = String(candidate.partyCode || candidate.party || "").toUpperCase();
      row[code === "D" || code === "R" ? code : "other"] += votes;
    }
    byFips.set(fips, row);
  }
}

async function readDetail(id) {
  try {
    return JSON.parse(await readFile(resolve(detailDir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function writeAggregate(races) {
  const byFips = new Map();
  let withCounties = 0;
  let missing = 0;
  for (const race of races) {
    const detail = await readDetail(race.id);
    if (!detail?.counties?.length) {
      missing++;
      continue;
    }
    withCounties++;
    fold(byFips, detail);
  }
  const payload = {
    state: null,
    counties: [...byFips.values()],
    racesWithCounties: withCounties,
    racesMissingCounties: missing,
    hydratedThisPass: 0,
    updatedAt: new Date().toISOString(),
    version: `static-house-counties:${withCounties}:${byFips.size}`
  };
  await mkdir(dirname(outJson), { recursive: true });
  const encoded = JSON.stringify(payload);
  await writeFile(outJson, encoded, "utf8");
  await writeFile(outGz, gzipSync(Buffer.from(encoded)), "utf8");
  return payload;
}

async function main() {
  const control = await getResultsControl();
  // Refresh top-line race list so votes/pages are current before county fan-out.
  try {
    await control.poll();
  } catch (error) {
    console.warn(`poll skipped: ${error.message}`);
  }

  const publicResults = await buildLiveResults();
  const house = (publicResults.groups || [])
    .flatMap((group) => group.races || [])
    .filter((race) => race.type === "house");

  let missing = [];
  for (const race of house) {
    const detail = await readDetail(race.id);
    const runtime = control.runtime?.races?.[race.id];
    if (detail?.counties?.length || runtime?.counties?.length) continue;
    missing.push(race.id);
  }
  console.log(`House races=${house.length}; missing counties=${missing.length}; batch=${BATCH}`);

  for (let pass = 1; pass <= PASSES && missing.length; pass++) {
    const batch = missing.slice(0, BATCH);
    console.log(`Pass ${pass}/${PASSES}: hydrating ${batch.length} (remaining ${missing.length})`);
    try {
      await control.loadCountyResultsBatch(batch);
    } catch (error) {
      console.warn(`batch failed: ${error.message}`);
    }
    for (const id of batch) {
      try {
        await buildRaceResultDetailWithHistory(id, { persist: true });
      } catch (error) {
        console.warn(`persist ${id}: ${error.message}`);
      }
    }
    // Brief pause so NBC rate limits can clear between batches.
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
    missing = [];
    for (const race of house) {
      const detail = await readDetail(race.id);
      const runtime = control.runtime?.races?.[race.id];
      if (detail?.counties?.length || runtime?.counties?.length) continue;
      missing.push(race.id);
    }
    console.log(`  after pass: still missing ${missing.length}`);
  }

  // Persist any runtime counties that detail files still lack.
  for (const race of house) {
    const detail = await readDetail(race.id);
    if (detail?.counties?.length) continue;
    if (!control.runtime?.races?.[race.id]?.counties?.length) continue;
    try {
      await buildRaceResultDetailWithHistory(race.id, { persist: true });
    } catch (error) {
      console.warn(`late persist ${race.id}: ${error.message}`);
    }
  }

  try {
    await writeLiveResultsSnapshot(await buildLiveResults(), { details: false });
  } catch (error) {
    console.warn(`snapshot: ${error.message}`);
  }

  const aggregate = await writeAggregate(house);
  console.log(
    `Wrote ${outJson} and .gz — counties=${aggregate.counties.length} with=${aggregate.racesWithCounties} missing=${aggregate.racesMissingCounties}`
  );
  if (missing.length) {
    console.warn(`Still missing county pages for ${missing.length} races (e.g. ${missing.slice(0, 8).join(", ")})`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
