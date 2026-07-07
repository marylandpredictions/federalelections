import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { FORBIDDEN_LEGACY_FIELDS, repoPath, readJson, collectForbiddenKeys } from "../../scripts/v4/shared/v4-core.mjs";

function walk(dir) {
  const full = repoPath(dir);
  const out = [];
  for (const entry of readdirSync(full)) {
    const path = join(full, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path.slice(repoPath("").length)));
    else out.push(path);
  }
  return out;
}

test("generated canonical v4 data has no forbidden legacy top-line aliases", () => {
  for (const file of ["data/v4/house-forecast.json", "data/v4/senate-forecast.json", "data/v4/governor-forecast.json"]) {
    assert.deepEqual(collectForbiddenKeys(readJson(file)), []);
  }
});

test("legacy alias strings only appear in the v4 scanner and explicit tests", () => {
  const allowed = new Set([
    repoPath("scripts/v4/shared/v4-core.mjs").toLowerCase(),
    repoPath("tests/v4/no-legacy-field-read.test.mjs").toLowerCase(),
    repoPath("tests/v4/schema-contract.test.mjs").toLowerCase()
  ]);
  const offenders = [];
  for (const dir of ["scripts/v4", "tests/v4"]) {
    for (const file of walk(dir)) {
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN_LEGACY_FIELDS.some((field) => text.includes(field)) && !allowed.has(file.toLowerCase())) {
        offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
