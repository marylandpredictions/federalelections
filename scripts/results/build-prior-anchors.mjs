// Compile race prior anchors from the FEA VoteHub race-poll aggregate, with an
// uninformative fallback when a race has no qualifying aggregate.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const partyOf = c => c.partyCode || c.party;

export function buildPriorAnchors(catalogue, pollingReference, {
  availableAt = '2026-11-02T23:59:59.000Z',
  commit = null,
  pollingPath = 'data/results/polling-reference.json',
  pollingSha256 = null,
} = {}) {
  if (!pollingReference?.races || pollingReference.label !== 'FEA race-poll aggregate')
    throw Error('Polling reference must be the FEA race-poll aggregate artifact');
  if (Date.parse(availableAt) >= Date.parse('2026-11-03T00:00:00Z'))
    throw Error('Prior anchors must be available before Election Day');
  const races = {};
  let pollAggregate = 0;
  let uninformative = 0;
  for (const race of catalogue) {
    if (!/^(house|senate|governor)-/.test(race.id)) continue;
    const office = race.type || race.id.split('-')[0];
    const poll = pollingReference.races[race.id];
    const dems = (race.candidates || []).filter(c => partyOf(c) === 'D');
    const reps = (race.candidates || []).filter(c => partyOf(c) === 'R');
    if (poll?.candidates?.length === 2 && Number.isFinite(poll.projectedMargin) && Number.isFinite(poll.error)) {
      races[race.id] = {
        raceId: race.id,
        office,
        projectedMargin: poll.projectedMargin,
        error: poll.error,
        demName: poll.candidates[0].name,
        repName: poll.candidates[1].name,
        matchupStatus: 'CONFIRMED_MATCHUP',
        priorKind: 'poll-aggregate',
        pollCount: poll.pollCount,
        effectivePollsters: poll.effectivePollsters,
        availableAt,
        source: {
          provider: 'VoteHub public polls via FEA race-poll aggregate',
          file: pollingPath,
          sha256: pollingSha256,
          url: pollingReference.sourceUrl,
          commit,
        },
      };
      pollAggregate++;
      continue;
    }
    races[race.id] = {
      raceId: race.id,
      office,
      projectedMargin: 0,
      error: 15,
      demName: dems.length === 1 ? dems[0].name : null,
      repName: reps.length === 1 ? reps[0].name : (reps[0]?.name || null),
      matchupStatus: dems.length === 1 && reps.length >= 1 ? 'UNINFORMATIVE_MATCHUP' : 'UNINFORMATIVE',
      priorKind: 'uninformative',
      pollCount: 0,
      effectivePollsters: 0,
      availableAt,
      source: {
        provider: 'Uninformative prior (no qualifying race-poll aggregate)',
        file: pollingPath,
        sha256: pollingSha256,
        url: pollingReference.sourceUrl,
        commit,
      },
    };
    uninformative++;
  }
  return {
    schemaVersion: 1,
    availableAt,
    asOf: pollingReference.asOf,
    description: 'Race prior anchors for live win probability: FEA VoteHub poll aggregate or uninformative fallback.',
    pollingReference: {
      file: pollingPath,
      sha256: pollingSha256,
      asOf: pollingReference.asOf,
      label: pollingReference.label,
      matchedRaces: Object.keys(pollingReference.races).length,
    },
    counts: {races: Object.keys(races).length, pollAggregate, uninformative},
    races,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pollingPath = 'data/results/polling-reference.json';
  const pollingBytes = readFileSync(pollingPath);
  const polling = JSON.parse(pollingBytes.toString('utf8'));
  const catalogue = JSON.parse(readFileSync('data/election-night-races.json', 'utf8')).races;
  let commit = '0'.repeat(40);
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  } catch {
    // Offline / non-git environments still produce a local research artifact.
  }
  const out = buildPriorAnchors(catalogue, polling, {
    commit,
    pollingPath,
    pollingSha256: hash(pollingBytes),
  });
  writeFileSync('data/results/prior-anchors-v1.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.counts));
}
