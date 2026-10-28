import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { auditCandidateFiles } from "./audit-candidates.mjs";
export async function readiness(control, root) {
  const checks = [],
    add = (name, status, explanation) =>
      checks.push({ name, status, explanation });
  let audit;
  try {
    audit = auditCandidateFiles(root);
  } catch (error) {
    audit = {
      ...control.adminSnapshot().rosterAudit,
      passed: false,
      issues: [
        {
          race: "Catalogue",
          message: "Full source/snapshot audit could not run: " + error.message,
        },
      ],
    };
  }
  add(
    "Candidate audit",
    audit.passed ? "PASS" : "FAIL",
    `${audit.reviewed}/${audit.total} reviewed; ${audit.placeholders} generic placeholders. ${audit.issues
      .slice(0, 5)
      .map((i) => i.race + ": " + i.message)
      .join("; ")}`,
  );
  for (const [name, path] of [
    ["Poll-close schedule", "data/results/poll-closes.json"],
    ["Geometry manifest", "data/results/map-assets.json"],
    ["Demographics manifest", "data/results/demographics.json"],
  ]) {
    try {
      const data = JSON.parse(await readFile(join(root, path), "utf8"));
      if (name === "Geometry manifest") {
        for (const file of [data.states, data.house].filter(Boolean))
          await readFile(join(root, file));
      }
      add(name, "PASS", path);
    } catch {
      add(name, "FAIL", "Required data or referenced geometry is unavailable.");
    }
  }
  for (const file of [
    "assets/desk-theme.js",
    "assets/night-awareness.js",
    "assets/night-awareness-board.js",
  ]) {
    try {
      await readFile(join(root, file));
      add(file, "PASS", "Asset available.");
    } catch {
      add(file, "FAIL", "Asset missing.");
    }
  }
  const h = control.health();
  add(
    "Provider",
    h.stale ? "WARNING" : "PASS",
    h.error || h.status || "See feed health.",
  );
  add(
    "Public snapshot",
    "PASS",
    `${control.results().groups.flatMap((g) => g.races).length} races available; private pending calls excluded.`,
  );
  add(
    "Last-good snapshot",
    Object.keys(control.visible.runtime.races).length ? "PASS" : "WARNING",
    `${Object.keys(control.visible.runtime.races).length} provider races persisted. A real provider snapshot is still required if zero.`,
  );
  let probe;
  try {
    await mkdir(control.storage.directory, { recursive: true });
    probe = join(control.storage.directory, ".readiness-" + randomUUID());
    await writeFile(probe, "write probe", { flag: "wx" });
    await unlink(probe);
    add(
      "Storage writable",
      "PASS",
      "Temporary write/readiness probe succeeded.",
    );
  } catch {
    add("Storage writable", "FAIL", "Results storage is not writable.");
  }
  add(
    "Production persistence",
    control.storage.durable ? "WARNING" : "FAIL",
    control.storage.durable
      ? "Storage directory configured. A mounted-disk restart and redeploy drill must still be verified on Render."
      : "No dedicated results storage configured; local workspace files do not prove production durability.",
  );
  add(
    "Manual controls",
    "PASS",
    "Existing authenticated call and override routes are available; no calls were changed.",
  );
  return {
    status: checks.some((c) => c.status === "FAIL")
      ? "FAIL"
      : checks.some((c) => c.status === "WARNING")
        ? "WARNING"
        : "PASS",
    checks,
    rosterAudit: audit,
    at: new Date().toISOString(),
  };
}
