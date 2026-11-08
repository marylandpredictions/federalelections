import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {matchBallotCandidate} from './candidate-roster.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function loadPriorAnchors(path = 'data/results/prior-anchors-v1.json') {
  const bytes = readFileSync(path);
  const document = JSON.parse(bytes.toString('utf8'));
  if (document?.schemaVersion !== 1 || !document.races)
    throw Error('Invalid prior-anchors-v1 document');
  return {document, bytes, sha256: hash(bytes)};
}

export function priorAnchorSource(document, sha256, commit) {
  return {
    commit,
    file: 'data/results/prior-anchors-v1.json',
    sha256,
    availableAt: document.availableAt,
  };
}

export function resolveRaceAnchor(race, anchors, {requireNames = true} = {}) {
  const row = anchors.races?.[race.id];
  if (!row || !Number.isFinite(row.projectedMargin) || !Number.isFinite(row.error) || row.error <= 0)
    throw Error('Missing prior anchor uncertainty');
  if (Math.abs(row.projectedMargin) >= 100) throw Error('Prior anchor margin out of range');
  const roster = race.candidates || [];
  let demName = row.demName;
  let repName = row.repName;
  if (demName) demName = matchBallotCandidate({name: demName, partyCode: 'D'}, roster).name;
  if (repName) {
    const party = roster.find(c => c.name === repName || (c.partyCode || c.party) === 'R');
    repName = matchBallotCandidate({name: repName, partyCode: party?.partyCode || party?.party || 'R'}, roster).name;
  }
  if (requireNames && (!demName || !repName || demName === repName))
    throw Error('Missing candidate identities');
  return {
    ...row,
    demName: demName || null,
    repName: repName || null,
    projectedMargin: row.projectedMargin,
    error: row.error,
  };
}
