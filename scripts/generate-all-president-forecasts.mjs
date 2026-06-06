import { execSync } from "node:child_process";

const DEM_CANDIDATES = ["newsom", "beshear", "shapiro", "buttigieg", "harris", "aoc"];
const REP_CANDIDATES = ["vance", "rubio", "desantis", "haley", "cruz"];

for (const dem of DEM_CANDIDATES) {
  for (const rep of REP_CANDIDATES) {
    console.log(`Generating president-forecast-${dem}-${rep}.json`);
    try {
      execSync(`node scripts/generate-president-forecast.mjs ${dem} ${rep}`, {
        cwd: process.cwd(),
        stdio: "inherit"
      });
    } catch (error) {
      console.error(`Failed to generate ${dem}-${rep}:`, error.message);
    }
  }
}

console.log("All presidential forecasts generated");
