import {ResultsProvider} from './civic-provider.mjs';
import {NbcCountyProvider,nbcCountyPage} from './nbc-counties.mjs';
import { readFile, writeFile, rename, mkdir,readdir } from "node:fs/promises";
import { join } from "node:path";
import { NbcProvider } from "./nbc-provider.mjs";
import { genericName,matchBallotCandidate } from "./candidate-roster.mjs";
import { createHash } from "node:crypto";
import { resultStorage } from './storage.mjs';
import { auditRosters } from './roster-audit.mjs';
import {readStateFile,validateCalls,validateRuntime} from './recovery.mjs';
const resultFingerprint = r => createHash('sha256').update(JSON.stringify([r.provider,r.candidates,r.expectedVotePercent,r.reportingPercent,r.providerCall,(r.counties||[]).map(({lastUpdated,...c})=>c)])).digest('hex');
const numberSetting = (value, fallback, min) =>
  Number.isFinite(Number(value)) && Number(value) >= min
    ? Number(value)
    : fallback;
async function json(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function atomic(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}
export class ResultsControl {
  constructor({
    root = process.cwd(),
    now = () => Date.now(),
    provider,
    countyProvider,
    graceSeconds = process.env.NBC_CALL_GRACE_SECONDS,
    pollSeconds = process.env.NBC_POLL_SECONDS,
    staleSeconds = process.env.NBC_STALE_SECONDS,
    storageDir = process.env.RESULTS_STORAGE_DIR,
  } = {}) {
    Object.assign(this, { root, now, provider });
    this.countyProvider=countyProvider||new NbcCountyProvider({now,root});
    this.storage=resultStorage(root,storageDir);
    this.graceSeconds = numberSetting(graceSeconds, 30, 0);
    this.pollSecondsConfigured=pollSeconds!==undefined;
    this.pollSeconds = numberSetting(pollSeconds, 45, 15);
    this.staleSeconds = numberSetting(staleSeconds, 180, 30);
    this.queue = Promise.resolve();
    this.failures = 0;
    this.nextPoll = 0;
  }
  serial(fn) {
    const task = this.queue.then(async () => {
      const calls = structuredClone(this.calls),
        runtime = structuredClone(this.runtime);
      try {
        return await fn();
      } catch (error) {
        this.calls = calls;
        this.runtime = runtime;
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async init() {
    const catalogue = (
      await json(join(this.root, "data/election-night-races.json"), {
        races: [],
      })
    ).races;
    this.rosterAudit=auditRosters(catalogue);
    if(!this.rosterAudit.passed)console.warn(JSON.stringify({event:'candidate-roster-needs-review',issues:this.rosterAudit.issues.slice(0,20)}));
    this.catalogue=catalogue.map(race=>({...race,candidates:(race.candidates||[]).filter(c=>!genericName(c.name)&&!c.placeholder)}));
    try {
      this.config = await json(join(this.root, "data/results-provider.json"), {sources: []});
    } catch {
      this.configurationError='Provider configuration could not be read. Check its JSON and restart the service.';
      this.config={sources:[]};
    }
    if(!this.config || !Array.isArray(this.config.sources) || this.config.sources.some(s=>!s||typeof s.url!=='string'||!Array.isArray(s.races))){
      this.configurationError='Provider configuration is malformed. Check sources and race mappings, then restart the service.';
      this.config={sources:[]};
    }
    if(!this.pollSecondsConfigured&&this.config.pollSeconds!==undefined)this.pollSeconds=numberSetting(this.config.pollSeconds,45,15);
    this.provider ||= this.config.fallback?.enabled ? new ResultsProvider(this.config) : new NbcProvider(this.config);
    // Read the committed envelope first: its matching calls are authoritative.
    // Truncated runtime must fail clearly rather than publish the seed as zeros.
    const savedRuntime=await readStateFile(this.storage.state,undefined);
    this.runtime=validateRuntime(savedRuntime===undefined?{races:{},health:{},audit:[]}:savedRuntime);
    if(this.runtime.committedCalls){
      this.calls=structuredClone(this.runtime.committedCalls);
      try{validateCalls(await readStateFile(this.storage.calls,{races:{}}));}
      catch(error){this.recoveryWarning='Recovered matching calls from committed runtime envelope; repair the calls file before the next write.';console.error(JSON.stringify({event:'state-recovered',message:this.recoveryWarning}));}
    }else this.calls=validateCalls(await readStateFile(this.storage.calls,await readStateFile(join(this.root,'data/result-calls.json'),{races:{}})));
    if(savedRuntime===undefined&&this.storage.durable){
      const details=await readdir(this.storage.details).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      if(Object.keys(this.calls.races).some(id=>this.catalogue.some(r=>r.id===id))||details.some(p=>p.endsWith('.json')))throw Error('Runtime envelope missing but prior election state exists. Restore a private backup; refusing zero-result fallback.');
    }
    this.calls.races ||= {};
    this.calls.automation ||= { paused: false };
    for (const [id, s] of Object.entries(this.calls.races))
      if (
        this.catalogue.some((r) => r.id === id) &&
        s.calls?.length &&
        !s.callState
      ) {
        const nbc=s.calls.every(c=>c.provider==='NBC'||/^nbc-/.test(c.source||''));
        s.manualOverride = !nbc;
        s.callState = nbc?'NBC_HELD':"MANUAL_FEA_CALL";
        if(nbc)s.attentionReason='Published NBC call restored from backup. Verify the live source before resuming automation.';
      }
    this.runtime.audit ||= [];
    this.runtime.races ||= {};
    this.runtime.health ||= {};
    // Calls and last-good votes are recovered from the same committed envelope.
    if(this.runtime.committedCalls)this.calls=structuredClone(this.runtime.committedCalls);
    this.calls.races ||= {};
    this.calls.automation ||= {paused:false};
    // Unknown recovered winners fail clearly; reviewed aliases preserve identities.
    for(const local of this.catalogue){
      const raw=this.runtime.races[local.id],state=this.calls.races[local.id];
      const national=raw?.providerScope==='national'&&raw.provider==='NBC'&&raw.electionDate==='2026-11-03'&&this.config.sources.some(source=>source.format==='nbc-national-v2'&&source.url===raw.sourceUrl&&source.races.some(m=>m.feaRaceId===local.id&&String(m.providerRaceId)===raw.providerRaceId));
      const civic=raw?.providerScope==='civic-fallback'&&raw.provider==='CivicAPI'&&raw.electionDate==='2026-11-03'&&this.config.fallback?.enabled&&this.config.fallback.races?.some(m=>m.feaRaceId===local.id&&String(m.civicRaceId)===raw.providerRaceId&&raw.sourceUrl===`https://civicapi.org/api/v2/race/${m.civicRaceId}`);
      const trusted=national||civic;
      if(raw){
        if(trusted&&raw.candidates.some(c=>genericName(c.name)))throw Error('Invalid saved NBC candidate for '+local.id);
        if(!trusted)raw.candidates=raw.candidates.map(c=>matchBallotCandidate(c,local.candidates));
      }
      const callRoster=trusted?raw.candidates:local.candidates;
      for(const call of state?.calls||[]){
        try{call.candidate=matchBallotCandidate({name:call.candidate},callRoster).name;}
        catch(error){throw Error('Invalid saved call for '+local.id+': '+error.message);}
      }
      for(const call of [state?.providerCall,raw?.providerCall].filter(Boolean))call.candidate=matchBallotCandidate({name:call.candidate},callRoster).name;
    }
    for(const state of Object.values(this.calls.races))for(const call of state.calls||[])if(/^nbc-/.test(call.source||''))call.provider='NBC';
    this.commitVisibleState();
    return this;
  }
  commitVisibleState() {
    this.visible = {
      calls: structuredClone(this.calls),
      runtime: structuredClone(this.runtime),
    };
  }
  record(race, action, previous, next, candidate = "", actor = "system") {
    this.runtime.audit.push({
      timestamp: new Date(this.now()).toISOString(),
      race,
      candidate,
      action,
      source: actor === "system" || action === "publish-now" ? "NBC" : "FEA",
      actor,
      previousState: previous,
      newState: next,
    });
    this.runtime.audit=this.runtime.audit.slice(-5000);
    console.info(JSON.stringify({event:'result-control',race,action,actor,previous,next}));
  }
  state(id) {
    return (this.calls.races[id] ||= { calls: [], callState: "UNCALLED" });
  }
  async save() {
    try {
    const callsPath = this.storage.calls;
    const previous = await json(callsPath, { races: {} });
    const previousState=await json(this.storage.state,null);
    if(!previousState?.committedCalls)await atomic(this.storage.state,{...this.visible.runtime,committedCalls:previous});
    await atomic(callsPath, this.calls);
    try {
      await atomic(
        this.storage.state,
        {...this.runtime,committedCalls:this.calls},
      );
    } catch (error) {
      try {
        await atomic(callsPath, previous);
      } catch (rollback) {
        throw new Error(
          `Call persistence failed and rollback failed. Stop automation and inspect disk: ${rollback.message}`,
        );
      }
      throw error;
    }
    this.commitVisibleState();
    this.persistenceError=null;
    this.recoveryWarning=null;
    } catch(error) {
      if(this.persistenceError!==error.message)console.error(JSON.stringify({event:'persistence-write-failed',message:error.message}));
      this.persistenceError=error.message;
      throw error;
    }
  }
  async loadCountyResults(id, options) {
    const raw=this.runtime.races[id];
    if(!raw)return false;
    const counties=await this.countyProvider.fetchCounties(raw,options);
    if(!counties?.length&&!this.countyProvider.modelUnitsFor?.(raw)?.length)return false;
    return this.applyCountyResults([raw],new Map([[id,counties||[]]]));
  }
  countyPageFor(id) {
    return nbcCountyPage(this.runtime.races[id]);
  }
  probabilityResult(id,reportingUnitIds) {
    const raw=this.visible.runtime.races[id];
    if(!raw)return undefined;
    const countyPrior=reportingUnitIds?.length&&reportingUnitIds.every(id=>/^\d{5}$/.test(id));
    const nativePrior=raw.state==='AK'&&Array.isArray(reportingUnitIds)&&
      [40,41].includes(reportingUnitIds.length)&&new Set(reportingUnitIds).size===reportingUnitIds.length&&
      reportingUnitIds.filter(id=>/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id)).length===40&&
      reportingUnitIds.every(id=>/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id)||id==='AK-OA');
    return {id:raw.id,state:raw.state,provider:raw.provider,electionDate:raw.electionDate,
      ...(nativePrior?{reportingUnitScheme:'nbc-alaska-state-house-districts'}:{}),
      lastUpdated:raw.lastUpdated,expectedVotePercent:raw.expectedVotePercent,
      candidates:raw.candidates,counties:nativePrior?raw.probabilityUnits:countyPrior&&raw.probabilityCounties||raw.counties};
  }
  async loadCountyResultsBatch(ids) {
    const races=ids.map(id=>this.runtime.races[id]).filter(Boolean);
    return this.applyCountyResults(races,await this.countyProvider.fetchCountyBatch(races),{refreshTimestamps:true});
  }
  async applyCountyResults(races, batches, {refreshTimestamps=false}={}) {
    if(!batches.size)return false;
    return this.serial(async()=>{
      let changed=false;
      for(const raw of races){
        const counties=batches.get(raw.id),current=this.runtime.races[raw.id];
        const modelUnits=this.countyProvider.modelUnitsFor?.(raw);
        if(!Array.isArray(counties)||!counties.length&&!modelUnits?.length||!current||current.provider!==raw.provider||current.providerScope!==raw.providerScope||current.providerPageUrl!==raw.providerPageUrl)continue;
        const previousUnits=new Map(current.probabilityUnits?.map(unit=>[unit.id,unit]));
        if(modelUnits?.some(unit=>Date.parse(previousUnits.get(unit.id)?.lastUpdated)>Date.parse(unit.lastUpdated)))continue;
        const previous=new Map(current.counties?.map(c=>[c.fips,c]));
        if(counties.some(c=>Date.parse(previous.get(c.fips)?.lastUpdated)>Date.parse(c.lastUpdated)))continue;
        // Keep units added by a poll that finished while this page was loading.
        const received=new Set(counties.map(c=>c.fips));
        const merged=[...counties,...[...previous.values()].filter(c=>!received.has(c.fips))].sort((a,b)=>a.fips.localeCompare(b.fips));
        const modelCounties=this.countyProvider.modelCountiesFor?.(raw);
        const modelChanged=JSON.stringify(modelCounties)!==JSON.stringify(current.probabilityCounties)||
          JSON.stringify(modelUnits)!==JSON.stringify(current.probabilityUnits);
        const next={...current,counties:merged,probabilityCounties:modelCounties,probabilityUnits:modelUnits},signature=resultFingerprint(next);
        if(signature===current._signature&&!modelChanged&&(!refreshTimestamps||!counties.some(c=>c.lastUpdated!==previous.get(c.fips)?.lastUpdated)))continue;
        this.runtime.races[raw.id]={...next,_signature:signature};
        changed=true;
      }
      if(!changed)return false;
      this.runtime.health.countyErrors=Object.fromEntries(this.countyProvider.errors);
      await this.save();return true;
    });
  }
  async poll() {
    if (this.now() < this.nextPoll) return;
    return this.serial(async () => {
      if (this.now() < this.nextPoll) return;
      const h = this.runtime.health;
      h.lastAttempt = new Date(this.now()).toISOString();
      try {
        if(this.configurationError)throw Error(this.configurationError);
        const incoming = await this.provider.fetchResults(this.catalogue,{lastGood:this.runtime.races});
        if (!Array.isArray(incoming) || !incoming.length)
          throw Error("Provider returned no normalized races");
        // Only race details actually opened by public clients request county feeds.
        for(const r of incoming)if(!r.counties?.length&&this.runtime.races[r.id]?.counties?.length)r.counties=this.runtime.races[r.id].counties;
        for(const r of incoming){
          const prior=this.runtime.races[r.id];
          if(r.provider==='NBC'&&r.providerPageUrl===prior?.providerPageUrl&&prior?.probabilityCounties)
            r.probabilityCounties=prior.probabilityCounties;
          if(r.provider==='NBC'&&r.providerPageUrl===prior?.providerPageUrl&&prior?.probabilityUnits)
            r.probabilityUnits=prior.probabilityUnits;
        }
        await this.countyProvider.refresh(incoming);
        h.countyErrors=Object.fromEntries(this.countyProvider.errors);
        const seen = new Set(),races=[],quarantined=[...(this.provider.quarantined||[])];
        const duplicates=new Set(incoming.filter((r,i)=>incoming.findIndex(k=>k?.id===r?.id)!==i).map(r=>r?.id));
        for (const r of incoming) {
          try {
          if (
            !r || !this.catalogue.some((c) => c.id === r.id) || duplicates.has(r.id) ||
            seen.has(r.id) ||
            !Array.isArray(r.candidates) ||
            !r.candidates.length ||
            r.candidates.some(
              (c) => genericName(c.name) || !Number.isSafeInteger(c.votes) || c.votes < 0,
            )
          )
            throw Error("Invalid normalized provider result");
          if (
            r.providerCall &&
            !r.candidates.some((c) => c.name === r.providerCall.candidate)
          )
            throw Error("Provider call candidate missing");
          seen.add(r.id);
          const prior=this.runtime.races[r.id];
          const returningToNbc=prior?.provider==='CivicAPI'&&r.provider==='NBC';
          // The feeds can have different clocks and include different vote batches.
          const voteBaseline=returningToNbc?prior._lastNbcVotes||prior:prior;
          const before=Date.parse(returningToNbc?prior._lastNbcVotes?.lastUpdated:prior?.lastUpdated),after=Date.parse(r.lastUpdated);
          if(Number.isFinite(before)&&Number.isFinite(after)&&after<before)throw Error('Regressed provider timestamp; last-good race retained');
          if((this.runtime.races[r.id]?.candidates||[]).some(c=>c.votes>0)&&!r.candidates.some(c=>c.votes>0))throw Error('Unexpected zero-vote reset; last-good race retained for review');
          const oldTotal=(prior?.candidates||[]).reduce((n,c)=>n+c.votes,0),newTotal=r.candidates.reduce((n,c)=>n+c.votes,0);
          const baselineTotal=voteBaseline===prior?oldTotal:voteBaseline.candidates.reduce((n,c)=>n+c.votes,0);
          if(!Number.isSafeInteger(newTotal))throw Error('Unsafe total vote count');
          if(prior?.provider&&r.provider&&prior.provider!==r.provider&&!returningToNbc){
            const regressed=prior.candidates.some(candidate=>{
              const next=r.candidates.find(c=>c.name===candidate.name);
              if(next)return next.votes<candidate.votes;
              return candidate.votes>0;
            });
            if(newTotal<oldTotal||regressed)throw Error('Source switch is behind last-good vote totals; retained newer results');
          }
          const resetBaseline=Math.max(oldTotal,baselineTotal);
          if(resetBaseline>=100&&newTotal<resetBaseline*.5)throw Error('Suspicious partial vote reset; last-good race retained for review');
          if((voteBaseline?.candidates||[]).some(c=>c.votes>=100&&r.candidates.some(k=>k.name===c.name&&k.votes===0)))throw Error('Candidate vote reset; last-good race retained for review');
          if(['national','civic-fallback'].includes(r.providerScope)&&!r.counties?.length&&prior?.counties?.length)r.counties=prior.counties;
          races.push(r);
          } catch(error){quarantined.push({race:r?.id||'Unknown',reason:error.message});}
        }
        const quarantineChanged=JSON.stringify(h.quarantined||[])!==JSON.stringify(quarantined.slice(0,100));
        h.quarantined=quarantined.slice(0,100);
        if(!races.length)throw Error('No healthy normalized provider races; last-good snapshot retained');
        h.rosterMismatchCount=races.filter(r=>r.providerRosterReview&&Object.values(r.providerRosterReview).some(v=>v.length)).length;
        h.rosterMismatches=races.filter(r=>r.providerRosterReview&&Object.values(r.providerRosterReview).some(v=>v.length)).slice(0,100).map(r=>({race:r.id,...r.providerRosterReview}));
        h.primaryConnection=this.provider.primaryConnection||'connected';h.primaryError=this.provider.primaryError||null;
        h.lastHealthyRaceIds=races.filter(r=>r.provider!=='CivicAPI').map(r=>r.id);
        h.fallbackRaceCount=races.filter(r=>r.provider==='CivicAPI').length;
        if(quarantined.length&&quarantineChanged)console.warn(JSON.stringify({event:'invalid-race-quarantined',races:h.quarantined}));
        let changed = false;
        for (const r of races) {
          const prior = this.runtime.races[r.id];
          // Fetch time is deliberately excluded: a successful request is not a new result.
          const signature = resultFingerprint(r);
          if (signature !== prior?._signature) changed = true;
          const lastNbcVotes=r.provider==='CivicAPI'&&(prior?.provider==='NBC'
            ? {lastUpdated:prior.lastUpdated,candidates:prior.candidates.map(({name,votes})=>({name,votes}))}
            : prior?._lastNbcVotes);
          this.runtime.races[r.id] = { ...r, _signature: signature, ...(lastNbcVotes?{_lastNbcVotes:lastNbcVotes}:{}) };
          if (r.providerCall) {
            if (!r.candidates.some((c) => c.name === r.providerCall.candidate))
              throw Error("Provider call candidate missing");
            const s = this.state(r.id);
            const fingerprint = `${r.providerRaceId}:${r.providerCall.candidate}`;
            if (s.manualOverride && s.upstreamFingerprint !== fingerprint) {
              s.providerCall = {
                ...r.providerCall,
                detectedAt: new Date(this.now()).toISOString(),
              };
              s.upstreamFingerprint = fingerprint;
              this.record(
                r.id,
                "detected-during-override",
                s.callState,
                s.callState,
                r.providerCall.candidate,
              );
            }
            if (!s.manualOverride && s.upstreamFingerprint !== fingerprint) {
              const before = s.callState || "UNCALLED";
              // Published calls are sticky. A conflicting upstream correction requires human review.
              const conflict = !!s.calls?.length;
              Object.assign(s, {
                providerCall: {
                  ...r.providerCall,
                  detectedAt: new Date(this.now()).toISOString(),
                },
                upstreamFingerprint: fingerprint,
                attentionReason: conflict
                  ? "NBC changed its projection. Published call retained for review."
                  : "",
                callState: conflict ? "NBC_HELD" : "NBC_PENDING",
                publishAt: new Date(
                  this.now() + this.graceSeconds * 1000,
                ).toISOString(),
              });
              this.record(
                r.id,
                conflict ? "upstream-conflict-held" : "detected",
                before,
                s.callState,
                r.providerCall.candidate,
              );
            }
          } else if(r.providerCallVerified!==false) {
            const s = this.calls.races[r.id];
            if (
              s &&
              ["NBC_PENDING", "NBC_AUTO_ACCEPTED"].includes(s.callState)
            ) {
              const before = s.callState;
              s.callState = "NBC_HELD";
              s.attentionReason =
                "NBC projection no longer present. Existing published call retained; review source.";
              this.record(
                r.id,
                "upstream-projection-absent-held",
                before,
                "NBC_HELD",
              );
            }
          }
        }
        h.fallbackRaceCount=Object.values(this.runtime.races).filter(r=>r.provider==='CivicAPI').length;
        const timestamps = races
          .map((r) => Date.parse(r.lastUpdated || ""))
          .filter(Number.isFinite);
        const recovered=h.connection==='failed';
        Object.assign(h, {
          lastSuccess: new Date(this.now()).toISOString(),
          lastUpstreamUpdate: timestamps.length
            ? new Date(Math.max(...timestamps)).toISOString()
            : null,
          error: null,
          connection: "connected",
        });
        if (changed) h.lastChangedResult = new Date(this.now()).toISOString();
        if(recovered)console.info(JSON.stringify({event:'provider-recovered'}));
        this.failures = 0;
      } catch (e) {
        if(h.error!==e.message)console.warn(JSON.stringify({event:'provider-fetch-failed',message:e.message}));
        this.failures++;
        Object.assign(h, {
          connection: e.message.startsWith("No verified NBC")
            ? "unavailable"
            : "failed",
          error: e.message,
        });
      }
      this.nextPoll =
        this.now() +
        Math.min(
          600000,
          this.pollSeconds * 1000 * (this.provider.retrySoon?1:2 ** Math.min(this.failures, 4)),
        );
      await this.acceptExpired();
      await this.save();
    });
  }
  health({ working = false } = {}) {
    const state = working ? this : this.visible;
    const h = state.runtime.health;
    const stale =
      h.connection !== 'connected' ||
      !h.lastSuccess ||
      this.now() - Date.parse(h.lastSuccess) > this.staleSeconds * 1000 ||
      !h.lastUpstreamUpdate ||
      this.now() - Date.parse(h.lastUpstreamUpdate) > this.staleSeconds * 1000;
    const values = Object.entries(state.calls.races)
      .filter(([id]) => this.catalogue.some((r) => r.id === id))
      .map(([, s]) => s);
    return {
      ...h,
      stale: stale || !!h.quarantined?.length || !!this.persistenceError || !!this.recoveryWarning,
      persistenceError:this.persistenceError || null,
      configurationError:this.configurationError || null,
      recoveryWarning:this.recoveryWarning || null,
      publicResultsUrl:this.config.automaticDiscovery?.pageUrls?.[0]||null,
      publicResultsPages:Object.fromEntries(['house','senate','governor'].filter(office=>typeof this.config.publicResultsPages?.[office]==='string').map(office=>[office,this.config.publicResultsPages[office]])),
      status:
        this.persistenceError || this.recoveryWarning ? 'STORAGE ERROR' : h.connection === "unavailable"
          ? "UNAVAILABLE"
          : h.connection === "failed"
            ? "CONNECTION FAILED"
            : !h.lastSuccess
              ? "UNAVAILABLE"
              : stale
                ? "DATA STALE"
                : "CONNECTED",
      automation: state.calls.automation.paused
        ? "PAUSED"
        : stale || this.persistenceError || this.recoveryWarning || h.connection !== "connected" || h.primaryConnection === "failed"
          ? "DEGRADED"
          : "ACTIVE",
      pollSeconds: this.pollSeconds,
      graceSeconds: this.graceSeconds,
      nextAttemptAt: new Date(this.nextPoll).toISOString(),
      sources: this.config.sources.map((s) => ({
        url: s.url,
        status: s.status,
      })),
      pending: values.filter((s) => s.callState === "NBC_PENDING").length,
      overrides: values.filter((s) => s.manualOverride).length,
      counts: Object.fromEntries(
        ["house", "senate", "governor"].map((type) => [
          type,
          Object.values(state.runtime.races).filter((r) => r.type === type)
            .length,
        ]),
      ),
    };
  }
  publish(id, s, source) {
    const before = s.callState;
    s.calls = [
      {
        candidate: s.providerCall.candidate,
        status: "projected",
        calledAt: new Date(this.now()).toISOString(),
        source,
        provider: "NBC",
        providerTimestamp: s.providerCall.providerTimestamp,
      },
    ];
    s.callState = "NBC_AUTO_ACCEPTED";
    s.manualOverride = false;
    this.record(
      id,
      source === "nbc-auto" ? "auto-accepted" : "publish-now",
      before,
      s.callState,
      s.providerCall.candidate,
      source === "nbc-auto" ? "system" : "admin",
    );
  }
  async acceptExpired() {
    if (this.health({ working: true }).automation !== "ACTIVE") return;
    for (const [id, s] of Object.entries(this.calls.races))
      if (
        s.callState === "NBC_PENDING" &&
        (!this.runtime.health.lastHealthyRaceIds || this.runtime.health.lastHealthyRaceIds.includes(id)) &&
        this.now() >= Date.parse(s.publishAt)
      )
        this.publish(id, s, "nbc-auto");
  }
  async tick() {
    if (
      this.health().automation !== "ACTIVE" ||
      !Object.values(this.visible.calls.races).some(
        (s) =>
          s.callState === "NBC_PENDING" &&
          this.now() >= Date.parse(s.publishAt),
      )
    )
      return;
    return this.serial(async () => {
      const before = this.runtime.audit.length;
      await this.acceptExpired();
      if (before !== this.runtime.audit.length) await this.save();
    });
  }
  async action({ action, raceId, calls }) {
    return this.serial(async () => {
      if (["pause", "resume", "hold-all", "return-all"].includes(action)) {
        if (action === "pause" || action === "resume")
          this.calls.automation.paused = action === "pause";
        for (const [id, s] of Object.entries(this.calls.races)) {
          if (action === "hold-all" && s.callState === "NBC_PENDING") {
            this.record(
              id,
              action,
              s.callState,
              "NBC_HELD",
              s.providerCall?.candidate,
              "admin",
            );
            s.callState = "NBC_HELD";
          }
          if (
            action === "return-all" &&
            !s.manualOverride &&
            ["NBC_HELD", "NBC_IGNORED"].includes(s.callState)
          ) {
            this.resetAuto(id, s);
          }
        }
        this.record("*", action, "", "", "", "admin");
      } else {
        const race = this.catalogue.find((r) => r.id === raceId);
        if (!race) throw Error("Unknown general-election race");
        const s = this.state(raceId);
        const before = s.callState || "UNCALLED";
        if (action === "manual") {
          const roster =
            this.runtime.races[raceId]?.candidates || race.candidates;
          if (
            !Array.isArray(calls) ||
            calls.length > 1 ||
            calls.some(
              (c) =>
                !roster.some((r) => r.name === c.candidate && !r.placeholder) ||
                !["projected", "winner", "advances", "advanced"].includes(
                  c.status,
                ),
            ) ||
            new Set(calls.map((c) => c.candidate)).size !== calls.length
          )
            throw Error("Choose valid candidates and call types");
          s.calls = calls.map((c) => ({
            candidate: c.candidate,
            status: c.status,
            calledAt: new Date(this.now()).toISOString(),
            source: "fea-manual",
          }));
          s.manualOverride = true;
          s.callState = s.providerCall ? "MANUAL_OVERRIDE" : "MANUAL_FEA_CALL";
        } else if (action === "auto") this.resetAuto(raceId, s);
        else {
          if (!s.providerCall) throw Error("No explicit NBC projection");
          if (s.manualOverride)
            throw Error(
              "Return this race to NBC auto before accepting upstream calls",
            );
          if (action === "publish") {
            if (!["NBC_PENDING", "NBC_HELD"].includes(s.callState))
              throw Error("Call already handled");
            this.publish(raceId, s, "nbc-accepted");
          } else if (action === "hold") s.callState = "NBC_HELD";
          else if (action === "ignore") s.callState = "NBC_IGNORED";
          else throw Error("Unknown action");
        }
        if (action !== "publish")
          this.record(
            raceId,
            action,
            before,
            s.callState,
            s.calls?.[0]?.candidate || s.providerCall?.candidate,
            "admin",
          );
      }
      await this.save();
      return this.adminSnapshot();
    });
  }
  resetAuto(id, s) {
    const before = s.callState;
    s.manualOverride = false;
    // Explicit return-to-auto clears the FEA call and starts a fresh grace window.
    s.calls = [];
    s.providerCall = this.runtime.races[id]?.providerCall
      ? {
          ...this.runtime.races[id].providerCall,
          detectedAt: new Date(this.now()).toISOString(),
        }
      : null;
    s.callState = s.providerCall ? "NBC_PENDING" : "UNCALLED";
    s.upstreamFingerprint = s.providerCall
      ? `${this.runtime.races[id].providerRaceId}:${s.providerCall.candidate}`
      : null;
    s.publishAt = new Date(this.now() + this.graceSeconds * 1000).toISOString();
    this.record(
      id,
      "return-auto",
      before,
      s.callState,
      s.providerCall?.candidate,
      "admin",
    );
  }
  results({ details = false, raceId } = {}) {
    const catalogue = raceId ? this.catalogue.filter(base => base.id === raceId) : this.catalogue;
    const races = catalogue.map((base) => {
      const raw = this.visible.runtime.races[base.id] || base;
      const s = this.visible.calls.races[base.id] || {};
      const calls = (s.calls || []).map(call=>({...call,provider:call.provider==='NBC'||/^nbc-/.test(call.source||'')?'NBC':'FEA'}));
      const { _signature, _lastNbcVotes, providerCall, counties, probabilityCounties, probabilityUnits, ...safe } = raw;
      return {
        ...safe,
        detailVersion: _signature || "",
        countyCount: counties?.length || 0,
        hasBreakdown: !!counties?.length,
        ...(details ? { counties: counties || [] } : {}),
        type: base.type,
        electionName: base.electionName,
        candidateStatus: ['national','civic-fallback'].includes(raw.providerScope)?raw.candidateStatus:base.candidateStatus,
        rosterVerified: base.rosterVerified,
        rosterReviewed: base.rosterReviewed,
        rosterIncomplete: base.rosterIncomplete,
        electionDate: "2026-11-03",
        electionScope: "General",
        callState: s.callState || "UNCALLED",
        calls,
        status: calls.length ? "called" : "uncalled",
        candidates: (['national','civic-fallback'].includes(raw.providerScope) || (raw.candidates || []).some(c=>Number(c.votes)>0) || calls.length ? raw.candidates : base.candidates || []).filter(c=>!genericName(c.name)&&!c.placeholder).map((c) => {
          const call = calls.find((k) => k.candidate === c.name);
          const identity = (base.candidates || []).find(k => (k.id && c.id && k.id === c.id) || k.name === c.name || k.aliases?.includes(c.name));
          return {
            ...c,
            ...(identity?.summaryVisible ? { summaryVisible:true } : {}),
            ...(identity?.writeIn ? { writeIn:true } : {}),
            ...(identity?.ballotStatus ? { ballotStatus:identity.ballotStatus } : {}),
            isWinner: !!call,
            winner: !!call,
            callStatus: call?.status || "",
            callLabel: call
              ? call.provider === "NBC"
                ? "NBC projects"
                : "FEA projects"
              : "",
          };
        }),
      };
    });
    return {
      generatedAt: new Date(this.now()).toISOString(),
      refreshSeconds: this.pollSeconds,
      provider: {
        name: this.health().fallbackRaceCount ? "NBC News / CivicAPI" : "NBC News",
        ...this.health(),
        attribution:
          "Vote data via NBC News, with CivicAPI as a secondary source where indicated. Projections attributed to NBC; manual calls attributed to FEA.",
      },
      groups: ["house", "senate", "governor"].map((type) => ({
        state: type,
        stateName: type,
        races: races.filter((r) => r.type === type),
      })),
    };
  }
  adminSnapshot() {
    return {
      health: this.health(),
      rosterAudit:this.rosterAudit,
      persistence:{configuredDirectory:this.storage.directory,durableConfigured:this.storage.durable,lastGoodRaces:Object.keys(this.visible.runtime.races).length,quarantined:this.visible.runtime.health.quarantined||[]},
      serverTime: new Date(this.now()).toISOString(),
      states: Object.fromEntries(
        Object.entries(this.visible.calls.races).filter(([id]) =>
          this.catalogue.some((r) => r.id === id),
        ),
      ),
      audit: this.visible.runtime.audit.slice(-500).reverse(),
      races: this.results().groups.flatMap((g) => g.races),
    };
  }
}
let instance;
export async function getResultsControl() {
  return (instance ||= new ResultsControl().init());
}
