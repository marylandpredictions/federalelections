import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

const RATING_TO_INTERVAL = {
  "Safe D": { party: "D", low: 14, center: 19, high: 30 },
  "Solid D": { party: "D", low: 14, center: 19, high: 30 },
  "Likely D": { party: "D", low: 7, center: 10, high: 14 },
  "Lean D": { party: "D", low: 3, center: 5, high: 7 },
  "Tilt D": { party: "D", low: 0.5, center: 1.5, high: 3 },
  "Toss-up": { party: "T", low: -1.5, center: 0, high: 1.5 },
  "Tossup": { party: "T", low: -1.5, center: 0, high: 1.5 },
  "Tilt R": { party: "R", low: -3, center: -1.5, high: -0.5 },
  "Lean R": { party: "R", low: -7, center: -5, high: -3 },
  "Likely R": { party: "R", low: -14, center: -10, high: -7 },
  "Safe R": { party: "R", low: -30, center: -19, high: -14 },
  "Solid R": { party: "R", low: -30, center: -19, high: -14 }
};

function readJson(path, fallback = null) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ratingToPriorInterval(rating) {
  return RATING_TO_INTERVAL[String(rating || "").trim()] || null;
}

function sourceRows(office) {
  const payload = readJson(`data/cache/ratings/${office}-2026.json`, { rows: [] });
  return {
    payload,
    rows: Array.isArray(payload?.rows) ? payload.rows : []
  };
}

function buildOffice(office) {
  const { payload, rows } = sourceRows(office);
  const priors = rows.map((row) => {
    const rating = row.rating || row.consensusRating || row.sources?.cook?.rating || null;
    const interval = ratingToPriorInterval(rating);
    return {
      raceId: row.raceId || row.id || row.district || row.state || null,
      state: row.state || String(row.raceId || "").slice(0, 2) || null,
      district: row.district || null,
      office,
      rating,
      sourceCount: row.sourceCount || Object.keys(row.sources || {}).length || 0,
      status: interval ? "OK_PARSED" : "NO_RATING_INTERVAL",
      prior: interval ? {
        marginType: "expert-rating-prior-interval",
        demMarginLow: interval.low,
        demMarginCenter: interval.center,
        demMarginHigh: interval.high,
        party: interval.party,
        effectiveWeight: row.status === "DISABLED" ? 0 : Number(row.effectiveWeight ?? row.weight ?? 0.18)
      } : null,
      sources: row.sources || null,
      warnings: row.status === "DISABLED" ? ["rating-source-disabled-for-current-map-conflict"] : (row.warnings || [])
    };
  });
  return {
    schemaVersion: "2026.ratings-priors.1",
    generatedAt: new Date().toISOString(),
    office,
    source: `data/cache/ratings/${office}-2026.json`,
    sourceStatus: payload.status || (payload.readError ? "READ_ERROR" : "OK"),
    counts: {
      rows: priors.length,
      withIntervals: priors.filter((row) => row.prior).length,
      disabledWeight: priors.filter((row) => row.prior?.effectiveWeight === 0).length
    },
    rows: priors
  };
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  for (const office of ["senate", "house", "governor"]) {
    const output = buildOffice(office);
    writeJson(`data/staging/ratings/${office}-rating-priors-2026.json`, output);
    writeJson(`data/cache/ratings/${office}-ratings-priors-2026.json`, output);
    console.log(`Wrote ${office} rating priors: ${output.counts.withIntervals}/${output.counts.rows} intervals.`);
  }
}
