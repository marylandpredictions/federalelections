import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const dataDir = new URL("data/", root);

function resolveConflictMarkers(text) {
  const lines = text.split(/\r?\n/);
  const rootFrame = { side: "ours", ours: [], theirs: [] };
  const stack = [rootFrame];
  let skippingOrphanAlternate = false;

  const currentLines = () => {
    const frame = stack.at(-1);
    return frame.side === "theirs" ? frame.theirs : frame.ours;
  };

  for (const line of lines) {
    const marker = line.trimStart();
    if (skippingOrphanAlternate) {
      if (marker.startsWith(">>>>>>>")) skippingOrphanAlternate = false;
      continue;
    }
    if (marker.startsWith("<<<<<<<")) {
      stack.push({ side: "ours", ours: [], theirs: [] });
      continue;
    }
    if (marker.startsWith("=======") && stack.length > 1) {
      stack.at(-1).side = "theirs";
      continue;
    }
    if (marker.startsWith("=======") && stack.length === 1) {
      skippingOrphanAlternate = true;
      continue;
    }
    if (marker.startsWith(">>>>>>>") && stack.length > 1) {
      const frame = stack.pop();
      const chosen = frame.theirs.length ? frame.theirs : frame.ours;
      currentLines().push(...chosen);
      continue;
    }
    if (marker.startsWith(">>>>>>>") && stack.length === 1) {
      continue;
    }
    currentLines().push(line);
  }

  while (stack.length > 1) {
    const frame = stack.pop();
    const chosen = frame.theirs.length ? frame.theirs : frame.ours;
    const parent = stack.at(-1);
    (parent.side === "theirs" ? parent.theirs : parent.ours).push(...chosen);
  }
  return rootFrame.ours.join("\n");
}

function targetFiles() {
  const explicit = process.argv.slice(2);
  if (explicit.length) return explicit;
  const found = [];
  const walk = (relativeDir) => {
    for (const entry of readdirSync(new URL(relativeDir, root))) {
      const relativePath = join(relativeDir, entry);
      const stats = statSync(new URL(relativePath.replace(/\\/g, "/"), root));
      if (stats.isDirectory()) walk(`${relativePath}/`);
      else if (entry.endsWith(".json")) found.push(relativePath);
    }
  };
  walk("data/");
  return found;
}

let repaired = 0;
let checked = 0;

for (const relativePath of targetFiles()) {
  const url = new URL(relativePath.replace(/\\/g, "/"), root);
  const original = readFileSync(url, "utf8");
  const hasConflictMarkers = /^\s*(<<<<<<<|=======|>>>>>>>)/m.test(original);
  let repairedText = original;
  if (hasConflictMarkers) {
    try {
      repairedText = resolveConflictMarkers(original);
    } catch (error) {
      throw new Error(`${relativePath} conflict repair failed: ${error.message}`);
    }
  }
  try {
    JSON.parse(repairedText);
  } catch (error) {
    throw new Error(`${relativePath} is still invalid JSON after conflict repair: ${error.message}`);
  }
  if (hasConflictMarkers) {
    writeFileSync(url, repairedText.endsWith("\n") ? repairedText : `${repairedText}\n`, "utf8");
    repaired += 1;
  }
  checked += 1;
}

console.log(`Checked ${checked} JSON files; repaired ${repaired}.`);
