// Race-total multi-candidate plurality model. Observed named votes stay fixed.
// Remaining ballots are allocated with a Dirichlet prior that blends the
// pre-election share center with the counted shares. This module alone does
// not authorize publication.
import {createHash} from 'node:crypto';
import {partialLiveModelVersion} from './probability-partial-adapter.mjs';
import {probabilityRule} from './probability-inputs.mjs';

export const multiAggregateModelVersion = 'fea-live-multi-aggregate-1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dated = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const check = (condition, message) => { if (!condition) throw Error('Multi race-total model: ' + message); };

function rng(key) {
  let seed = Number.parseInt(key.slice(0, 8), 16) || 1;
  const uniform = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

function dirichlet(alphas, normal) {
  const gammas = alphas.map(alpha => {
    // Marsaglia-Tsang for alpha >= 1, boosted for alpha < 1.
    let a = alpha;
    let boost = 1;
    if (a < 1) {
      const u = 0.5 + 0.5 * Math.tanh(normal());
      boost = Math.pow(Math.min(0.999999, Math.max(1e-12, u)), 1 / a);
      a += 1;
    }
    const d = a - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      const x = normal();
      const v = Math.pow(1 + c * x, 3);
      if (v <= 0) continue;
      const u = 0.5 + 0.5 * Math.tanh(normal());
      if (u < 1 - 0.0331 * x * x * x * x) return boost * d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return boost * d * v;
    }
  });
  const total = gammas.reduce((sum, value) => sum + value, 0);
  return gammas.map(value => value / total);
}

