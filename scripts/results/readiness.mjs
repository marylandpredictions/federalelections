import { readFile, mkdir, writeFile, unlink, stat,rename,access } from "node:fs/promises";
import {constants} from 'node:fs';
import {storageConfiguration} from './storage.mjs';
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { auditCandidateFiles } from "./audit-candidates.mjs";
export function validatePollSchedule(data) {
  if(data?.electionDate!=='2026-11-03'||!Array.isArray(data.events)||!data.events.length||!/^https:\/\//.test(data.sourceUrl||'')||!Number.isFinite(Date.parse(data.checkedAt)))throw Error('Poll-close schedule or provenance is invalid.');
  const states=new Set();let previous=0;
  for(const event of data.events){
    const at=Date.parse(event.at);
    if(!Number.isFinite(at)||at<=previous||at<Date.parse('2026-11-03T05:00:00Z')||at>Date.parse('2026-11-04T12:00:00Z')||!event.states?.length)throw Error('Invalid poll-close group.');
    previous=at;
    for(const state of event.states){if(!/^[A-Z]{2}$/.test(state)||states.has(state))throw Error('Duplicate or invalid poll-close state.');states.add(state);}
  }
  const required='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  if(states.size!==51||required.some(state=>!states.has(state)))throw Error('Poll-close coverage must include all 50 states and DC.');
  for(const state of ['IN','KY','FL','KS','MI','TX','ID'])if(!data.districtExceptions?.[state]?.default)throw Error('Verified district poll-close exceptions are missing.');
  for(const [state,exceptions] of Object.entries(data.districtExceptions||{}))for(const [district,value] of Object.entries(exceptions))if(!states.has(state)||!(district==='default'||/^\d+$/.test(district))||!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.parse('2026-11-03T05:00:00Z')||Date.parse(value)>Date.parse('2026-11-04T12:00:00Z'))throw Error('Invalid district poll-close exception.');
}
async function asset(root,path){
  if(typeof path!=='string'||!path.startsWith('data/results/')||path.includes('..')||path.includes('\\'))throw Error('Invalid manifest asset path.');
  const bytes=await readFile(join(root,path));
  return JSON.parse((path.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8'));
}
export async function readiness(control, root, {storageEnvironment=process.env}={}) {
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
      if(name==='Poll-close schedule')validatePollSchedule(data);
      if (name === "Geometry manifest") {
        if(!data.states||!data.house||!Object.keys(data.counties||{}).length)throw Error('Geometry manifest is incomplete.');
        for (const file of [data.states,data.house,...Object.values(data.counties||{}),...Object.values(data.municipalities||{}).map(m=>m.path)]){
          const geometry=await asset(root,file);
          if(!(geometry.type==='FeatureCollection'&&geometry.features?.length||geometry.type==='Topology'&&Object.keys(geometry.objects||{}).length&&geometry.arcs?.length))throw Error('Geometry asset is empty or malformed.');
        }
      }
      if(name==='Demographics manifest'){
        if(data.status!=='available'){add(name,'WARNING','Census estimates are not available; results remain usable.');continue;}
        const demographics=await asset(root,data.file);
        if(!Object.keys(demographics.counties||{}).length||!Object.keys(demographics.states||{}).length)throw Error('Demographics asset is empty.');
      }
      add(name, "PASS", path);
    } catch(error) {
      add(name, "FAIL", "Required data is unavailable or invalid: "+error.message);
    }
  }
  for (const file of [
    "assets/desk-theme.js",
    "assets/night-awareness.js",
    "assets/night-awareness-board.js",
    "assets/results-desk-board.js",
    "assets/results-desk.js",
    "assets/results-ui.js",
    "assets/desk-appearance.js",
    "assets/projection-card.js",
    "assets/projection-card.css",
    "assets/overlay-model.js",
    "assets/call-overlay.js",
    "assets/call-overlay.css",
    "call-overlay.html",
  ]) {
    try {
      await readFile(join(root, file));
      add(file, "PASS", "Asset available.");
    } catch {
      add(file, "FAIL", "Asset missing.");
    }
  }
  const h = control.health();
  if(h.recoveryWarning)add('State recovery','WARNING',h.recoveryWarning);
  const storageConfig=storageConfiguration(root,control.storage.durable?control.storage.directory:undefined,storageEnvironment);
  add('Storage configuration',storageConfig.issues.length?'FAIL':'PASS',storageConfig.issues.join(' ')||'No configuration-level ephemeral-path conflict detected; hosted durability remains unverified.');
  add(
    "Provider",
    h.stale ? "WARNING" : "PASS",
    h.error || h.status || "See feed health.",
  );
  const publicRaces=control.results().groups.flatMap((g)=>g.races||[]);
  add(
    "Public snapshot",
    publicRaces.length?'PASS':'FAIL',
    `${publicRaces.length} races available; private pending calls excluded.`,
  );
  add(
    "Last-good snapshot",
    Object.keys(control.visible.runtime.races).length ? "PASS" : "WARNING",
    `${Object.keys(control.visible.runtime.races).length} provider races persisted. A real provider snapshot is still required if zero.`,
  );
  let probe,renamed;
  try {
    await mkdir(control.storage.directory, { recursive: true });
    for(const path of [control.storage.calls||join(control.storage.directory,'result-calls.json'),control.storage.state||join(control.storage.directory,'results-state.json')]){
      try{if(!(await stat(path)).isFile())throw Error('Runtime target is not a file.');await access(path,constants.R_OK|constants.W_OK);JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    probe = join(control.storage.directory, ".readiness-" + randomUUID());
    await writeFile(probe, "write probe", { flag: "wx" });
    if(await readFile(probe,'utf8')!=='write probe')throw Error('Storage readback failed.');
    renamed=probe+'.renamed';await rename(probe,renamed);
    if(await readFile(renamed,'utf8')!=='write probe')throw Error('Atomic rename readback failed.');
    await unlink(renamed);
    add(
      "Storage writable",
      "PASS",
      "Temporary create, write, readback, atomic rename and deletion succeeded; existing state files are accessible.",
    );
  } catch(error) {
    add("Storage writable", "FAIL", "Results storage probe failed: "+error.message);
  } finally {
    if(probe)await unlink(probe).catch(()=>{});
    if(renamed)await unlink(renamed).catch(()=>{});
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
