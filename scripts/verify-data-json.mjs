import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];

function dataJsonFiles() {
  const found = [];
  const walk = (relativeDir) => {
    for (const entry of readdirSync(resolve(root, relativeDir))) {
      const relativePath = join(relativeDir, entry);
      const stats = statSync(resolve(root, relativePath));
      if (stats.isDirectory()) walk(`${relativePath}/`);
      else if (entry.endsWith(".json")) found.push(relativePath);
    }
  };
  walk("data/");
  return found;
}

for (const file of dataJsonFiles()) {
  const text = readFileSync(resolve(root, file), "utf8");
  if (/^\s*(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    failures.push(`${file} contains unresolved Git conflict markers`);
    continue;
  }
  try {
    JSON.parse(text);
  } catch (error) {
    failures.push(`${file} is not valid JSON: ${error.message}`);
  }
}

if (failures.length) {
  console.error("Data JSON validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Data JSON validation passed.");
