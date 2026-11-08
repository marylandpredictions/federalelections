// Compile race prior anchors from VoteHub poll aggregates and Kalshi market
// implied margins, with an uninformative fallback when neither qualifies.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {pollingReference} from './polling-reference.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const partyOf = c => c.partyCode || c.party;
const clamp = (lo, hi, v) => Math.min(hi, Math.max(lo, v));

function rosterNames(race) {
  const dems = (race.candidates || []).filter(c => partyOf(c) === 'D');
  const reps = (race.candidates || []).filter(c => partyOf(c) === 'R');
  return {
    demName: dems.length === 1 ? dems[0].name : null,
    repName: reps.length === 1 ? reps[0].name : (reps[0]?.name || null),
  };
}

function blendMargins(poll, market) {
  if (poll && market) {
    const wPoll = 1 / (poll.error * poll.error);
    const wMkt = 0.45 / (market.error * market.error);
    const projectedMargin = (wPoll * poll.projectedMargin + wMkt * market.projectedMargin) / (wPoll + wMkt);
    const error = clamp(6, 18, Math.sqrt(1 / (wPoll + wMkt)) * 1.15);
    return {
      projectedMargin: Number(projectedMargin.toFixed(3)),
      error: Number(error.toFixed(3)),
      priorKind: poll.thin ? 'thin-poll-market-blend' : 'poll-market-blend',
    };
  }
  if (poll) {
    return {
      projectedMargin: poll.projectedMargin,
      error: poll.error,
      priorKind: poll.thin ? 'thin-poll' : 'poll-aggregate',
    };
  }
  return {
    projectedMargin: market.projectedMargin,
    error: market.error,
    priorKind: 'kalshi-market',
  };
}

