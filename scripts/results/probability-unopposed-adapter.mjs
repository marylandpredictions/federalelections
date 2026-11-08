// Unopposed plurality races: the sole reviewed candidate is certain once the
// NBC named field confirms that identity. This does not invent opponents.
import {createHash} from 'node:crypto';
import {probabilityRule} from './probability-inputs.mjs';

export const unopposedModelVersion = 'fea-live-unopposed-1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dated = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const check = (condition, message) => { if (!condition) throw Error('Unopposed model: ' + message); };

export function simulateUnopposedProbability(prior, snapshot, settings = {}, previousInputHash) {
  check(prior?.inputMode === 'unopposed' && prior.method === 'sole-candidate-certainty' &&
    prior.modelVersion === unopposedModelVersion, 'unknown input mode or model');
  check(['house', 'senate', 'governor'].includes(prior.office) &&
    new RegExp('^' + prior.office + '-[A-Z]{2}' + (prior.office === 'house' ? '-(?:AL|[1-9]\\d?)' : '') + '$').test(prior.raceId) &&
    prior.electionDate === '2026-11-03' && prior.rule === 'plurality' &&
    probabilityRule(prior.raceId, prior.electionDate) === 'plurality', 'unsupported office or election rule');
  check(Array.isArray(prior.candidateIds) && prior.candidateIds.length === 1 &&
    typeof prior.candidateIds[0] === 'string' && /^[\w-]{1,100}$/.test(prior.candidateIds[0]),
  'exactly one stable candidate identity required');
  const [id] = prior.candidateIds;
  check(dated(prior.anchorAvailableAt) && Date.parse(prior.anchorAvailableAt) < Date.parse(prior.electionDate + 'T00:00:00Z'),
    'anchor must precede Election Day');
  check(snapshot?.raceId === prior.raceId && snapshot.electionDate === prior.electionDate && snapshot.source === 'NBC News' &&
    dated(snapshot.at) && dated(snapshot.sourceUpdatedAt) && Date.parse(snapshot.sourceUpdatedAt) <= Date.parse(snapshot.at),
    'matching dated NBC input required');
  check(Array.isArray(prior.units) && prior.units.length === 1 && prior.units[0].id === 'race:' + prior.raceId &&
    prior.units[0].weight === 1, 'one explicit race reporting unit required');
  check(Array.isArray(snapshot.units) && snapshot.units.length === 1 && snapshot.units[0].id === prior.units[0].id,
    'race reporting unit identity mismatch');
  const unit = snapshot.units[0];
  check(dated(unit.availableAt) && Date.parse(unit.availableAt) <= Date.parse(snapshot.at) && unit.complete !== true,
    'race estimates cannot certify reporting-unit completion');
  check(Object.keys(snapshot.totals || {}).length === 1 && Object.keys(unit.votes || {}).length === 1 &&
    Number.isSafeInteger(snapshot.totals[id]) && snapshot.totals[id] >= 0 && unit.votes[id] === snapshot.totals[id],
  'malformed sole-candidate counts');
  // Sole-candidate certainty does not depend on remaining-vote modeling. NBC may
  // list and even project the only reviewed candidate before a reporting %.
  const percent = snapshot.expectedVotePercent;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || unit.expectedVotePercent !== percent)
    return {status: 'unavailable', reason: 'The unopposed model requires a finite NBC source-estimated reporting share.'};
  check((settings.simulations ?? 20000) === 20000, '20,000 simulations required for release policy parity');
  check(settings.implementationHash === undefined || /^[a-f0-9]{64}$/.test(settings.implementationHash), 'invalid implementation identity');
  const priorHash = hash(prior);
  const inputHash = hash([unopposedModelVersion, 'unopposed', settings.implementationHash ?? null, priorHash, unit.votes[id], percent]);
  if (inputHash === previousInputHash) return {status: 'unchanged', inputHash};
  return {
    status: 'research',
    raceId: prior.raceId,
    office: prior.office,
    electionDate: prior.electionDate,
    method: prior.method,
    inputMode: 'unopposed',
    modelVersion: unopposedModelVersion,
    at: snapshot.at,
    source: snapshot.source,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    priorHash,
    inputHash,
    snapshotId: hash(snapshot),
    simulations: 20000,
    reportedVotes: unit.votes[id],
    verifiedComplete: false,
    geography: {reportedUnits: 1, scheme: 'unopposed'},
    candidates: [{id, probability: 1}],
    margin: {candidateIds: [id], median: 100, interval80: [100, 100]},
    estimatedCounted: Math.min(1, percent / 100),
  };
}