export function simulateMultiAggregateProbability(prior, snapshot, settings = {}, previousInputHash) {
  check(prior?.inputMode === 'race-total-multi' && prior.method === 'dirichlet-remaining-count' &&
    prior.modelVersion === multiAggregateModelVersion, 'unknown input mode or model');
  check(['house', 'senate', 'governor'].includes(prior.office) &&
    new RegExp('^' + prior.office + '-[A-Z]{2}' + (prior.office === 'house' ? '-(?:AL|[1-9]\\d?)' : '') + '$').test(prior.raceId) &&
    prior.electionDate === '2026-11-03' && prior.rule === 'plurality' &&
    probabilityRule(prior.raceId, prior.electionDate) === 'plurality', 'unsupported office or election rule');
  const ids = prior.candidateIds;
  check(Array.isArray(ids) && ids.length >= 2 && ids.length <= 20 && new Set(ids).size === ids.length &&
    ids.every(id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id)), '2-20 stable candidate identities required');
  check(dated(prior.anchorAvailableAt) && Date.parse(prior.anchorAvailableAt) < Date.parse(prior.electionDate + 'T00:00:00Z'),
    'anchor must precede Election Day');
  check(snapshot?.raceId === prior.raceId && snapshot.electionDate === prior.electionDate && snapshot.source === 'NBC News' &&
    dated(snapshot.at) && dated(snapshot.sourceUpdatedAt) && Date.parse(snapshot.sourceUpdatedAt) <= Date.parse(snapshot.at),
    'matching dated NBC input required');
  check(Array.isArray(prior.units) && prior.units.length === 1 && prior.units[0].id === 'race:' + prior.raceId &&
    prior.units[0].weight === 1, 'one explicit race reporting unit required');
  const shares = prior.units[0].shares;
  check(shares && ids.every(id => Number.isFinite(shares[id]) && shares[id] > 0) &&
    Math.abs(ids.reduce((sum, id) => sum + shares[id], 0) - 1) < 1e-6, 'invalid pre-election share center');
  check(Number.isFinite(prior.shareConcentration) && prior.shareConcentration >= 2 && prior.shareConcentration <= 500,
    'invalid Dirichlet concentration');
  check(Array.isArray(snapshot.units) && snapshot.units.length === 1 && snapshot.units[0].id === prior.units[0].id,
    'race reporting unit identity mismatch');
  const unit = snapshot.units[0];
  check(dated(unit.availableAt) && Date.parse(unit.availableAt) <= Date.parse(snapshot.at) && unit.complete !== true,
    'race estimates cannot certify reporting-unit completion');
  check(Object.keys(snapshot.totals || {}).length === ids.length && Object.keys(unit.votes || {}).length === ids.length &&
    ids.every(id => Number.isSafeInteger(snapshot.totals[id]) && snapshot.totals[id] >= 0 && unit.votes[id] === snapshot.totals[id]),
    'malformed or unreconciled candidate counts');
  const reported = ids.reduce((sum, id) => sum + unit.votes[id], 0);
  const percent = snapshot.expectedVotePercent;
  check(Number.isSafeInteger(reported), 'unsafe candidate total');
  if (reported <= 0 || !Number.isFinite(percent) || percent < 60 || percent > 100 || unit.expectedVotePercent !== percent)
    return {status: 'unavailable', reason: 'The multi-candidate race-total model requires positive NBC counts and at least 60% source-estimated reporting.'};
  const simulations = settings.simulations ?? 20000;
  check(simulations === 20000, '20,000 simulations required');
  check(settings.implementationHash === undefined || /^[a-f0-9]{64}$/.test(settings.implementationHash), 'invalid implementation identity');
  const priorHash = hash(prior);
  const inputHash = hash([multiAggregateModelVersion, 'race-total-multi', settings.implementationHash ?? null, priorHash,
    ids.map(id => unit.votes[id]), percent, simulations]);
  if (inputHash === previousInputHash) return {status: 'unchanged', inputHash};

  const countedShare = Math.min(0.999, Math.max(0.01, percent / 100));
  const estimatedFinal = reported / countedShare;
  const remainingMean = Math.max(0, estimatedFinal - reported);
  const empirical = ids.map(id => (unit.votes[id] + 1e-6) / (reported + ids.length * 1e-6));
  const center = ids.map(id => shares[id]);
  // Weight counted shares more heavily as reporting advances; keep a floor on
  // the frozen center so early leaders cannot erase the prior completely.
  const countedWeight = Math.min(0.75, Math.max(0.12, (percent - 60) / 50));
  const blend = center.map((value, index) => (1 - countedWeight) * value + countedWeight * empirical[index]);
  const blendTotal = blend.reduce((sum, value) => sum + value, 0);
  const blended = blend.map(value => value / blendTotal);
  // Soften concentration at high reporting so 80% intervals stay calibrated when
  // little vote remains; never drop below the adapter's declared lower bound.
  const effectiveConcentration = Math.max(2, prior.shareConcentration * (0.35 + 0.65 * (1 - countedShare)));
  const alpha = blended.map(value => value * effectiveConcentration);
  const normal = rng(inputHash);
  const wins = Object.fromEntries(ids.map(id => [id, 0]));
  const margins = [];
  const leadId = ids[0];
  const secondId = ids[1];
  for (let draw = 0; draw < simulations; draw++) {
    const remainingNoise = Math.exp(0.20 * normal());
    const remaining = remainingMean * remainingNoise;
    const sharesDraw = dirichlet(alpha, normal);
    // Small absolute residual noise keeps intervals from collapsing when the
    // source already reports nearly all ballots.
    const residual = 0.004 * estimatedFinal;
    const finals = ids.map((id, index) => unit.votes[id] + remaining * sharesDraw[index] + residual * normal());
    let best = 0;
    for (let index = 1; index < finals.length; index++) if (finals[index] > finals[best]) best = index;
    const tied = finals.filter(value => Math.abs(value - finals[best]) < 1e-9);
    if (tied.length === 1) wins[ids[best]]++;
    else for (const id of ids.filter((_, index) => Math.abs(finals[index] - finals[best]) < 1e-9)) wins[id] += 1 / tied.length;
    const total = finals.reduce((sum, value) => sum + value, 0);
    margins.push(100 * (finals[ids.indexOf(leadId)] - finals[ids.indexOf(secondId)]) / total);
  }
  margins.sort((a, b) => a - b);
  const median = margins[Math.floor(0.5 * (margins.length - 1))];
  const low = margins[Math.floor(0.1 * (margins.length - 1))];
  const high = margins[Math.floor(0.9 * (margins.length - 1))];
  return {
    status: 'research',
    raceId: prior.raceId,
    office: prior.office,
    electionDate: prior.electionDate,
    method: prior.method,
    inputMode: 'race-total-multi',
    modelVersion: multiAggregateModelVersion,
    at: snapshot.at,
    source: snapshot.source,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    priorHash,
    inputHash,
    snapshotId: hash(snapshot),
    simulations,
    reportedVotes: reported,
    verifiedComplete: false,
    geography: {reportedUnits: 1, scheme: 'race-total-multi'},
    candidates: ids.map(id => ({id, probability: wins[id] / simulations})),
    margin: {candidateIds: [leadId, secondId], median, interval80: [low, high]},
    estimatedCounted: countedShare,
  };
}