export function buildPriorAnchors(catalogue, pollingFull, {
  availableAt = '2026-11-02T23:59:59.000Z',
  commit = null,
  pollingPath = 'data/results/polling-reference.json',
  pollingSha256 = null,
  kalshi = null,
  kalshiPath = 'data/results/kalshi-race-markets-2026-11-02.json',
  kalshiSha256 = null,
  thinPolling = null,
} = {}) {
  if (!pollingFull?.races || pollingFull.label !== 'FEA race-poll aggregate')
    throw Error('Polling reference must be the FEA race-poll aggregate artifact');
  if (Date.parse(availableAt) >= Date.parse('2026-11-03T00:00:00Z'))
    throw Error('Prior anchors must be available before Election Day');

  const deskPolls = pollingFull.races;
  const thinPolls = thinPolling?.races || {};
  const markets = kalshi?.races || {};
  const races = {};
  const counts = {
    races: 0,
    pollAggregate: 0,
    thinPoll: 0,
    kalshiMarket: 0,
    pollMarketBlend: 0,
    uninformative: 0,
  };

  for (const race of catalogue) {
    if (!/^(house|senate|governor)-/.test(race.id)) continue;
    const office = race.type || race.id.split('-')[0];
    const names = rosterNames(race);
    const desk = deskPolls[race.id];
    const thin = !desk && thinPolls[race.id]?.thin ? thinPolls[race.id] : null;
    const poll = desk || thin;
    const market = markets[race.id];
    counts.races++;

    if (poll || market) {
      const blended = blendMargins(
        poll && Number.isFinite(poll.projectedMargin) && Number.isFinite(poll.error) ? poll : null,
        market && Number.isFinite(market.projectedMargin) && Number.isFinite(market.error) ? market : null,
      );
      const demName = poll?.candidates?.[0]?.name || names.demName;
      const repName = poll?.candidates?.[1]?.name || names.repName;
      const providers = [];
      if (poll) providers.push(poll.thin ? 'VoteHub thin poll' : 'VoteHub poll aggregate');
      if (market) providers.push('Kalshi market');
      races[race.id] = {
        raceId: race.id,
        office,
        projectedMargin: blended.projectedMargin,
        error: blended.error,
        demName,
        repName,
        matchupStatus: demName && repName ? 'CONFIRMED_MATCHUP' : 'PARTIAL_MATCHUP',
        priorKind: blended.priorKind,
        pollCount: poll?.pollCount || 0,
        effectivePollsters: poll?.effectivePollsters || 0,
        demProb: market?.demProb,
        marketVolume: market?.volume,
        availableAt,
        source: {
          provider: providers.join(' + '),
          file: market && !poll ? kalshiPath : pollingPath,
          sha256: market && !poll ? kalshiSha256 : pollingSha256,
          url: market && !poll ? kalshi?.sourceUrl : pollingFull.sourceUrl,
          commit,
          ...(market ? {kalshiFile: kalshiPath, kalshiSha256} : {}),
          ...(poll ? {pollingFile: pollingPath, pollingSha256} : {}),
        },
      };
      if (blended.priorKind === 'poll-aggregate') counts.pollAggregate++;
      else if (blended.priorKind === 'thin-poll') counts.thinPoll++;
      else if (blended.priorKind === 'kalshi-market') counts.kalshiMarket++;
      else counts.pollMarketBlend++;
      continue;
    }

    races[race.id] = {
      raceId: race.id,
      office,
      projectedMargin: 0,
      error: 15,
      demName: names.demName,
      repName: names.repName,
      matchupStatus: names.demName && names.repName ? 'UNINFORMATIVE_MATCHUP' : 'UNINFORMATIVE',
      priorKind: 'uninformative',
      pollCount: 0,
      effectivePollsters: 0,
      availableAt,
      source: {
        provider: 'Uninformative prior (no qualifying poll aggregate or Kalshi market)',
        file: pollingPath,
        sha256: pollingSha256,
        url: pollingFull.sourceUrl,
        commit,
      },
    };
    counts.uninformative++;
  }

  return {
    schemaVersion: 1,
    availableAt,
    asOf: pollingFull.asOf,
    description: 'Race prior anchors: VoteHub poll aggregate (and thin single-pollster), Kalshi implied margins, inverse-variance blends, or uninformative fallback.',
    pollingReference: {
      file: pollingPath,
      sha256: pollingSha256,
      asOf: pollingFull.asOf,
      label: pollingFull.label,
      matchedRaces: Object.keys(deskPolls).length,
    },
    ...(kalshi ? {
      kalshiMarkets: {
        file: kalshiPath,
        sha256: kalshiSha256,
        asOf: kalshi.asOf,
        matchedRaces: Object.keys(markets).length,
      },
    } : {}),
    counts,
    races,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pollingPath = 'data/results/polling-reference.json';
  const kalshiPath = 'data/results/kalshi-race-markets-2026-11-02.json';
  const pollingBytes = readFileSync(pollingPath);
  const polling = JSON.parse(pollingBytes.toString('utf8'));
  const catalogue = JSON.parse(readFileSync('data/election-night-races.json', 'utf8')).races;
  let kalshi = null;
  let kalshiBytes = null;
  try {
    kalshiBytes = readFileSync(kalshiPath);
    kalshi = JSON.parse(kalshiBytes.toString('utf8'));
  } catch {
    console.warn('Kalshi markets artifact missing; building poll/uninformative anchors only');
  }

  // Thin single-pollster VoteHub signals for prior use only (not desk display).
  let thinPolling = null;
  try {
    const types = {house: 'us-representative', senate: 'us-senator', governor: 'governor'};
    const polls = [];
    for (const type of Object.values(types)) {
      const r = await fetch(
        `https://api.votehub.com/polls?poll_type=${type}&subject=2026&from_date=2026-09-03`,
        {signal: AbortSignal.timeout(30000)},
      );
      if (!r.ok) throw Error(`VoteHub HTTP ${r.status}`);
      const data = JSON.parse(await r.text());
      if (!Array.isArray(data)) throw Error('Unexpected VoteHub schema');
      polls.push(...data);
    }
    thinPolling = pollingReference(catalogue, polls, {
      minPollsters: 1,
      label: 'FEA thin race-poll aggregate',
    });
  } catch (error) {
    console.warn('Thin poll rebuild skipped:', error.message);
  }

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
    kalshi,
    kalshiPath,
    kalshiSha256: kalshiBytes ? hash(kalshiBytes) : null,
    thinPolling,
  });
  writeFileSync('data/results/prior-anchors-v1.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.counts));
}
