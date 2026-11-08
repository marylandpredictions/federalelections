// Build FEA Trump approval aggregate from VoteHub public approval polls.
import {mkdirSync, writeFileSync} from 'fs';
import {dirname} from 'path';
import {pathToFileURL} from 'url';

const clamp = (lo, hi, value) => Math.min(hi, Math.max(lo, value));
const normalize = s => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export const TRUMP_APPROVAL_METHOD =
  'Weighted mean of eligible VoteHub public Trump job-approval polls in the 45 days ' +
  'through the as-of date. Weights: recency half-life 21 days, sqrt(sample size) capped ' +
  '0.55x–2.10x, LV 1.15 / RV 1.05 / adult 1.0, partisan 0.78, repeated pollster ' +
  '1/sqrt(1+prior weight). Same pollster+end date collapsed to the preferred population. ' +
  'Internals excluded. This is an FEA aggregate of VoteHub data (CC BY 4.0), not VoteHub’s ' +
  'published average or a forecast.';

const POPULATION_WEIGHT = {lv: 1.15, rv: 1.05, a: 1, v: 0.9};
const POPULATION_RANK = {lv: 3, rv: 2, a: 1, v: 0};

function answerPct(answers, want) {
  const hits = (answers || []).filter(a => normalize(a.choice) === want);
  if (hits.length !== 1 || typeof hits[0].pct !== 'number' || !Number.isFinite(hits[0].pct))
    return null;
  if (hits[0].pct < 0 || hits[0].pct > 100) return null;
  return hits[0].pct;
}

