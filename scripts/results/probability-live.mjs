import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {normalizeProbabilitySnapshot, probabilityRule} from './probability-inputs.mjs';
import {maxReportingUnits, modelVersion, simulateWinProbability} from './win-probability.mjs';
import {partialLiveModelVersion,simulatePartialProbability} from './probability-partial-adapter.mjs';
import {simulateAggregateProbability} from './probability-aggregate-adapter.mjs';
import {validatePartialProbabilityRelease} from './probability-partial-release.mjs';

const maxPoints = 240;
const maxRaces = 506;
const maxAgeMs = 5 * 60 * 1000;
const digest = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const evidenceHash = snapshot => hash([snapshot.expectedVotePercent??null,snapshot.units.map(unit =>
  [unit.id, unit.complete, unit.expectedVotePercent??null, Object.entries(unit.votes).sort()]).sort(([a],[b])=>a.localeCompare(b))]);

export function validateProbabilityRelease(release) {
  if(release?.policy?.method==='calibrated-partial-count')return validatePartialProbabilityRelease(release);
  const {benchmark, policy, races, reviewedBy, reviewedAt} = release || {};
  const entries = Object.entries(races || {});
  if (benchmark?.modelVersion !== modelVersion || benchmark.method !== 'full-coverage' ||
      benchmark.status !== 'requires-independent-review' ||
      ![benchmark.policyHash, benchmark.inputHash, benchmark.truthHash].every(hash => digest.test(hash || '')) ||
      policy?.method !== 'full-coverage' || hash(policy) !== benchmark.policyHash ||
      !benchmark.cohorts?.length || benchmark.cohorts.some(row =>
        row.status !== 'passes-screen' || row.cycles < 2 || row.races < 2) ||
      typeof reviewedBy !== 'string' || !reviewedBy.trim() || !Number.isFinite(Date.parse(reviewedAt)) ||
      !entries.length || entries.length > maxRaces ||
      entries.some(([id, {prior, roster}]) => !/^[\w-]{1,100}$/.test(id) ||
        prior?.raceId !== id || !Array.isArray(roster) ||
        prior.rule !== 'plurality' || probabilityRule(id, prior.electionDate) !== prior.rule ||
        !Array.isArray(prior.candidateIds) || prior.candidateIds.length < 2 || prior.candidateIds.length > 12 ||
        !Array.isArray(prior.units) || prior.units.length < 2 || prior.units.length > maxReportingUnits ||
        roster.length !== prior.candidateIds.length ||
        new Set(roster.map(row => row.id)).size !== roster.length ||
        roster.some(row => !prior.candidateIds.includes(row.id) || typeof row.name !== 'string' || !row.name.trim()) ||
        !benchmark.cohorts.some(row => row.cohort.startsWith(prior.office + ':'))))
    throw Error('Live probability release is missing reviewed full-coverage benchmark evidence');
  return entries;
}

if (!isMainThread) {
  const {prior, snapshot, settings, previousInputHash} = workerData;
  parentPort.postMessage((settings.method==='calibrated-partial-count'?
    prior.inputMode==='race-total'?simulateAggregateProbability:simulatePartialProbability:
    simulateWinProbability)(prior, snapshot, settings, previousInputHash));
}

