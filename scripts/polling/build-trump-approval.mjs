// Build FEA Trump approval aggregate from multiple public poll feeds.
// Soft pollster-nested decay; cross-source duplicates are removed first.
import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';
import {pathToFileURL} from 'url';
import {
  collectApprovalPolls,
  dedupeApprovalPolls,
  fromVoteHub,
} from './approval-sources.mjs';

const clamp = (lo, hi, value) => Math.min(hi, Math.max(lo, value));
const normalize = s => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export const TRUMP_APPROVAL_METHOD =
  'FEA weighted Trump job-approval average from multiple public feeds (VoteHub individual ' +
  'polls, CC BY 4.0, plus Pollfinity’s published poll list). Identical surveys are collapsed ' +
  'across sources by pollster/date/result before weighting. Soft exponential recency decay with ' +
  'no short hard cutoff. When recent polling is thin, the half-life lengthens (about 14→45 days). ' +
  'Within each pollster, polls are recency-weighted; pollsters are then weighted by the recency ' +
  'of their latest poll. LV beats RV beats adults when the same release reports multiple ' +
  'populations. Internals excluded. ENOP is the sum of raw pollster weights before normalization. ' +
  'This is FEA’s own aggregate, not VoteHub’s or Pollfinity’s published average.';

const POPULATION_WEIGHT = {lv: 1.15, rv: 1.05, a: 1, v: 0.9};
const POPULATION_RANK = {lv: 3, rv: 2, a: 1, v: 0};
const DEFAULT_MAX_AGE_DAYS = 180;
const DENSE_HALF_LIFE = 14;
const SPARSE_HALF_LIFE = 45;

export function normalizeApprovalPoll(raw) {
  // Already-normalized multi-source row.
  if (raw && typeof raw.endDate === 'string' && Number.isFinite(raw.approve) && Number.isFinite(raw.disapprove)) {
    const population = String(raw.population || '').toLowerCase();
    if (!(population in POPULATION_WEIGHT)) return null;
    return {
      id: String(raw.id || `${normalize(raw.pollster)}-${raw.endDate}`),
      pollster: String(raw.pollster || 'Unknown'),
      endDate: raw.endDate,
      startDate: String(raw.startDate || raw.endDate).slice(0, 10),
      population,
      sampleSize: Number.isFinite(raw.sampleSize) && raw.sampleSize > 0 ? raw.sampleSize : null,
      partisan: Boolean(raw.partisan),
      approve: raw.approve,
      disapprove: raw.disapprove,
      net: raw.net ?? (raw.approve - raw.disapprove),
      url: raw.url || null,
      sources: raw.sources || [],
    };
  }
  return fromVoteHub(raw);
}

export function collapseSamePollsterDay(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${normalize(row.pollster)}|${row.endDate}`;
    const old = byKey.get(key);
    if (!old ||
        (POPULATION_RANK[row.population] || 0) > (POPULATION_RANK[old.population] || 0) ||
        ((POPULATION_RANK[row.population] || 0) === (POPULATION_RANK[old.population] || 0) &&
          (row.sampleSize || 0) > (old.sampleSize || 0)))
      byKey.set(key, row);
  }
  return [...byKey.values()];
}

function ageDays(asOf, endDate) {
  return (Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${endDate}T12:00:00Z`)) / 86400000;
}

function chooseHalfLife(polls, asOf) {
  const recent = polls.filter(p => {
    const age = ageDays(asOf, p.endDate);
    return age >= 0 && age <= 60;
  });
  const pollsters = new Set(recent.map(p => normalize(p.pollster)));
  // Sparse Trump-approval periods need a long half-life so one new poll
  // cannot spike the chart the way a short hard window did.
  if (recent.length >= 25 && pollsters.size >= 12) return DENSE_HALF_LIFE;
  if (recent.length >= 15 && pollsters.size >= 8) return 21;
  if (recent.length >= 10 && pollsters.size >= 6) return 30;
  return SPARSE_HALF_LIFE;
}

