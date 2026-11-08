// Special-rule race-total path. First-count majority locks publish immediately.
// Otherwise a scoped terminal stage resolves runoff pairs or first-preference IRV
// transfers without inventing ballot images beyond the named first-count field.
import {createHash} from 'node:crypto';
import {probabilityRule} from './probability-inputs.mjs';
import {firstCountOutcome} from './probability-rule-outcomes.mjs';
import {multiAggregateModelVersion} from './probability-multi-aggregate-adapter.mjs';

export const majorityLockModelVersion = 'fea-live-majority-lock-2';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dated = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const check = (condition, message) => { if (!condition) throw Error('Majority-lock model: ' + message); };

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

function pairKey(ids) {
  return [...ids].sort().join('\0');
}

function runoffWinner(votes, pair, normal) {
  const [a, b] = pair;
  const total = Math.max(1e-9, votes[a] + votes[b]);
  const center = [votes[a] / total, votes[b] / total];
  // Wide runoff uncertainty: historical LA first-round leaders often lose.
  const shares = dirichlet(center.map(value => value * 4), normal);
  return shares[0] >= shares[1] ? a : b;
}

function rankedWinner(votes, normal) {
  const standing = {...votes};
  while (true) {
    const rows = Object.entries(standing).filter(([, value]) => value > 0)
      .sort(([, left], [, right]) => right - left || left.localeCompare(right));
    if (rows.length === 0) return null;
    if (rows.length === 1) return rows[0][0];
    const total = rows.reduce((sum, [, value]) => sum + value, 0);
    if (rows[0][1] > total / 2) return rows[0][0];
    const eliminated = rows[rows.length - 1][0];
    const transfer = standing[eliminated];
    delete standing[eliminated];
    const remaining = Object.keys(standing);
    if (!remaining.length) return null;
    const weights = remaining.map(id => Math.max(1e-9, standing[id]));
    const shares = dirichlet(weights.map(value => value * 8), normal);
    for (let index = 0; index < remaining.length; index++)
      standing[remaining[index]] += transfer * shares[index];
  }
}

function resolveTerminal(rule, votes, outcome, normal) {
  if (outcome.status === 'winner') return outcome.winner;
  if (rule === 'majority-runoff' && outcome.status === 'runoff-required' &&
      Array.isArray(outcome.possible) && outcome.possible.length === 2)
    return runoffWinner(votes, outcome.possible, normal);
  if (rule === 'ranked-choice' && outcome.status === 'transfers-required')
    return rankedWinner(votes, normal);
  if (rule === 'legislative-contingency' && outcome.status === 'legislative-choice-required' &&
      Array.isArray(outcome.possible) && outcome.possible.length >= 2 && outcome.possible.length <= 3)
    return runoffWinner(votes, outcome.possible.slice(0, 2), normal);
  return null;
}

export function simulateMajorityLockProbability(prior, snapshot, settings = {}, previousInputHash) {
  check(prior?.inputMode === 'majority-lock' && prior.method === 'dirichlet-majority-lock' &&
    prior.modelVersion === majorityLockModelVersion, 'unknown input mode or model');
  const rule = probabilityRule(prior.raceId, prior.electionDate);
  check(['majority-runoff', 'ranked-choice', 'legislative-contingency'].includes(rule) && prior.rule === rule,
    'unsupported election rule');
  check(['house', 'senate', 'governor'].includes(prior.office) &&
    new RegExp('^' + prior.office + '-[A-Z]{2}' + (prior.office === 'house' ? '-(?:AL|[1-9]\\d?)' : '') + '$').test(prior.raceId) &&
    prior.electionDate === '2026-11-03', 'unsupported office or election');
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
    return {status: 'unavailable', reason: 'The majority-lock model requires positive NBC counts and at least 60% source-estimated reporting.'};
  const simulations = settings.simulations ?? 20000;
  check(simulations === 20000, '20,000 simulations required');
  check(settings.implementationHash === undefined || /^[a-f0-9]{64}$/.test(settings.implementationHash), 'invalid implementation identity');
  const priorHash = hash(prior);
  const inputHash = hash([majorityLockModelVersion, 'majority-lock-terminal', multiAggregateModelVersion,
    settings.implementationHash ?? null, priorHash, ids.map(id => unit.votes[id]), percent, simulations]);
  if (inputHash === previousInputHash) return {status: 'unchanged', inputHash};

  const countedShare = Math.min(0.999, Math.max(0.01, percent / 100));
  const estimatedFinal = reported / countedShare;
  const remainingMean = Math.max(0, estimatedFinal - reported);
  const empirical = ids.map(id => (unit.votes[id] + 1e-6) / (reported + ids.length * 1e-6));
  const center = ids.map(id => shares[id]);
  const countedWeight = Math.min(0.75, Math.max(0.12, (percent - 60) / 50));
  const blend = center.map((value, index) => (1 - countedWeight) * value + countedWeight * empirical[index]);
  const blendTotal = blend.reduce((sum, value) => sum + value, 0);
  const blended = blend.map(value => value / blendTotal);
  const effectiveConcentration = Math.max(2, prior.shareConcentration * (0.35 + 0.65 * (1 - countedShare)));
  const alpha = blended.map(value => value * effectiveConcentration);
  const normal = rng(inputHash);
  const wins = Object.fromEntries(ids.map(id => [id, 0]));
  let firstCountLocks = 0;
  let terminalResolved = 0;
  let unresolved = 0;
  const runoffPairs = new Set();
  for (let draw = 0; draw < simulations; draw++) {
    const remaining = remainingMean * Math.exp(0.20 * normal());
    const sharesDraw = dirichlet(alpha, normal);
    const residual = 0.004 * estimatedFinal;
    const finals = Object.fromEntries(ids.map((id, index) =>
      [id, Math.max(0, unit.votes[id] + remaining * sharesDraw[index] + residual * normal())]));
    const total = Object.values(finals).reduce((sum, value) => sum + value, 0);
    const outcome = firstCountOutcome(rule, finals, total);
    if (outcome.status === 'runoff-required' && outcome.possible?.length === 2)
      runoffPairs.add(pairKey(outcome.possible));
    const winner = resolveTerminal(rule, finals, outcome, normal);
    if (!winner) {
      unresolved++;
      continue;
    }
    if (outcome.status === 'winner') firstCountLocks++;
    else terminalResolved++;
    wins[winner]++;
  }
  if (unresolved > 0)
    return {status: 'unavailable', reason: 'Simulated returns still require an unsupported later stage under this election rule.',
      unresolvedShare: unresolved / simulations};
  return {
    status: 'research',
    raceId: prior.raceId,
    office: prior.office,
    electionDate: prior.electionDate,
    method: prior.method,
    inputMode: 'majority-lock',
    modelVersion: majorityLockModelVersion,
    kernelVersion: multiAggregateModelVersion,
    at: snapshot.at,
    source: snapshot.source,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    priorHash,
    inputHash,
    snapshotId: hash(snapshot),
    simulations,
    reportedVotes: reported,
    verifiedComplete: false,
    geography: {reportedUnits: 1, scheme: 'majority-lock'},
    candidates: ids.map(id => ({id, probability: wins[id] / simulations})),
    margin: {candidateIds: [ids[0], ids[1]], median: null, interval80: null},
    estimatedCounted: countedShare,
    rule,
    firstCountLockShare: firstCountLocks / simulations,
    terminalResolvedShare: terminalResolved / simulations,
    runoffPairCount: runoffPairs.size,
  };
}
