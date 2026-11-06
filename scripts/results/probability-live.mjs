import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {normalizeProbabilitySnapshot} from './probability-inputs.mjs';
import {modelVersion, simulateWinProbability} from './win-probability.mjs';

const maxPoints = 240;
const maxAgeMs = 5 * 60 * 1000;
const digest = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateProbabilityRelease(release) {
  const {benchmark, policy, races, reviewedBy, reviewedAt} = release || {};
  const entries = Object.entries(races || {});
  if (benchmark?.modelVersion !== modelVersion || benchmark.method !== 'full-coverage' ||
      benchmark.status !== 'requires-independent-review' ||
      ![benchmark.policyHash, benchmark.inputHash, benchmark.truthHash].every(hash => digest.test(hash || '')) ||
      policy?.method !== 'full-coverage' || hash(policy) !== benchmark.policyHash ||
      !benchmark.cohorts?.length || benchmark.cohorts.some(row =>
        row.status !== 'passes-screen' || row.cycles < 2 || row.races < 2) ||
      typeof reviewedBy !== 'string' || !reviewedBy.trim() || !Number.isFinite(Date.parse(reviewedAt)) ||
      !entries.length || entries.length > 12 ||
      entries.some(([id, {prior, roster}]) => !/^[\w-]{1,100}$/.test(id) ||
        prior?.raceId !== id || !Array.isArray(roster) ||
        !Array.isArray(prior.candidateIds) || !Array.isArray(prior.units) ||
        roster.length !== prior.candidateIds.length ||
        new Set(roster.map(row => row.id)).size !== roster.length ||
        roster.some(row => !prior.candidateIds.includes(row.id) || typeof row.name !== 'string' || !row.name.trim()) ||
        !benchmark.cohorts.some(row => row.cohort.startsWith(prior.office + ':'))))
    throw Error('Live probability release is missing reviewed full-coverage benchmark evidence');
  return entries;
}

if (!isMainThread) {
  const {prior, snapshot, settings, previousInputHash} = workerData;
  parentPort.postMessage(simulateWinProbability(prior, snapshot, settings, previousInputHash));
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
    this.completionDirectory = join(directory, 'win-probability', 'completion');
    this.correctionDirectory = join(directory, 'win-probability', 'corrections');
    this.directory = join(directory, 'win-probability', 'live', modelVersion);
    this.now = now;
    this.simulate = simulate;
    this.races = new Map();
    this.cursor = 0;
  }

  async load(release) {
    if (release === undefined) return;
    for (const [id, config] of validateProbabilityRelease(release)) {
      const state = await readJson(join(this.directory, id + '.json'));
      // A changed release or prior starts a new public series.
      const identity = hash([release.reviewedAt, release.benchmark, config.prior, config.roster]);
      const recovered = state?.identity === identity && state.snapshot?.raceId === id &&
        Array.isArray(state.points) && state.points.length <= maxPoints;
      this.races.set(id, {config, identity, settings: {...release.policy.settings, method: 'full-coverage'}, points: recovered ? state.points : [],
        snapshot: recovered ? state.snapshot : undefined, available: false});
    }
  }

  nextRace() {
    const ids = [...this.races.keys()];
    return ids.length ? ids[this.cursor++ % ids.length] : undefined;
  }

  view(id) {
    const race = this.races.get(id);
    if (!race) return {status: 'unavailable', reason: 'A validated live forecast is unavailable for this race.'};
    if (!race.points.length) return {status: 'waiting', reason: 'Waiting for verified reporting-unit returns.'};
    const fresh = race.available && this.now() - Date.parse(race.snapshot.sourceUpdatedAt) <= maxAgeMs;
    return {status: fresh ? 'live' : 'stale', source: 'NBC News returns', modelVersion,
      candidates: race.config.roster.map(({id, name, party, partyCode}) => ({id, name, party: partyCode || party})),
      points: race.points};
  }

  async update(id, detail, completion) {
    const race = this.races.get(id);
    if (!race) return;
    race.available = false;
    if (detail?.id !== id || detail.provider !== 'NBC' || detail.providerStale === true ||
        !detail.counties?.length || detail.counties.some(unit => unit.source !== 'NBC News')) return;
    const now = this.now(), at = new Date(now).toISOString();
    const {prior, roster} = race.config;
    completion ??= await readJson(join(this.completionDirectory, id + '.json')) || {};
    const snapshot = normalizeProbabilitySnapshot(detail, roster, {at, source: 'NBC News', completion});
    if (snapshot.electionDate !== prior.electionDate ||
        now - Date.parse(snapshot.sourceUpdatedAt) > maxAgeMs ||
        snapshot.units.some(unit => !unit.complete && now - Date.parse(unit.availableAt) > maxAgeMs)) return;
    const previous = race.snapshot;
    const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
    if (previous && Date.parse(snapshot.sourceUpdatedAt) < Date.parse(previous.sourceUpdatedAt)) return;
    const regressed = previous?.units.some(unit => {
      const next = units.get(unit.id);
      return !next || unit.complete && !next.complete ||
        Object.entries(unit.votes).some(([key, votes]) => next.votes[key] < votes);
    });
    const last = race.points.at(-1);
    let correctionSource;
    if (regressed) {
      const correction = await readJson(join(this.correctionDirectory, id + '.json'));
      const {at: observedAt, ...reported} = snapshot;
      if (correction?.previousInputHash !== last.inputHash || correction?.snapshotHash !== hash(reported) ||
          !(Date.parse(correction.availableAt) <= Date.parse(observedAt)) ||
          typeof correction.source !== 'string' || !correction.source.trim()) return;
      correctionSource = correction.source;
    }
    const point = await this.simulate(prior, snapshot, race.settings, last?.inputHash);
    if (point.status === 'unavailable') return;
    if (point.status === 'unchanged') {
      race.snapshot = snapshot;
      race.available = true;
      return;
    }
    if (point.status !== 'research') return;
    const {status, ...estimate} = point;
    const reason = correctionSource ? 'documented-correction' : last ? 'reporting-update' : 'first-supported-snapshot';
    const points = [...race.points, {...estimate, reason, ...(correctionSource ? {correctionSource} : {})}].slice(-maxPoints);
    await mkdir(this.directory, {recursive: true});
    const file = join(this.directory, id + '.json');
    await writeFile(file + '.tmp', JSON.stringify({identity: race.identity, snapshot, points}) + '\n');
    await rename(file + '.tmp', file);
    Object.assign(race, {available: true, snapshot, points});
  }
}

export async function openLiveProbability(storage) {
  const worker = new LiveProbability(storage.directory);
  if (!storage.durable) return worker;
  try {
    await worker.load(await readJson(join(storage.directory, 'probability-release.json')));
    return worker;
  } catch (error) {
    console.error('Live probability disabled: ' + error.message);
    return new LiveProbability(storage.directory);
  }
}