export function weightApprovalPolls(rows, {
  asOf,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
  halfLife,
} = {}) {
  const eligible = rows.filter(p => {
    const age = ageDays(asOf, p.endDate);
    return age >= 0 && age <= maxAgeDays;
  });
  if (!eligible.length) return null;
  const life = halfLife ?? chooseHalfLife(eligible, asOf);

  const byPollster = new Map();
  for (const poll of eligible) {
    const key = normalize(poll.pollster);
    if (!byPollster.has(key)) byPollster.set(key, []);
    byPollster.get(key).push(poll);
  }

  let weightSum = 0;
  let weightedApprove = 0;
  let weightedDisapprove = 0;
  let weightedNet = 0;
  let weightedSquare = 0;
  let enop = 0;
  const weighted = [];

  for (const [, group] of [...byPollster.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...group].sort((a, b) => b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id));
    const latestAge = Math.max(0, ageDays(asOf, ordered[0].endDate));
    const pollsterRecency = Math.pow(0.5, latestAge / life);
    const partisanWeight = ordered.some(p => p.partisan) ? 0.78 : 1;
    const pollsterRaw = pollsterRecency * partisanWeight;
    if (pollsterRaw <= 0) continue;
    enop += pollsterRaw;

    let innerSum = 0;
    const inner = [];
    for (const poll of ordered) {
      const age = Math.max(0, ageDays(asOf, poll.endDate));
      const sampleWeight = clamp(0.55, 2.1, Math.sqrt(poll.sampleSize || 800) / 30);
      const populationWeight = POPULATION_WEIGHT[poll.population] || 1;
      const w = Math.pow(0.5, age / life) * sampleWeight * populationWeight;
      innerSum += w;
      inner.push({poll, w});
    }
    if (!innerSum) continue;

    for (const {poll, w} of inner) {
      const share = w / innerSum;
      const weight = pollsterRaw * share;
      weightSum += weight;
      weightedApprove += poll.approve * weight;
      weightedDisapprove += poll.disapprove * weight;
      weightedNet += poll.net * weight;
      weightedSquare += poll.net * poll.net * weight;
      weighted.push({
        ...poll,
        weight,
        ageDays: Math.max(0, ageDays(asOf, poll.endDate)),
        pollsterWeight: pollsterRaw,
      });
    }
  }

  if (!weightSum) return null;
  const approve = weightedApprove / weightSum;
  const disapprove = weightedDisapprove / weightSum;
  const net = weightedNet / weightSum;
  const disagreement = Math.sqrt(Math.max(0, weightedSquare / weightSum - net * net));
  return {
    approve,
    disapprove,
    net,
    disagreement,
    pollCount: weighted.length,
    effectivePollsters: byPollster.size,
    enop,
    halfLife: life,
    maxAgeDays,
    totalWeight: weightSum,
    latestPoll: weighted.map(p => p.endDate).sort().at(-1),
    polls: weighted.sort((a, b) => b.endDate.localeCompare(a.endDate) || b.weight - a.weight),
  };
}

function eachDay(from, to) {
  const days = [];
  let ms = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  while (ms <= end) {
    days.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86400000;
  }
  return days;
}