function runSimulation(prior, snapshot, settings, previousInputHash) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {prior, snapshot, settings, previousInputHash},
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => reject(Error('Probability worker exited before producing a result (' + code + ')')));
  });
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export class LiveProbability {
  constructor(directory, {now = Date.now, simulate = runSimulation} = {}) {
    this.baseDirectory=directory;
    this.liveModelVersion=modelVersion;
    this.completionDirectory = join(directory, 'win-probability', 'completion');
    this.correctionDirectory = join(directory, 'win-probability', 'corrections');
    this.directory = join(directory, 'win-probability', 'live', modelVersion);
    this.now = now;
    this.simulate = simulate;
    this.races = new Map();
    this.cursor = 0;
    this.hydrationCursor = 0;
  }

  async load(release) {
    if (release === undefined) return;
    const entries=validateProbabilityRelease(release);
    this.liveModelVersion=release.policy.method==='calibrated-partial-count'?partialLiveModelVersion:modelVersion;
    this.directory=join(this.baseDirectory,'win-probability','live',this.liveModelVersion);
    for (const [id, config] of entries) {
      const state = await readJson(join(this.directory, id + '.json'));
      // Changed priors invalidate old inputs, while compatible history remains.
      const partial=release.policy.method==='calibrated-partial-count';
      const identity = partial?hash([this.liveModelVersion,release.implementationHash,config.prior,config.roster]):
        hash([release.reviewedAt, release.benchmark, config.prior, config.roster]);
      const recovered = state?.identity === identity && state.snapshot?.raceId === id &&
        Array.isArray(state.points) && state.points.length <= maxPoints;
      // An approved model revision must not erase the probability history.
      // Retain only compatible dated candidate vectors, never its old inputs.
      const compatibleHistory=partial&&Array.isArray(state?.points)&&state.points.length<=maxPoints&&state.points.every(point=>
        point.raceId===id&&point.electionDate===config.prior.electionDate&&Number.isFinite(Date.parse(point.at))&&
        Array.isArray(point.candidates)&&point.candidates.length===config.roster.length&&
        new Set(point.candidates.map(c=>c.id)).size===config.roster.length&&
        config.roster.every(c=>point.candidates.some(p=>p.id===c.id&&Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1)));
      this.races.set(id, {config, identity, settings: {...release.policy.settings,
        ...(release.policy.method==='calibrated-partial-count'?{simulations:release.policy.simulations,maximumInputAgeMs:release.policy.maximumInputAgeMs,implementationHash:release.implementationHash}:{}),
        method:release.policy.method}, points: recovered||compatibleHistory ? state.points : [],
        pendingModelRevision:!recovered&&compatibleHistory&&state.points.length>0,
        snapshot: recovered ? state.snapshot : undefined,
        evidence: recovered ? evidenceHash(state.snapshot) : null,
        available: false, reason: 'Waiting for a verified NBC update.'});
    }
  }

  nextRaces(limit) {
    const ids = [...this.races.keys()];
    const batch = Array.from({length: Math.min(limit, ids.length)}, () => ids[this.cursor++ % ids.length]);
    return batch;
  }

  nextCountyRaces(eligible, limit) {
    const ids = [...this.races.keys()].filter(id=>this.races.get(id).config.prior.inputMode!=='race-total'&&eligible(id));
    return Array.from({length: Math.min(limit, ids.length)}, () => ids[this.hydrationCursor++ % ids.length]);
  }
  nextCountyRace(){return this.nextCountyRaces(()=>true,1)[0];}

  async updateBatch(detailFor, onError) {
    const batch = this.nextRaces(12);
    await Promise.all([0, 1].map(async slot => {
      for (let index = slot; index < batch.length; index += 2) {
        const id = batch[index];
        try {
          await this.update(id, await detailFor(id,this.races.get(id).config.prior));
          onError(id, null);
        } catch (error) { onError(id, error); }
      }
    }));
  }

  view(id) {
    const race = this.races.get(id);
    if (!race) {
      const rule=probabilityRule(id,'2026-11-03');
      const reasons={
        'ranked-choice':'A forecast for this race needs a validated model of ranked-choice transfers.',
        'majority-runoff':'A forecast for this race needs a validated model of the majority threshold and possible runoff.',
        'legislative-contingency':'A forecast for this race must account for the legislature choosing the governor if no candidate wins a majority.',
      };
      return {status:'unavailable',reason:reasons[rule] || 'FEA has no validated model for this race. The reported vote and margin charts are available above.'};
    }
    if (!race.points.length) return {status: 'waiting', reason: race.reason};
    const fresh = race.available && this.now() - Date.parse(race.snapshot.sourceUpdatedAt) <= maxAgeMs;
    return {status: fresh ? 'live' : 'stale', source: 'NBC News returns', modelVersion:this.liveModelVersion,
      ...(race.config.prior.inputMode==='race-total'?{inputMode:'race-total'}:{}),
      ...(fresh?{}:{reason:race.reason || 'No recent verified NBC update.'}),
      candidates: race.config.roster.map(({id, name, party, partyCode}) => ({id, name, party: partyCode || party})),
      points: race.points};
  }

  coverage(catalogue) {
    const counts = {live:0, stale:0, waiting:0, unavailable:0};
    const races = catalogue.map(({id,type}) => {
      const {status,reason} = this.view(id);
      counts[status]++;
      return {id,office:type,status,...(reason ? {reason} : {})};
    });
    return {total:races.length,counts,races};
  }

  async update(id, detail, completion) {
    const race = this.races.get(id);
    if (!race) return;
    race.available = false;
    race.reason = 'Waiting for a verified NBC update.';
    const aggregate=race.config.prior.inputMode==='race-total';
    if (detail?.id !== id || detail.provider !== 'NBC' || detail.providerStale === true ||
        !aggregate&&(!detail.counties?.length || detail.counties.some(unit => unit.source !== 'NBC News'))) return;
    const now = this.now(), at = new Date(now).toISOString();
    const {prior, roster} = race.config;
    completion ??= await readJson(join(this.completionDirectory, id + '.json')) || {};
    race.reason = aggregate?'The NBC ballot needs to reconcile before the next estimate.':
      'The NBC candidate and county returns need to reconcile before the next estimate.';
    const snapshot = normalizeProbabilitySnapshot(detail, roster, {
      at, source: 'NBC News', completion, reportingUnitIds: prior.units.map(unit => unit.id),
      allowSingleReportingUnit:race.settings.method==='calibrated-partial-count',
      aggregateRace:aggregate,
    });
    race.reason = 'The NBC update is delayed.';
    const age=Math.max(now-Date.parse(snapshot.sourceUpdatedAt),...snapshot.units.filter(unit=>!unit.complete).map(unit=>now-Date.parse(unit.availableAt)));
    const partial=race.settings.method==='calibrated-partial-count';
    const delayed=age>maxAgeMs;
    if (snapshot.electionDate !== prior.electionDate ||
        age>(partial?race.settings.maximumInputAgeMs:maxAgeMs)) return;
    const freshness={available:!delayed,reason:delayed?'NBC returns are delayed. Showing the last supported estimate.':''};
    const previous = race.snapshot;
    const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
    if (previous && Date.parse(snapshot.sourceUpdatedAt) < Date.parse(previous.sourceUpdatedAt)) return;
    const evidence = evidenceHash(snapshot);
    if (race.evidence === evidence) {
      Object.assign(race, {...freshness, snapshot});
      return;
    }
    if (race.rejectedEvidence?.hash === evidence) {
      race.reason = race.rejectedEvidence.reason;
      return;
    }
    const regressed = previous?.units.some(unit => {
      const next = units.get(unit.id);
      return !next || unit.complete && !next.complete ||
        Object.entries(unit.votes).some(([key, votes]) => next.votes[key] < votes);
    });
    const last = race.points.at(-1);
    race.reason = 'Waiting for verified county completion in the areas the model uses.';
    let correctionSource;
    if (regressed) {
      race.reason = 'A change to previously reported votes needs review.';
      const correction = await readJson(join(this.correctionDirectory, id + '.json'));
      const {at: observedAt, ...reported} = snapshot;
      const minorNbcRevision=partial&&Date.parse(snapshot.sourceUpdatedAt)>Date.parse(previous.sourceUpdatedAt)&&
        previous.units.every(unit=>{
          const next=units.get(unit.id);
          return next&&Object.entries(unit.votes).every(([key,votes])=>votes-next.votes[key]<=Math.max(5,votes*.01));
        });
      if(minorNbcRevision)correctionSource='NBC News verified count revision: '+snapshot.sourceUpdatedAt;
      else if (correction?.previousInputHash !== last.inputHash || correction?.snapshotHash !== hash(reported) ||
          !(Date.parse(correction.availableAt) <= Date.parse(observedAt)) ||
          typeof correction.source !== 'string' || !correction.source.trim()) return;
      else correctionSource = correction.source;
    }
    const point = await this.simulate(prior, snapshot, race.settings, last?.inputHash);
    if (point.status === 'unavailable') {
      race.reason = partial?point.reason:'Waiting for verified reporting-unit completion. '+point.reason;
      race.rejectedEvidence = {hash: evidence, reason: race.reason};
      return;
    }
    if (point.status === 'unchanged') {
      Object.assign(race, {...freshness, snapshot, evidence});
      return;
    }
    if (point.status !== 'research') return;
    const {status, ...estimate} = point;
    const reason = correctionSource ? 'documented-correction' : race.pendingModelRevision?'model-revision':last ? 'reporting-update' : 'first-supported-snapshot';
    const points = [...race.points, {...estimate, reason, ...(correctionSource ? {correctionSource} : {})}].slice(-maxPoints);
    await mkdir(this.directory, {recursive: true});
    const file = join(this.directory, id + '.json');
    await writeFile(file + '.tmp', JSON.stringify({identity: race.identity, snapshot, points}) + '\n');
    await rename(file + '.tmp', file);
    Object.assign(race, {...freshness, snapshot, points, evidence,pendingModelRevision:false});
  }
}

export async function openLiveProbability(storage) {
  const worker = new LiveProbability(storage.directory);
  if (!storage.durable) return worker;
  try {
    await worker.load(await readJson(join(storage.directory, 'probability-release.json'))??
      await readJson(new URL('../../data/results/probability-release.json',import.meta.url)));
    return worker;
  } catch (error) {
    console.error('Live probability disabled: ' + error.message);
    return new LiveProbability(storage.directory);
  }
}
