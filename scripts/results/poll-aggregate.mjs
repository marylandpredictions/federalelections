// Weighted race-poll aggregate over VoteHub public poll rows.
// Not VoteHub's proprietary published average or a forecast.
const clamp = (lo, hi, value) => Math.min(hi, Math.max(lo, value));
export const normalizePollChoice = s => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export const POLL_AGGREGATE_METHOD =
  'Weighted mean of eligible VoteHub public race polls in the 60 days through the as-of date. ' +
  'Weights: recency half-life 45 days, sqrt(sample size) capped 0.55x–2.10x, LV 1.1 / RV 1.0, ' +
  'partisan 0.78, repeated pollster 1/sqrt(1+prior weight). Same pollster+end date collapsed; ' +
  'internals excluded; LV/RV only; exact office/geography and named ballot matchup required; ' +
  'minimum two distinct pollsters. This is an FEA aggregate of VoteHub data (CC BY 4.0), ' +
  'not VoteHub’s published weighted average or a prediction.';

export function collapseSamePollsterDay(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${normalizePollChoice(row.pollster)}|${row.endDate}`;
    const old = byKey.get(key);
    if (!old || (row.population === 'lv' && old.population !== 'lv') ||
        (row.population === old.population && (row.sampleSize || 0) > (old.sampleSize || 0)))
      byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function weightRacePolls(rows, {asOf}) {
  const asOfMs = Date.parse(`${asOf}T12:00:00Z`);
  const pollsterTotals = {};
  let weightSum = 0;
  let weightedDem = 0;
  let weightedRep = 0;
  let weightedMargin = 0;
  let weightedSquare = 0;
  const weighted = [];
  const ordered = [...rows].sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
  for (const poll of ordered) {
    const age = Math.max(0, (asOfMs - Date.parse(`${poll.endDate}T12:00:00Z`)) / 86400000);
    const populationWeight = poll.population === 'lv' ? 1.1 : 1;
    const sampleWeight = clamp(0.55, 2.1, Math.sqrt(poll.sampleSize || 800) / 30);
    const recencyWeight = Math.pow(0.5, age / 45);
    const partisanWeight = poll.partisan ? 0.78 : 1;
    const pollsterKey = normalizePollChoice(poll.pollster);
    const repeatWeight = 1 / Math.sqrt(1 + (pollsterTotals[pollsterKey] || 0));
    const weight = populationWeight * sampleWeight * recencyWeight * partisanWeight * repeatWeight;
    pollsterTotals[pollsterKey] = (pollsterTotals[pollsterKey] || 0) + weight;
    weightSum += weight;
    weightedDem += poll.dem * weight;
    weightedRep += poll.rep * weight;
    weightedMargin += poll.margin * weight;
    weightedSquare += poll.margin * poll.margin * weight;
    weighted.push({...poll, weight, ageDays: age});
  }
  if (!weightSum) return null;
  const dem = weightedDem / weightSum;
  const rep = weightedRep / weightSum;
  const projectedMargin = weightedMargin / weightSum;
  const disagreement = Math.sqrt(Math.max(0, weightedSquare / weightSum - projectedMargin * projectedMargin));
  const effectivePollsters = Object.keys(pollsterTotals).length;
  const error = clamp(6, 18, Math.max(6, disagreement * 1.5, 12 / Math.sqrt(effectivePollsters)));
  return {
    dem,
    rep,
    projectedMargin,
    disagreement,
    error,
    pollCount: weighted.length,
    effectivePollsters,
    totalWeight: weightSum,
    latestPoll: weighted.map(p => p.endDate).sort().at(-1),
    pollIds: weighted.map(p => p.id),
    pollWeights: Object.fromEntries(weighted.map(p => [p.id, Number(p.weight.toFixed(6))])),
  };
}

export function matchAnswerPct(answers, candidate) {
  const want = [candidate.name, candidate.providerName].filter(Boolean).map(normalizePollChoice);
  const hits = answers.filter(a => want.includes(normalizePollChoice(a.choice)));
  if (hits.length !== 1 || typeof hits[0].pct !== 'number' || !Number.isFinite(hits[0].pct) ||
      hits[0].pct < 0 || hits[0].pct > 100)
    return null;
  return hits[0].pct;
}
