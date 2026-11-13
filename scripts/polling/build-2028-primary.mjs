// Build FEA 2028 presidential primary averages (Democratic / Republican).
import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';
import {pathToFileURL} from 'url';
import {
  collectPrimaryPolls,
  canonicalPollster,
  displayCandidate,
} from './primary-sources.mjs';
import {
  POPULATION_WEIGHT,
  POPULATION_RANK,
  ageDays,
  eachDay,
  chooseHalfLife,
  chooseMaxAgeDays,
  sampleSizeWeight,
  pollsterQuality,
} from './weighting.mjs';

const TOP_SERIES = 10;
const MIN_CANDIDATE_POLLS = 4;
const FIELD_RECENT_DAYS = 60;
const FIELD_SHARE = 0.4; // appear in >=40% of recent polls that could have named anyone

export const PRIMARY_METHOD =
  'FEA weighted 2028 presidential primary averages from public feeds (VoteHub individual ' +
  'polls, CC BY 4.0; Wikipedia nationwide primary tables, CC BY-SA; plus Pollfinity when a ' +
  'primary track is published). Identical surveys are collapsed across sources before weighting. ' +
  'Soft exponential recency decay with no short hard cutoff. When recent polling is thick the ' +
  'half-life shortens (about 10–21 days); when it is thin the half-life lengthens (up to about ' +
  '45 days) and the look-back window widens. Within each pollster, polls are recency-weighted; ' +
  'pollsters are then weighted by the recency of their latest poll, with a mild quality prior. ' +
  'LV beats RV beats adults when the same release reports multiple populations. Each ' +
  'candidate’s average uses only polls that explicitly tested them. Headline standings favor ' +
  'candidates tested in a large share of recent polls; others appear in an expanded list. ' +
  'Candidates need at least four tested polls in the window. Poll shares are not renormalized ' +
  'to 100. Undecided/Other omitted. This is FEA’s own aggregate, not VoteHub’s, Wikipedia’s, ' +
  'or Pollfinity’s published average.';

