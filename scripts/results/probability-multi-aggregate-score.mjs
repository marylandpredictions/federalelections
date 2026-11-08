// Score the multi-candidate Dirichlet-remaining-count model on historical
// aggregate study frames. Two-candidate D/R frames are wrapped as
// race-total-multi priors with shareConcentration 40.
//
// Output:
//   data/results/probability-multi-aggregate-validation.json
//   data/results/probability-multi-aggregate-2024-validation.json
//   .runtime/probability-multi-validation-summary.json
//
// Usage: node scripts/results/probability-multi-aggregate-score.mjs [.runtime]

import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {simulateMultiAggregateProbability, multiAggregateModelVersion}
  from './probability-multi-aggregate-adapter.mjs';
import {probabilityRule} from './probability-inputs.mjs';

const root = process.argv[2] || '.runtime';
const CONCENTRATION = 40;

const sha256 = data => createHash('sha256').update(data).digest('hex');

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoAt(at) {
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at)) return at;
  return at.replace(' ', 'T') + 'Z';
}

function mapRaceId2022(studyId, office) {
  const parts = studyId.split('-');
  const state = parts[1].toUpperCase();
  if (office === 'house') {
    const district = parts.length > 3 ? parts.slice(3).join('') : 'AL';
    return `house-${state}-${district}`;
  }
  return `${office}-${state}`;
}

function buildPrior(raceId, office, margin) {
  const shareD = (1 + margin) / 2;
  const shareR = 1 - shareD;
  return {
    inputMode: 'race-total-multi',
    method: 'dirichlet-remaining-count',
    modelVersion: multiAggregateModelVersion,
    office, raceId,
    electionDate: '2026-11-03',
    rule: 'plurality',
    candidateIds: ['dem', 'rep'],
    anchorAvailableAt: '2026-11-02T20:00:00Z',
    shareConcentration: CONCENTRATION,
    units: [{id: 'race:' + raceId, weight: 1,
      shares: {dem: shareD, rep: shareR}}]
  };
}

function buildSnapshot(raceId, d, r, reported, at) {
  const ts = isoAt(at);
  const dv = Math.round(d), rv = Math.round(r);
  return {
    raceId, electionDate: '2026-11-03',
    at: ts, sourceUpdatedAt: ts, source: 'NBC News',
    expectedVotePercent: reported,
    totals: {dem: dv, rep: rv},
    units: [{id: 'race:' + raceId, availableAt: ts,
      expectedVotePercent: reported, votes: {dem: dv, rep: rv}, complete: false}]
  };
}

function summarize(rows, method) {
  const n = rows.length;
  const states = new Set(rows.map(r => r.state)).size;
  let brierSum = 0, logLossSum = 0, infinite = 0, false95 = 0;
  let maeSum = 0, covered = 0, hasMargin = true;
  for (const row of rows) {
    const f = row.forecasts[method];
    const p = f.probabilityD, y = row.winnerD ? 1 : 0;
    brierSum += (p - y) ** 2;
    const op = y ? p : 1 - p;
    if (op === 0) infinite++; else logLossSum += -Math.log(op);
    if ((p >= 0.95 && !y) || (p <= 0.05 && y)) false95++;
    if (f.median !== undefined && f.interval80 !== undefined) {
      maeSum += Math.abs(f.median - row.truthMargin);
      if (row.truthMargin >= f.interval80[0] && row.truthMargin <= f.interval80[1]) covered++;
    } else hasMargin = false;
  }
  const result = {races: n, states, brier: brierSum / n,
    logLoss: infinite ? null : logLossSum / n,
    infiniteLogLossCases: infinite, false95};
  if (hasMargin) {
    result.marginMae = maeSum / n;
    result.coverage80 = covered / n;
  }
  return result;
}

function pairedBrier(rows, method, comparison, draws = 5000) {
  const grouped = {};
  for (const row of rows) {
    const y = row.winnerD ? 1 : 0;
    const diff = (row.forecasts[method].probabilityD - y) ** 2 -
                 (row.forecasts[comparison].probabilityD - y) ** 2;
    (grouped[row.state] ??= []).push(diff);
  }
  const groups = Object.values(grouped);
  if (groups.length < 2) return {status: 'too few independent state clusters'};
  const totals = groups.map(g => g.reduce((s, v) => s + v, 0));
  const sizes = groups.map(g => g.length);
  const k = groups.length;
  const overall = totals.reduce((s, v) => s + v, 0) /
                  sizes.reduce((s, v) => s + v, 0);
  const rand = mulberry32(20261108);
  const samples = [];
  for (let d = 0; d < draws; d++) {
    let st = 0, ss = 0;
    for (let i = 0; i < k; i++) {
      const j = Math.floor(rand() * k); st += totals[j]; ss += sizes[j];
    }
    samples.push(st / ss);
  }
  samples.sort((a, b) => a - b);
  return {method, comparison, stateClusters: k, draws,
    difference: overall,
    interval95: [samples[Math.floor(0.025 * draws)],
                 samples[Math.floor(0.975 * draws)]]};
}

