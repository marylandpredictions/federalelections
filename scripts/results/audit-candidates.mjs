import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { auditRosters, ballotKey } from "./roster-audit.mjs";
import { genericName } from "./candidate-roster.mjs";
import { reviewPublicRoster } from "./public-roster-audit.mjs";
export function auditCandidateFiles(root = process.cwd()) {
  const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
  const races = read("data/election-night-races.json").races;
  const reviewed = read("data/results/reviewed-ballots-2026.json"),
    official = read("data/results/louisiana-ballot-2026.json");
  const sourceRows = [...reviewed.races, ...official.races];
  const sourcesById = new Map(sourceRows.map((r) => [r.id, r]));
  const report = auditRosters(races, sourcesById),
    issue = (race, message) => report.issues.push({ race, message });
  if (
    reviewed.electionDate !== "2026-11-03" ||
    official.electionDate !== "2026-11-03" ||
    !Number.isFinite(Date.parse(reviewed.checkedAt)) ||
    !Number.isFinite(Date.parse(official.retrievedAt))
  )
    issue(
      "Source catalogue",
      "Missing election date or dated source-review metadata",
    );
  if (new Set(sourceRows.map((r) => r.id)).size !== sourceRows.length)
    issue("Source catalogue", "Duplicate source race IDs");
  for (const r of sourceRows) {
    if (!Array.isArray(r.candidates)) {
      issue(r.id, "Invalid source candidate array");
      continue;
    }
    try {
      if (new URL(r.sourceUrl).protocol !== "https:") throw Error();
    } catch {
      issue(r.id, "Missing or malformed reviewed source URL");
    }
    const ids = r.candidates.filter((c) => c.id).map((c) => String(c.id));
    if (new Set(ids).size !== ids.length)
      issue(r.id, "Duplicate candidate source IDs in reviewed source");
  }
  if (races.length !== 506 || sourceRows.length !== 506)
    issue("Catalogue", "Expected 506 reviewed general-election races");
  const snapshot = read("data/live-results.json").groups.flatMap(
    (g) => g.races,
  );
  const priorities = read(
    "data/results/candidate-summary-priorities.json",
  ).races;
  const config = read("data/results-provider.json");
  const byId = new Map(snapshot.map(race=>[race.id,race]));
  report.publicRosterDifferences = [];
  if (
    snapshot.length !== 506 ||
    new Set(snapshot.map((r) => r.id)).size !== 506
  )
    issue("Public snapshot", "Expected 506 unique public races");
  for (const race of races) {
    // Audit evidence explains a recorded provider spelling without changing
    // the live provider's canonical names or existing projection fingerprints.
    const auditRoster = {...race,candidates:race.candidates.map(candidate=>{
      const sourceCandidate = sourcesById.get(race.id)?.candidates?.find(row=>row.name===candidate.name);
      if (!sourceCandidate?.providerAuditAliases) return candidate;
      if (!Array.isArray(sourceCandidate.providerAuditAliases)) {
        issue(race.id,"Malformed provider alias evidence for "+candidate.name);
        return candidate;
      }
      const aliases = [...(candidate.aliases || [])];
      for (const evidence of sourceCandidate.providerAuditAliases) {
        if (typeof evidence?.name!=='string' || genericName(evidence.name) || !/^https:\/\//.test(evidence.source || '') ||
            race.candidates.some(other=>other!==candidate && [other.name,...(other.aliases || [])].some(name=>ballotKey(name)===ballotKey(evidence.name)))) {
          issue(race.id,"Invalid or conflicting provider alias evidence for "+candidate.name);
          continue;
        }
        aliases.push(evidence.name);
      }
      return {...candidate,aliases};
    })};
    const summary = byId.get(race.id);
    const detail = read("data/live-results-races/" + race.id + ".json");
    const diagnostics = {race:race.id};
    for (const [kind,row] of Object.entries({summary,detail})) {
      const review = reviewPublicRoster(auditRoster,row,config);
      for (const difference of review.differences.filter(d=>d.kind==='verified-alias')) {
        const evidence = sourcesById.get(race.id)?.candidates?.find(c=>c.name===difference.reviewed)?.providerAuditAliases;
        if (Array.isArray(evidence)) {
          const source = evidence.find(entry=>entry?.name===(difference.candidate.providerName || difference.candidate.name));
          if (source) difference.source = source.source;
        }
      }
      if (review.issues.length || review.differences.length) diagnostics[kind] = review;
      for (const message of review.issues) issue(race.id,`${kind}: ${message}`);
    }
    if (summary?.detailVersion !== detail.detailVersion)
      diagnostics.parity = "Summary and detail versions differ";
    else if (JSON.stringify(summary?.candidates)!==JSON.stringify(detail.candidates) ||
             JSON.stringify(summary?.calls)!==JSON.stringify(detail.calls))
      diagnostics.parity = "Summary and detail disagree on candidate votes, identities or calls at the same version";
    if (diagnostics.parity)
      issue(race.id,diagnostics.parity);
    if (diagnostics.summary || diagnostics.detail || diagnostics.parity) report.publicRosterDifferences.push(diagnostics);
    for (const row of [race,summary,detail]) {
      for (const name of priorities.find((p) => p.id === race.id)?.candidates ||
        [])
        if (!row?.candidates?.some((c) => c.name === name && c.summaryVisible))
          issue(
            race.id,
            "Prominent candidate missing from compact summary: " + name,
          );
    }
  }
  report.needsReview = new Set(report.issues.map((i) => i.race)).size;
  report.secondaryReviewed=races.filter(r=>r.rosterReviewed&&!r.rosterIncomplete&&!r.rosterVerified).length;
  report.emptyRosters=races.filter(r=>!r.candidates?.length).map(r=>r.id);
  // This command audits local files; a missing live source is not zero mismatches.
  report.providerMismatches={status:'NOT_TESTED',count:null,reason:'Requires activated provider samples; local snapshot identities checked separately.'};
  let watch;try{watch=read('data/election-night-watchlist.json');}catch{watch={races:{}};}
  const watchIds=new Set(Object.entries(watch.races||{}).filter(([,v])=>v.watch||v.tossup).map(([id])=>id));
  report.unverified=Object.fromEntries(['senate','governor','house'].map(office=>[office,races.filter(r=>r.type===office&&!r.rosterVerified).map(r=>r.id)]));
  report.unverified.watchTossup=races.filter(r=>!r.rosterVerified&&watchIds.has(r.id)).map(r=>r.id);
  for(const race of sourceRows.filter(r=>r.verification)){
    const v=race.verification;
    if(v.status!=='OFFICIAL_SOURCE_VERIFIED'||v.electionDate!=='2026-11-03'||!v.authority||!v.scope||!Number.isFinite(Date.parse(v.checkedAt))||!/^https:\/\//.test(v.sourceUrl||'')||!/^[a-f0-9]{64}$/.test(v.sha256||'')||!Array.isArray(v.candidates)||v.candidates.length!==race.candidates.length)issue(race.id,'Official verification provenance is incomplete');
    else if(v.candidates.some(c=>!c.ballotName||!race.candidates.some(r=>r.name===c.name&&(r.partyCode||r.party)===c.party)))issue(race.id,'Official verification identities or parties differ from the reviewed roster');
  }
  report.needsReview=new Set(report.issues.map(i=>i.race)).size;
  report.passed = !report.issues.length;
  return report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = auditCandidateFiles();
  const {publicRosterDifferences,...summary} = report;
  console.log(JSON.stringify(process.argv.includes('--diagnostics') ? report : summary, null, 2));
  if (!report.passed) {
    if (process.env.ALLOW_UNREVIEWED_RESULTS_ROSTER === "1")
      console.error(
        "WARNING: Explicit candidate deployment override is active. Resolve the listed issues before Election Day.",
      );
    else process.exitCode = 1;
  }
}