export function collapseSamePollsterDay(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${canonicalPollster(row.pollster)}|${row.endDate}|${row.party}`;
    const old = byKey.get(key);
    if (!old ||
        (POPULATION_RANK[row.population] || 0) > (POPULATION_RANK[old.population] || 0) ||
        ((POPULATION_RANK[row.population] || 0) === (POPULATION_RANK[old.population] || 0) &&
          (row.sampleSize || 0) > (old.sampleSize || 0))) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

export function weightPrimaryPolls(rows, {
  asOf,
  maxAgeDays,
  halfLife,
} = {}) {
  const keyFn = (p) => canonicalPollster(p.pollster);
  const life = halfLife ?? chooseHalfLife(rows, asOf, keyFn);
  const windowDays = maxAgeDays ?? chooseMaxAgeDays(rows, asOf, keyFn);
  const eligible = rows.filter(p => {
    const age = ageDays(asOf, p.endDate);
    return age >= 0 && age <= windowDays;
  });
  if (!eligible.length) return null;

  const byPollster = new Map();
  for (const poll of eligible) {
    const key = canonicalPollster(poll.pollster);
    if (!byPollster.has(key)) byPollster.set(key, []);
    byPollster.get(key).push(poll);
  }

  let weightSum = 0;
  let enop = 0;
  const shareTotals = new Map();
  const weightSumById = new Map();
  const pollCountById = new Map();
  const nameById = new Map();
  const weighted = [];

  for (const [pollsterKey, group] of [...byPollster.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...group].sort((a, b) => b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id));
    const latestAge = Math.max(0, ageDays(asOf, ordered[0].endDate));
    const pollsterRecency = Math.pow(0.5, latestAge / life);
    const partisanWeight = ordered.some(p => p.partisan) ? 0.78 : 1;
    const quality = pollsterQuality(pollsterKey);
    const pollsterRaw = pollsterRecency * partisanWeight * quality;
    if (pollsterRaw <= 0) continue;
    enop += pollsterRaw;

    let innerSum = 0;
    const inner = [];
    for (const poll of ordered) {
      const age = Math.max(0, ageDays(asOf, poll.endDate));
      const w = Math.pow(0.5, age / life) *
        sampleSizeWeight(poll.sampleSize) *
        (POPULATION_WEIGHT[poll.population] || 1);
      innerSum += w;
      inner.push({poll, w});
    }
    if (!innerSum) continue;

    for (const {poll, w} of inner) {
      const share = w / innerSum;
      const weight = pollsterRaw * share;
      weightSum += weight;
      for (const answer of poll.answers) {
        nameById.set(answer.id, answer.name);
        shareTotals.set(answer.id, (shareTotals.get(answer.id) || 0) + answer.pct * weight);
        weightSumById.set(answer.id, (weightSumById.get(answer.id) || 0) + weight);
        pollCountById.set(answer.id, (pollCountById.get(answer.id) || 0) + 1);
      }
      weighted.push({
        ...poll,
        weight,
        ageDays: Math.max(0, ageDays(asOf, poll.endDate)),
      });
    }
  }

  if (!weightSum) return null;
  const candidates = [...shareTotals.entries()]
    .map(([id, total]) => ({
      id,
      name: nameById.get(id) || displayCandidate(id) || id,
      pct: total / (weightSumById.get(id) || weightSum),
      pollCount: pollCountById.get(id) || 0,
    }))
    .filter(c => c.pollCount >= MIN_CANDIDATE_POLLS)
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  return {
    candidates,
    pollCount: weighted.length,
    effectivePollsters: byPollster.size,
    enop,
    halfLife: life,
    maxAgeDays: windowDays,
    totalWeight: weightSum,
    latestPoll: weighted.map(p => p.endDate).sort().at(-1),
    polls: weighted.sort((a, b) => b.endDate.localeCompare(a.endDate) || b.weight - a.weight),
  };
}

function markFieldCandidates(candidates, polls, asOf) {
  const recent = polls.filter(p => {
    const age = ageDays(asOf, p.endDate);
    return age >= 0 && age <= FIELD_RECENT_DAYS;
  });
  const denom = Math.max(1, recent.length);
  const recentCount = new Map();
  for (const poll of recent) {
    for (const answer of poll.answers || []) {
      recentCount.set(answer.id, (recentCount.get(answer.id) || 0) + 1);
    }
  }
  return candidates.map(c => {
    const share = (recentCount.get(c.id) || 0) / denom;
    const inField = share >= FIELD_SHARE || (recentCount.get(c.id) || 0) >= 5;
    return {...c, field: inField, recentPollShare: Number(share.toFixed(2))};
  });
}

function buildPartyAverage(rawPolls, party, {asOf, ingest = null} = {}) {
  const polls = collapseSamePollsterDay(rawPolls.filter(p => p.party === party))
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  if (!polls.length) return null;

  const latest = polls.at(-1).endDate;
  const first = polls[0].endDate;
  const currentAsOf = asOf && asOf >= first && asOf <= latest ? asOf : latest;
  const current = weightPrimaryPolls(polls, {asOf: currentAsOf});
  if (!current) return null;

  const ranked = markFieldCandidates(current.candidates, current.polls, currentAsOf);
  const field = ranked.filter(c => c.field);
  const expanded = ranked.filter(c => !c.field);

  // First pass: daily points with whatever candidates clear the floor that day.
  const daily = [];
  let lastGood = null;
  for (const day of eachDay(first, currentAsOf)) {
    const point = weightPrimaryPolls(polls, {asOf: day});
    if (point && point.pollCount >= 4 && point.enop >= 2) {
      lastGood = {
        date: day,
        candidates: point.candidates,
        pollCount: point.pollCount,
        effectivePollsters: point.effectivePollsters,
        enop: Number(point.enop.toFixed(2)),
        halfLife: point.halfLife,
        carriedForward: false,
      };
      daily.push(lastGood);
      continue;
    }
    if (!lastGood) continue;
    daily.push({...lastGood, date: day, carriedForward: true});
  }

  // Track current field + current top N + anyone who cracked the top 5 recently.
  const tracked = new Map();
  for (const c of field.slice(0, TOP_SERIES)) tracked.set(c.id, c.name);
  for (const c of ranked.slice(0, TOP_SERIES)) tracked.set(c.id, c.name);
  const recentDaily = daily.filter(p => ageDays(currentAsOf, p.date) <= 120);
  for (const point of recentDaily) {
    for (const c of (point.candidates || []).slice(0, 5)) tracked.set(c.id, c.name);
  }
  const trackedIds = [...tracked.keys()];

  const lastPct = new Map();
  const series = daily.map(point => {
    const byId = new Map((point.candidates || []).map(c => [c.id, c]));
    const candidates = trackedIds.map(id => {
      const hit = byId.get(id);
      if (hit) {
        lastPct.set(id, hit.pct);
        return {id, name: hit.name || tracked.get(id) || id, pct: Number(hit.pct.toFixed(2))};
      }
      if (lastPct.has(id)) {
        return {id, name: tracked.get(id) || id, pct: Number(lastPct.get(id).toFixed(2)), carried: true};
      }
      return {id, name: tracked.get(id) || id, pct: null};
    });
    return {
      date: point.date,
      candidates,
      pollCount: point.pollCount,
      effectivePollsters: point.effectivePollsters,
      enop: point.enop,
      halfLife: point.halfLife,
      carriedForward: point.carriedForward,
    };
  });

  const serialize = (c) => ({
    id: c.id,
    name: c.name,
    pct: Number(c.pct.toFixed(1)),
    pollCount: c.pollCount,
    field: Boolean(c.field),
    recentPollShare: c.recentPollShare,
  });

  return {
    party,
    label: party === 'D' ? 'Democratic' : 'Republican',
    asOf: currentAsOf,
    coverage: {
      firstPoll: first,
      latestPoll: latest,
      usablePolls: polls.length,
    },
    current: {
      candidates: ranked.slice(0, 24).map(serialize),
      field: field.slice(0, 16).map(serialize),
      expanded: expanded.slice(0, 16).map(serialize),
      pollCount: current.pollCount,
      effectivePollsters: current.effectivePollsters,
      enop: Number(current.enop.toFixed(2)),
      halfLife: current.halfLife,
      maxAgeDays: current.maxAgeDays,
      latestPoll: current.latestPoll,
    },
    series,
    recentPolls: current.polls.slice(0, 40).map(p => ({
      id: p.id,
      pollster: p.pollster,
      endDate: p.endDate,
      startDate: p.startDate,
      population: p.population,
      sampleSize: p.sampleSize,
      weight: Number(p.weight.toFixed(4)),
      url: p.url,
      sources: p.sources || [],
      answers: p.answers
        .slice()
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 10)
        .map(a => ({id: a.id, name: a.name, pct: Number(a.pct.toFixed(1))})),
    })),
    ingestNotes: ingest || null,
  };
}

export function build2028Primary(rawPolls, {asOf, ingest = null} = {}) {
  const democratic = buildPartyAverage(rawPolls, 'D', {asOf, ingest});
  const republican = buildPartyAverage(rawPolls, 'R', {asOf, ingest});
  if (!democratic && !republican) throw new Error('No usable 2028 primary averages');

  return {
    schemaVersion: 2,
    race: '2028 presidential primary',
    builtAt: new Date().toISOString(),
    source: 'VoteHub + Wikipedia + Pollfinity public polls',
    sourceUrl: 'https://votehub.com/polls/api/',
    sources: ingest?.reports || [
      {source: 'votehub', sourceUrl: 'https://votehub.com/polls/api/', license: 'CC BY 4.0'},
      {source: 'wikipedia', license: 'CC BY-SA'},
      {source: 'pollfinity', sourceUrl: 'https://pollfinity.com/averages.json'},
    ],
    license: 'VoteHub rows CC BY 4.0; Wikipedia tables CC BY-SA; Pollfinity rows per Pollfinity terms',
    method: PRIMARY_METHOD,
    parties: {
      ...(democratic ? {D: democratic} : {}),
      ...(republican ? {R: republican} : {}),
    },
    availableParties: [
      ...(democratic ? ['D'] : []),
      ...(republican ? ['R'] : []),
    ],
    coverage: {
      collapsedDuplicates: ingest?.collapsed ?? null,
      sourceErrors: ingest?.errors || [],
    },
  };
}

async function main() {
  const ingest = await collectPrimaryPolls();
  const result = build2028Primary(ingest.polls, {ingest});
  const out = 'data/polling/2028-primary.json';
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `2028 primary: parties ${result.availableParties.join('+')} · ` +
    `D polls ${result.parties.D?.coverage.usablePolls ?? 0} · ` +
    `R polls ${result.parties.R?.coverage.usablePolls ?? 0} · ` +
    `sources ${ingest.sources.join('+')} · deduped ${ingest.collapsed}`,
  );
  for (const report of ingest.reports) {
    console.log(`  ${report.source}: fetched ${report.fetched}, usable ${report.usable}`);
  }
  for (const error of ingest.errors) console.warn(`  ${error.source} failed: ${error.error}`);
  for (const party of result.availableParties) {
    const block = result.parties[party];
    const top = (block.current.field || block.current.candidates || []).slice(0, 5)
      .map(c => `${c.name} ${c.pct}%`).join(', ');
    console.log(`  ${party} as of ${block.asOf} · half-life ${block.current.halfLife}d · ${top}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