export function buildTrumpApproval(rawPolls, {asOf, ingest = null} = {}) {
  const normalized = rawPolls.map(normalizeApprovalPoll).filter(Boolean);
  // Cross-source dedupe first, then same-pollster/day population collapse.
  const deduped = dedupeApprovalPolls(normalized).polls;
  const polls = collapseSamePollsterDay(deduped)
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  if (!polls.length) throw Error('No usable Trump approval polls');
  const latest = polls.at(-1).endDate;
  const first = polls[0].endDate;
  const currentAsOf = asOf && asOf >= first && asOf <= latest ? asOf : latest;
  const current = weightApprovalPolls(polls, {asOf: currentAsOf});
  if (!current) throw Error('Unable to form current approval average');

  const series = [];
  for (const day of eachDay(first, currentAsOf)) {
    const point = weightApprovalPolls(polls, {asOf: day});
    // Skip the unstable warm-up and ultra-thin days that create chart spikes.
    if (!point || point.pollCount < 8 || point.enop < 3) continue;
    const ageFromEnd = (Date.parse(`${currentAsOf}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000;
    const keep = ageFromEnd <= 180 || day.endsWith('-01') || day.endsWith('-08') ||
      day.endsWith('-15') || day.endsWith('-22') || day === currentAsOf;
    if (!keep) continue;
    series.push({
      date: day,
      approve: Number(point.approve.toFixed(2)),
      disapprove: Number(point.disapprove.toFixed(2)),
      net: Number(point.net.toFixed(2)),
      pollCount: point.pollCount,
      effectivePollsters: point.effectivePollsters,
      enop: Number(point.enop.toFixed(2)),
      halfLife: point.halfLife,
    });
  }

  const recentPolls = current.polls.slice(0, 50).map(p => ({
    id: p.id,
    pollster: p.pollster,
    endDate: p.endDate,
    startDate: p.startDate,
    population: p.population,
    sampleSize: p.sampleSize,
    approve: Number(p.approve.toFixed(1)),
    disapprove: Number(p.disapprove.toFixed(1)),
    net: Number(p.net.toFixed(1)),
    weight: Number(p.weight.toFixed(4)),
    url: p.url,
    sources: p.sources || [],
  }));

  return {
    schemaVersion: 3,
    subject: 'Donald Trump',
    asOf: currentAsOf,
    builtAt: new Date().toISOString(),
    source: 'VoteHub + Pollfinity public polls',
    sourceUrl: 'https://votehub.com/polls/api/',
    sources: ingest?.reports || [
      {source: 'votehub', sourceUrl: 'https://votehub.com/polls/api/', license: 'CC BY 4.0'},
      {source: 'pollfinity', sourceUrl: 'https://pollfinity.com/averages.json'},
    ],
    license: 'VoteHub rows CC BY 4.0; Pollfinity rows per Pollfinity terms',
    method: TRUMP_APPROVAL_METHOD,
    windowDays: current.maxAgeDays,
    halfLife: current.halfLife,
    coverage: {
      firstPoll: first,
      latestPoll: latest,
      usablePolls: polls.length,
      collapsedDuplicates: ingest?.collapsed ?? null,
      sourceErrors: ingest?.errors || [],
    },
    current: {
      approve: Number(current.approve.toFixed(1)),
      disapprove: Number(current.disapprove.toFixed(1)),
      net: Number(current.net.toFixed(1)),
      disagreement: Number(current.disagreement.toFixed(2)),
      pollCount: current.pollCount,
      effectivePollsters: current.effectivePollsters,
      enop: Number(current.enop.toFixed(2)),
      halfLife: current.halfLife,
      latestPoll: current.latestPoll,
    },
    series,
    recentPolls,
  };
}

async function main() {
  const ingest = await collectApprovalPolls();
  const result = buildTrumpApproval(ingest.polls, {ingest});
  const out = 'data/polling/trump-approval.json';
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `Trump approval: ${result.current.approve}% / ${result.current.disapprove}% ` +
    `(net ${result.current.net >= 0 ? '+' : ''}${result.current.net}) · ` +
    `${result.current.pollCount} polls · ENOP ${result.current.enop} · ` +
    `half-life ${result.current.halfLife}d · as of ${result.asOf} · ` +
    `${result.series.length} series points · sources ${ingest.sources.join('+')} · ` +
    `deduped ${ingest.collapsed}`,
  );
  for (const report of ingest.reports) {
    console.log(`  ${report.source}: fetched ${report.fetched}, usable ${report.usable}`);
  }
  for (const error of ingest.errors) console.warn(`  ${error.source} failed: ${error.error}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