function buildCohortMetrics(rows) {
  if (!rows.length) return null;
  const metrics = {
    multi: summarize(rows, 'multi-aggregate'),
    aggregate: summarize(rows, 'counted-leader'),
    'frozen-source': summarize(rows, 'frozen-source'),
  };
  const paired = ['frozen-source', 'counted-leader']
    .map(c => pairedBrier(rows, 'multi-aggregate', c));
  const false95Ids = rows.filter(r => {
    const p = r.forecasts['multi-aggregate'].probabilityD;
    return (p >= 0.95 && !r.winnerD) || (p <= 0.05 && r.winnerD);
  }).map(r => r.id);
  return {metrics, paired, false95Ids};
}

function scoreStudy(runs, mapId) {
  const scored = [], quarantined = [];
  for (const run of runs) {
    const {raceId, office} = mapId(run);
    try {
      if (probabilityRule(raceId, '2026-11-03') !== 'plurality') {
        quarantined.push({id: run.id, reason: 'Non-plurality rule under 2026 mapping'});
        continue;
      }
    } catch { quarantined.push({id: run.id, reason: 'Invalid race identity'}); continue; }
    const ki = run.kernelInput;
    const prior = buildPrior(raceId, office, ki.margin);
    const snapshot = buildSnapshot(raceId, ki.d, ki.r, ki.reported, run.at);
    try {
      const result = simulateMultiAggregateProbability(prior, snapshot);
      if (result.status !== 'research') {
        quarantined.push({id: run.id, reason: result.reason || result.status});
        continue;
      }
      const probD = result.candidates.find(c => c.id === 'dem').probability;
      scored.push({
        id: run.id, raceId, office, state: run.state,
        at: run.at, reported: ki.reported,
        anchorMarginPoints: run.anchorMarginPoints,
        truthMargin: run.truthMargin, winnerD: run.winnerD,
        forecasts: {
          'multi-aggregate': {probabilityD: probD,
            median: result.margin.median, interval80: result.margin.interval80},
          'frozen-source': run.forecasts['frozen-source'],
          'counted-leader': {probabilityD: ki.d > ki.r ? 1 : ki.d < ki.r ? 0 : 0.5}
        }
      });
    } catch (e) {
      quarantined.push({id: run.id, reason: e.message});
    }
  }
  return {scored, quarantined};
}

// ── Main ──
const study2022Raw = await readFile(join(root, 'probability-aggregate-study.json'));
const study2022 = JSON.parse(study2022Raw);
const study2024Raw = await readFile(join(root, 'probability-aggregate-2024-study.json'));
const study2024 = JSON.parse(study2024Raw);
const plan = JSON.parse(await readFile('data/results/probability-house-forward-plan.json', 'utf8'));
const inspected = new Set(plan.previouslyInspected);

console.log('Scoring 2022 study (' + study2022.runs.length + ' runs)...');
const t0 = performance.now();
const {scored: scored2022, quarantined: q2022} = scoreStudy(study2022.runs,
  run => ({raceId: mapRaceId2022(run.id, run.office), office: run.office}));
console.log('  ' + scored2022.length + ' scored, ' + q2022.length +
  ' quarantined in ' + (performance.now() - t0).toFixed(0) + 'ms');

console.log('Scoring 2024 study (' + study2024.runs.length + ' runs)...');
const t1 = performance.now();
const {scored: scored2024, quarantined: q2024} = scoreStudy(study2024.runs,
  run => ({raceId: 'senate-' + run.state, office: 'senate'}));
console.log('  ' + scored2024.length + ' scored, ' + q2024.length +
  ' quarantined in ' + (performance.now() - t1).toFixed(0) + 'ms');

// ── Build 2022 validation ──
const cohorts2022 = {};
for (const [officeName, filter] of [
  ['all', () => true],
  ['house', r => r.office === 'house'],
  ['senate', r => r.office === 'senate'],
  ['governor', r => r.office === 'governor'],
  ['house-not-previously-inspected', r => r.office === 'house' && !inspected.has(r.id)]
]) {
  const selected = scored2022.filter(filter);
  if (!selected.length) continue;
  cohorts2022[officeName] = {};
  for (const [groupName, groupFilter] of [
    ['all', () => true],
    ['prior-competitive', r => Math.abs(r.anchorMarginPoints) <= 10],
    ['60-100', r => r.reported >= 60],
    ['60-100-prior-competitive', r => r.reported >= 60 && Math.abs(r.anchorMarginPoints) <= 10],
    ['50-100', r => r.reported >= 50],
    ['50-100-prior-competitive', r => r.reported >= 50 && Math.abs(r.anchorMarginPoints) <= 10]
  ]) {
    const rows = selected.filter(groupFilter);
    if (!rows.length) continue;
    const cohort = buildCohortMetrics(rows);
    if (cohort) cohorts2022[officeName][groupName] = cohort;
  }
}

