import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fetchCensusSummary } from "./census-summary.mjs";
const variables = [
  "NAME",
  "B01003_001E",
  "B03002_003E",
  "B02001_003E",
  "B03003_003E",
  "B02001_005E",
  ...[20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49].map(
    (n) => `B01001_${String(n).padStart(3, "0")}E`,
  ),
  "B15003_001E",
  ...[22, 23, 24, 25].map((n) => `B15003_${String(n).padStart(3, "0")}E`),
  "B19013_001E",
];
const number = (value) =>
  Number.isFinite(Number(value)) &&
  value !== null &&
  value !== "" &&
  Number(value) >= 0
    ? Number(value)
    : null;
export function censusKeyFromEnv(text) {
  return (
    text
      .match(/^CENSUS_API_KEY[ \t]*=[ \t]*([^\r\n]+)$/m)?.[1]
      .trim()
      .replace(/^["']|["']$/g, "") || ""
  );
}
export function normalizeDemographics(table) {
  if (!Array.isArray(table) || !Array.isArray(table[0]))
    throw Error("Expected an official Census API JSON table");
  const [header, ...rows] = table,
    result = {};
  for (const cells of rows) {
    const r = Object.fromEntries(header.map((key, i) => [key, cells[i]]));
    const population = number(r.B01003_001E);
    const pct = (value, base = population) =>
      value !== null && base > 0
        ? Math.round((value / base) * 1000) / 10
        : null;
    const sum = (keys) =>
      keys.every((key) => number(r[key]) !== null)
        ? keys.reduce((s, key) => s + number(r[key]), 0)
        : null;
    const state = String(r.state || "").padStart(2, "0"),
      fips = state + (r.county || "");
    result[fips] = {
      name: r.NAME,
      population,
      whiteNH: pct(number(r.B03002_003E)),
      black: pct(number(r.B02001_003E)),
      hispanic: pct(number(r.B03003_003E)),
      asian: pct(number(r.B02001_005E)),
      age65: pct(sum(variables.filter((key) => key.startsWith("B01001_")))),
      bachelors: pct(
        sum(
          [22, 23, 24, 25].map((n) => `B15003_${String(n).padStart(3, "0")}E`),
        ),
        number(r.B15003_001E),
      ),
      income: number(r.B19013_001E),
    };
  }
  return result;
}
export async function buildDemographics({
  key = process.env.CENSUS_API_KEY,
  countyFile,
  stateFile,
  bulk = false,
} = {}) {
  async function get(geography, file) {
    if (file) return JSON.parse(readFileSync(file, "utf8"));
    if (!key)
      throw Error(
        "Configure CENSUS_API_KEY locally, or supply --counties and --states official Census API JSON exports.",
      );
    const url = new URL("https://api.census.gov/data/2024/acs/acs5");
    url.searchParams.set("get", variables.join(","));
    url.searchParams.set("for", geography + ":*");
    url.searchParams.set("key", key);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("json"))
      throw Error(
        "Census did not return JSON. Check API credentials and service availability.",
      );
    return response.json();
  }
  const summary =
    bulk || (!key && !countyFile && !stateFile)
      ? await fetchCensusSummary(variables)
      : null;
  const counties = normalizeDemographics(
      summary?.counties || (await get("county", countyFile)),
    ),
    states = normalizeDemographics(
      summary?.states || (await get("state", stateFile)),
    );
  if (Object.keys(counties).length < 3000 || Object.keys(states).length < 51)
    throw Error("Incomplete national Census export; existing output preserved");
  if (
    summary &&
    Object.entries(states)
      .filter(([id]) => id !== "72")
      .reduce((sum, [, r]) => sum + r.population, 0) !==
      summary.controls.usPopulation
  )
    throw Error(
      "State population sum does not match the official Census U.S. control",
    );
  const output = {
    source: "U.S. Census Bureau, 2024 ACS 5-year estimates",
    sourceUrl:
      "https://www.census.gov/data/developers/data-sets/acs-5year.html",
    vintage: 2024,
    builtAt: new Date().toISOString(),
    status: "available",
    variables,
    method: summary
      ? "Official Census table-based summary files; bounded downloads through complete state/county blocks"
      : countyFile
        ? "Official Census API JSON exports"
        : "Official Census API",
    ...(summary
      ? { sourceFiles: summary.sourceFiles, sourceControls: summary.controls }
      : {}),
    definitions: {
      whiteNH: "White alone, not Hispanic or Latino",
      black: "Black alone, any ethnicity",
      asian: "Asian alone, any ethnicity",
      hispanic: "Hispanic or Latino, any race",
      age65: "Age 65 and older / total population",
      bachelors: "Bachelor's degree or higher / population age 25 and older",
      income: "Median household income, 2024 inflation-adjusted dollars",
    },
    counties,
    states,
  };
  mkdirSync("data/results", { recursive: true });
  const encoded = JSON.stringify(output),
    hash = createHash("sha256").update(encoded).digest("hex").slice(0, 12),
    file = `data/results/county-demographics.${hash}.json.gz`;
  writeFileSync("data/results/county-demographics.min.json", encoded);
  writeFileSync(file, gzipSync(encoded, { level: 9 }));
  writeFileSync(
    "data/results/demographics.json",
    JSON.stringify({
      status: "available",
      vintage: 2024,
      builtAt: output.builtAt,
      file,
    }) + "\n",
  );
  console.log(
    `Built ${Object.keys(counties).length} counties and ${Object.keys(states).length} direct statewide estimates.`,
  );
  return output;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Optional local .env, never logged or copied into the artifact.
  if (!process.env.CENSUS_API_KEY)
    try {
      process.env.CENSUS_API_KEY = censusKeyFromEnv(
        readFileSync(".env", "utf8"),
      );
    } catch {}
  const arg = (name) =>
    process.argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
  buildDemographics({
    countyFile: arg("counties"),
    stateFile: arg("states"),
    bulk: process.argv.includes("--bulk"),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