export function normalizeApprovalPoll(raw) {
  if (!raw || raw.poll_type !== 'approval' || raw.internal) return null;
  const approve = answerPct(raw.answers, 'approve');
  const disapprove = answerPct(raw.answers, 'disapprove');
  if (approve == null || disapprove == null) return null;
  const population = String(raw.population || '').toLowerCase();
  if (!(population in POPULATION_WEIGHT)) return null;
  const endDate = String(raw.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const sampleSize = Number(raw.sample_size);
  return {
    id: String(raw.id || `${normalize(raw.pollster)}-${endDate}`),
    pollster: String(raw.pollster || 'Unknown'),
    endDate,
    startDate: String(raw.start_date || endDate).slice(0, 10),
    population,
    sampleSize: Number.isFinite(sampleSize) && sampleSize > 0 ? sampleSize : null,
    partisan: Boolean(raw.partisan),
    approve,
    disapprove,
    net: approve - disapprove,
    url: raw.url || null,
  };
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

export function weightApprovalPolls(rows, {asOf, windowDays = 45}) {
  const asOfMs = Date.parse(`${asOf}T12:00:00Z`);
  const eligible = rows.filter(p => {
    const age = (asOfMs - Date.parse(`${p.endDate}T12:00:00Z`)) / 86400000;
    return age >= 0 && age <= windowDays;
  });
  const collapsed = collapseSamePollsterDay(eligible);
  const pollsterTotals = {};
  let weightSum = 0;
  let weightedApprove = 0;
  let weightedDisapprove = 0;
  let weightedNet = 0;
  let weightedSquare = 0;
  const weighted = [];
  const ordered = [...collapsed].sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  for (const poll of ordered) {
    const age = Math.max(0, (asOfMs - Date.parse(`${poll.endDate}T12:00:00Z`)) / 86400000);
    const populationWeight = POPULATION_WEIGHT[poll.population] || 1;
    const sampleWeight = clamp(0.55, 2.1, Math.sqrt(poll.sampleSize || 800) / 30);
    const recencyWeight = Math.pow(0.5, age / 21);
    const partisanWeight = poll.partisan ? 0.78 : 1;
    const pollsterKey = normalize(poll.pollster);
    const repeatWeight = 1 / Math.sqrt(1 + (pollsterTotals[pollsterKey] || 0));
    const weight = populationWeight * sampleWeight * recencyWeight * partisanWeight * repeatWeight;
    pollsterTotals[pollsterKey] = (pollsterTotals[pollsterKey] || 0) + weight;
    weightSum += weight;
    weightedApprove += poll.approve * weight;
    weightedDisapprove += poll.disapprove * weight;
    weightedNet += poll.net * weight;
    weightedSquare += poll.net * poll.net * weight;
    weighted.push({...poll, weight, ageDays: age});
  }
  if (!weightSum) return null;
  const approve = weightedApprove / weightSum;
  const disapprove = weightedDisapprove / weightSum;
  const net = weightedNet / weightSum;
  const disagreement = Math.sqrt(Math.max(0, weightedSquare / weightSum - net * net));
  const effectivePollsters = Object.keys(pollsterTotals).length;
  return {
    approve,
    disapprove,
    net,
    disagreement,
    pollCount: weighted.length,
    effectivePollsters,
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

export function buildTrumpApproval(rawPolls, {asOf} = {}) {
  const polls = collapseSamePollsterDay(
    rawPolls.map(normalizeApprovalPoll).filter(Boolean),
  ).sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  if (!polls.length) throw Error('No usable Trump approval polls');
  const latest = polls.at(-1).endDate;
  const first = polls[0].endDate;
  const currentAsOf = asOf && asOf >= first && asOf <= latest ? asOf : latest;
  const current = weightApprovalPolls(polls, {asOf: currentAsOf});
  if (!current) throw Error('Unable to form current approval average');

  const series = [];
  for (const day of eachDay(first, currentAsOf)) {
    const point = weightApprovalPolls(polls, {asOf: day});
    if (!point || point.pollCount < 2) continue;
    // Keep roughly weekly density early, denser near the end for chart size.
    const ageFromEnd = (Date.parse(`${currentAsOf}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000;
    const keep = ageFromEnd <= 120 || day.endsWith('-01') || day.endsWith('-08') ||
      day.endsWith('-15') || day.endsWith('-22') || day === first || day === currentAsOf;
    if (!keep) continue;
    series.push({
      date: day,
      approve: Number(point.approve.toFixed(2)),
      disapprove: Number(point.disapprove.toFixed(2)),
      net: Number(point.net.toFixed(2)),
      pollCount: point.pollCount,
      effectivePollsters: point.effectivePollsters,
    });
  }

  const recentPolls = current.polls.slice(0, 40).map(p => ({
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
  }));

  return {
    schemaVersion: 1,
    subject: 'Donald Trump',
    asOf: currentAsOf,
    builtAt: new Date().toISOString(),
    source: 'VoteHub public polling API',
    sourceUrl: 'https://votehub.com/polls/api/',
    license: 'CC BY 4.0',
    method: TRUMP_APPROVAL_METHOD,
    windowDays: 45,
    coverage: {firstPoll: first, latestPoll: latest, usablePolls: polls.length},
    current: {
      approve: Number(current.approve.toFixed(1)),
      disapprove: Number(current.disapprove.toFixed(1)),
      net: Number(current.net.toFixed(1)),
      disagreement: Number(current.disagreement.toFixed(2)),
      pollCount: current.pollCount,
      effectivePollsters: current.effectivePollsters,
      latestPoll: current.latestPoll,
    },
    series,
    recentPolls,
  };
}

async function main() {
  const response = await fetch(
    'https://api.votehub.com/polls?poll_type=approval&subject=trump',
    {signal: AbortSignal.timeout(60000)},
  );
  if (!response.ok) throw Error(`VoteHub HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 8_000_000) throw Error('Oversized approval response');
  const data = JSON.parse(body);
  if (!Array.isArray(data)) throw Error('Unexpected VoteHub schema');
  const result = buildTrumpApproval(data);
  const out = 'data/polling/trump-approval.json';
  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(
    `Trump approval: ${result.current.approve}% / ${result.current.disapprove}% ` +
    `(net ${result.current.net >= 0 ? '+' : ''}${result.current.net}) · ` +
    `${result.current.pollCount} polls · as of ${result.asOf} · ${result.series.length} series points`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