const validation2022 = {
  status: 'Exploratory multi-candidate evidence on previously inspected races; no release approval',
  studySha256: sha256(study2022Raw),
  forecastSha256: sha256(study2022Raw),
  modelVersion: multiAggregateModelVersion,
  shareConcentration: CONCENTRATION,
  simulations: 20000,
  cohorts: cohorts2022,
  quarantined: [...(study2022.quarantined || []), ...q2022]
};

await writeFile('data/results/probability-multi-aggregate-validation.json',
  JSON.stringify(validation2022, null, 2));
console.log('Wrote data/results/probability-multi-aggregate-validation.json');

// ── Build 2024 validation ──
const cohorts2024 = {};
for (const [name, filter] of [
  ['all', () => true],
  ['prior-competitive', r => Math.abs(r.anchorMarginPoints) <= 10],
  ['60-100', r => r.reported >= 60],
  ['60-100-prior-competitive', r => r.reported >= 60 && Math.abs(r.anchorMarginPoints) <= 10],
  ['50-100', r => r.reported >= 50],
  ['50-100-prior-competitive', r => r.reported >= 50 && Math.abs(r.anchorMarginPoints) <= 10]
]) {
  const rows = scored2024.filter(filter);
  if (!rows.length) continue;
  const multi = summarize(rows, 'multi-aggregate');
  const frozen = summarize(rows, 'frozen-source');
  const paired = pairedBrier(rows, 'multi-aggregate', 'frozen-source');
  const false95Ids = rows.filter(r => {
    const p = r.forecasts['multi-aggregate'].probabilityD;
    return (p >= 0.95 && !r.winnerD) || (p <= 0.05 && r.winnerD);
  }).map(r => r.id);
  cohorts2024[name] = {
    states: new Set(rows.map(r => r.state)).size,
    frames: rows.length,
    metrics: {
      multi: {brier: multi.brier, coverage80: multi.coverage80, false95Ids},
      'frozen-source': {brier: frozen.brier},
    },
    pairedBrierDifference: paired,
  };
}

const validation2024 = {
  status: 'Research confirmation; not a production release',
  studySha256: sha256(study2024Raw),
  forecastSha256: sha256(study2024Raw),
  modelVersion: multiAggregateModelVersion,
  shareConcentration: CONCENTRATION,
  simulations: 20000,
  cohorts: cohorts2024,
  quarantined: [...(study2024.quarantined || []), ...q2024]
};

await writeFile('data/results/probability-multi-aggregate-2024-validation.json',
  JSON.stringify(validation2024, null, 2));
console.log('Wrote data/results/probability-multi-aggregate-2024-validation.json');

// ── Summary ──
function cohortSummary(c) {
  return {
    races: c.metrics['multi-aggregate']?.races,
    states: c.metrics['multi-aggregate']?.states,
    brier: c.metrics['multi-aggregate']?.brier,
    false95: c.metrics['multi-aggregate']?.false95,
    coverage80: c.metrics['multi-aggregate']?.coverage80,
    marginMae: c.metrics['multi-aggregate']?.marginMae,
    frozenSourceBrier: c.metrics['frozen-source']?.brier,
    pairedVsFrozen: c.paired?.find(p => p.comparison === 'frozen-source')
  };
}

const summary = {
  modelVersion: multiAggregateModelVersion,
  shareConcentration: CONCENTRATION,
  '2022': {
    scored: scored2022.length, quarantined: q2022.length,
    cohorts: Object.fromEntries(Object.entries(cohorts2022).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v).map(([g, c]) =>
        [g, cohortSummary(c)]))]))
  },
  '2024': {
    scored: scored2024.length, quarantined: q2024.length,
    cohorts: Object.fromEntries(Object.entries(cohorts2024).map(([k, v]) =>
      [k, {states: v.states, frames: v.frames,
            brier: v.metrics['multi-aggregate']?.brier,
            false95: v.metrics['multi-aggregate']?.false95,
            coverage80: v.metrics['multi-aggregate']?.coverage80,
            frozenSourceBrier: v.metrics['frozen-source']?.brier,
            pairedVsFrozen: v.pairedBrierDifference}]))
  }
};

await writeFile(join(root, 'probability-multi-validation-summary.json'),
  JSON.stringify(summary, null, 2));
console.log('Wrote ' + join(root, 'probability-multi-validation-summary.json'));
console.log(JSON.stringify(summary, null, 2));
