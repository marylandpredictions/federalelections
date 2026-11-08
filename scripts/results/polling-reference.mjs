// FEA weighted aggregate of VoteHub public race polls — not VoteHub's proprietary
// published average or a forecast. Match ballot candidates and exact geography first.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {NbcProvider} from './nbc-provider.mjs';
import {
  POLL_AGGREGATE_METHOD,
  collapseSamePollsterDay,
  matchAnswerPct,
  normalizePollChoice,
  weightRacePolls,
} from './poll-aggregate.mjs';

const types = {house: 'us-representative', senate: 'us-senator', governor: 'governor'};
const partyOf = c => c.partyCode || c.party;

function raceSubject(race) {
  if (race.type === 'house')
    return `2026 ${race.state}-${String(race.district).padStart(2, '0')}`;
  return `2026 ${states[race.state]}`;
}

function headlinerPair(race, polls, wanted, cutoff, asOf) {
  const parties = race.candidates || [];
  const dems = parties.filter(c => partyOf(c) === 'D');
  const reps = parties.filter(c => partyOf(c) === 'R');
  const left = dems.length === 1 ? dems
    : dems.length === 0 ? parties.filter(c => partyOf(c) === 'I') : [];
  if (left.length !== 1 || reps.length < 1) return null;
  const dem = left[0];
  if (reps.length === 1) return [dem, reps[0]];

  // 1D + N R: pick the Republican named most often in eligible polls; ballot order fallback.
  const counts = new Map(reps.map(c => [c.name, 0]));
  for (const p of polls) {
    if (p.poll_type !== types[race.type] || p.subject !== wanted || p.internal === true ||
        !['lv', 'rv'].includes(p.population) || !p.pollster || !p.id || !Array.isArray(p.answers) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.end_date) || Date.parse(p.end_date) < cutoff || p.end_date > asOf)
      continue;
    if (matchAnswerPct(p.answers, dem) == null) continue;
    for (const rep of reps) {
      if (matchAnswerPct(p.answers, rep) != null) counts.set(rep.name, (counts.get(rep.name) || 0) + 1);
    }
  }
  const ranked = [...reps].sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0));
  const best = ranked[0];
  if ((counts.get(best.name) || 0) <= 0) return [dem, reps[0]];
  return [dem, best];
}

function eligiblePollRows(race, pair, polls, wanted, cutoff, asOf) {
  const rows = [];
  for (const p of polls) {
    if (p.poll_type !== types[race.type] || p.subject !== wanted || p.internal === true ||
        !['lv', 'rv'].includes(p.population) || !p.pollster || !p.id || !Array.isArray(p.answers) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.end_date) || Date.parse(p.end_date) < cutoff || p.end_date > asOf)
      continue;
    const dem = matchAnswerPct(p.answers, pair[0]);
    const rep = matchAnswerPct(p.answers, pair[1]);
    if (dem == null || rep == null || dem + rep > 100.2) continue;
    const sample = Number(p.sample_size);
    rows.push({
      id: p.id,
      pollster: p.pollster,
      endDate: p.end_date,
      sampleSize: Number.isFinite(sample) && sample > 0 ? sample : undefined,
      population: p.population,
      partisan: p.partisan || null,
      dem,
      rep,
      margin: dem - rep,
    });
  }
  return collapseSamePollsterDay(rows);
}

export function pollingReference(races, polls, {
  asOf = '2026-11-02',
  minPollsters = 2,
  label = 'FEA race-poll aggregate',
} = {}) {
  const cutoff = Date.parse(asOf) - 60 * 86400000;
  const rows = {};
  for (const race of races) {
    const wanted = raceSubject(race);
    if (!wanted || (race.type !== 'house' && !states[race.state])) continue;
    const pair = headlinerPair(race, polls, wanted, cutoff, asOf);
    if (!pair) continue;
    const selected = eligiblePollRows(race, pair, polls, wanted, cutoff, asOf);
    if (new Set(selected.map(p => normalizePollChoice(p.pollster))).size < minPollsters) continue;
    const agg = weightRacePolls(selected, {asOf});
    if (!agg || agg.effectivePollsters < minPollsters) continue;
    const thin = agg.effectivePollsters < 2;
    rows[race.id] = {
      candidates: pair.map((c, i) => ({
        name: c.name,
        party: partyOf(c),
        percent: Number((i === 0 ? agg.dem : agg.rep).toFixed(1)),
      })),
      projectedMargin: Number(agg.projectedMargin.toFixed(3)),
      // Single-pollster signals stay wide; they only feed priors, not the desk chip.
      error: Number((thin ? Math.max(12, agg.error) : agg.error).toFixed(3)),
      disagreement: Number(agg.disagreement.toFixed(3)),
      pollCount: agg.pollCount,
      effectivePollsters: agg.effectivePollsters,
      thin,
      latestPoll: agg.latestPoll,
      pollIds: agg.pollIds,
      pollWeights: agg.pollWeights,
    };
  }
  return {
    asOf,
    source: 'VoteHub public polling API',
    sourceUrl: 'https://votehub.com/polls/api/',
    license: 'CC BY 4.0',
    label,
    method: POLL_AGGREGATE_METHOD,
    races: rows,
  };
}

const states = {};
Object.assign(states, {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(readFileSync('data/results-provider.json', 'utf8'));
    const catalogue = JSON.parse(readFileSync('data/election-night-races.json', 'utf8')).races;
    const races = await new NbcProvider({sources: config.sources}).fetchResults(catalogue);
    const polls = [];
    for (const type of Object.values(types)) {
      const r = await fetch(
        `https://api.votehub.com/polls?poll_type=${type}&subject=2026&from_date=2026-09-03`,
        {signal: AbortSignal.timeout(30000)},
      );
      if (!r.ok) throw Error(`VoteHub HTTP ${r.status}`);
      const body = await r.text();
      if (body.length > 5000000) throw Error('Oversized polling response');
      const data = JSON.parse(body);
      if (!Array.isArray(data)) throw Error('Unexpected VoteHub schema');
      polls.push(...data);
    }
    const result = pollingReference(races, polls);
    writeFileSync('data/results/polling-reference.json', JSON.stringify(result, null, 2) + '\n');
    console.log(`Polling reference: ${Object.keys(result.races).length} matched races; ${result.asOf}`);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
