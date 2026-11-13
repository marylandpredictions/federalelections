// Shared poll-average weighting helpers (approval + primaries).

export const clamp = (lo, hi, value) => Math.min(hi, Math.max(lo, value));

export const POPULATION_WEIGHT = {lv: 1.2, rv: 1.05, a: 1, v: 0.92};
export const POPULATION_RANK = {lv: 3, rv: 2, a: 1, v: 0};

export const DEFAULT_MAX_AGE_DAYS = 180;
export const DENSE_MAX_AGE_DAYS = 120;
export const DENSE_HALF_LIFE = 14;
export const SPARSE_HALF_LIFE = 45;

// Mild quality priors. Not herding: keeps the average from treating every shop as equal.
// Values stay close to 1 so one firm cannot dominate via a rating alone.
const POLLSTER_QUALITY = new Map(Object.entries({
  nytimesiena: 1.12,
  sienacollege: 1.12,
  yougov: 1.08,
  yougovtheeconomist: 1.08,
  economistyougov: 1.08,
  pewresearchcenter: 1.1,
  pew: 1.1,
  marist: 1.08,
  quinnipiac: 1.08,
  quinnipiacuniversity: 1.08,
  emerson: 1.05,
  emersoncollege: 1.05,
  emersoncollegepolling: 1.05,
  atlasintel: 1.03,
  focaldata: 1.03,
  echeloninsights: 1.02,
  tippinsights: 1,
  tipp: 1,
  harvardcaps: 0.95,
  harvardcapsharris: 0.95,
  harvardcapsharrispoll: 0.95,
  mclaughlinassociates: 0.92,
  rasmussenreports: 0.88,
  rasmussen: 0.88,
  bigdatapoll: 0.95,
  morningconsult: 0.97,
  traflabs: 0.9,
}));

export function ageDays(asOf, endDate) {
  return (Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${endDate}T12:00:00Z`)) / 86400000;
}

export function eachDay(from, to) {
  const days = [];
  let ms = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  while (ms <= end) {
    days.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86400000;
  }
  return days;
}

export function pollsterQuality(canonicalKey) {
  return POLLSTER_QUALITY.get(String(canonicalKey || '')) || 1;
}

function inWindow(polls, asOf, days, keyFn) {
  const rows = polls.filter(p => {
    const age = ageDays(asOf, p.endDate);
    return age >= 0 && age <= days;
  });
  const pollsters = new Set(rows.map(p => keyFn(p)));
  return {rows, pollsters: pollsters.size};
}

/**
 * Shorter memory when recent polling is thick; longer only when it is thin.
 * Shared by Trump approval and 2028 primaries.
 */
export function chooseHalfLife(polls, asOf, keyFn) {
  const d14 = inWindow(polls, asOf, 14, keyFn);
  const d30 = inWindow(polls, asOf, 30, keyFn);
  const d45 = inWindow(polls, asOf, 45, keyFn);
  const d60 = inWindow(polls, asOf, 60, keyFn);

  if (d14.rows.length >= 5 && d14.pollsters >= 4) return 10;
  if (d30.rows.length >= 8 && d30.pollsters >= 5) return DENSE_HALF_LIFE;
  if (d30.rows.length >= 5 && d30.pollsters >= 3) return 18;
  if (d45.rows.length >= 8 && d45.pollsters >= 5) return 21;
  if (d60.rows.length >= 8 && d60.pollsters >= 5) return 28;
  if (d45.rows.length >= 3 && d45.pollsters >= 2) return 32;
  return SPARSE_HALF_LIFE;
}

export function chooseMaxAgeDays(polls, asOf, keyFn) {
  const life = chooseHalfLife(polls, asOf, keyFn);
  if (life <= 18) return DENSE_MAX_AGE_DAYS;
  if (life <= 28) return 150;
  return DEFAULT_MAX_AGE_DAYS;
}

export function sampleSizeWeight(sampleSize) {
  return clamp(0.55, 2.1, Math.sqrt(sampleSize || 800) / 30);
}
