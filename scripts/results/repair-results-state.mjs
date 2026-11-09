import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), process.argv[2] || ".runtime/results-state.json");
const raw = readFileSync(path, "utf8");
let depth = 0;
let inStr = false;
let esc = false;
let end = -1;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === "\"") inStr = false;
    continue;
  }
  if (c === "\"") {
    inStr = true;
    continue;
  }
  if (c === "{") depth++;
  else if (c === "}") {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
if (end < 0) throw new Error(`No complete JSON object in ${path}`);
const sliced = raw.slice(0, end + 1);
const parsed = JSON.parse(sliced);
console.log(`firstObjectEnd=${end} total=${raw.length} extra=${raw.length - end - 1} races=${Object.keys(parsed.races || {}).length}`);
if (end + 1 >= raw.length) {
  console.log("No trailing garbage; leaving file unchanged.");
  process.exit(0);
}
copyFileSync(path, `${path}.corrupt-bak`);
writeFileSync(path, sliced);
console.log(`Wrote truncated ${path} and backup ${path}.corrupt-bak`);
