// 2028 presidential primary poll ingest (VoteHub + Pollfinity when available).
const normalize = s => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const POLLSTER_ALIASES = new Map(Object.entries({
  yougovtheeconomist: 'yougov',
  economistyougov: 'yougov',
  yougoveconomist: 'yougov',
  theeconomistyougov: 'yougov',
  harvardcapsharrispoll: 'harvardcaps',
  harvardcapsharris: 'harvardcaps',
  emersoncollegepolling: 'emerson',
  emersoncollege: 'emerson',
  tippinsights: 'tipp',
  tipp: 'tipp',
  quinnipiacuniversity: 'quinnipiac',
  mclaughlinassociates: 'mclaughlinassociates',
  mclaughlin: 'mclaughlinassociates',
  bigdatapoll: 'bigdatapoll',
  noblepredictiveinsights: 'noblepredictiveinsights',
  noblepredictiveinsightsthecentersquare: 'noblepredictiveinsights',
  harvardharris: 'harvardcaps',
  jllpartners: 'jllpartners',
  dailymailjllpartners: 'jllpartners',
}));

const CANDIDATE_ALIASES = new Map(Object.entries({
  // AOC: normalized form of "Alexandria Ocasio-Cortez" is alexandriaocasiocortez
  aoc: 'alexandriaocasiocortez',
  alexandriaocasiocortez: 'alexandriaocasiocortez',
  // Legacy misspelling (was 'alexandriaocasioortez' — missing 'c' in Cortez) kept as redirect
  alexandriaocasioortez: 'alexandriaocasiocortez',
  kamalaharris: 'kamalaharris',
  harris: 'kamalaharris',
  gavinnewsom: 'gavinnewsom',
  newsom: 'gavinnewsom',
  petebuttigieg: 'petebuttigieg',
  buttigieg: 'petebuttigieg',
  joshshapiro: 'joshshapiro',
  shapiro: 'joshshapiro',
  gretchenwhitmer: 'gretchenwhitmer',
  whitmer: 'gretchenwhitmer',
  andybeshear: 'andybeshear',
  beshear: 'andybeshear',
  jdvance: 'jdvance',
  vance: 'jdvance',
  rondesantis: 'rondesantis',
  desantis: 'rondesantis',
  marcorubio: 'marcorubio',
  rubio: 'marcorubio',
  nikkihaley: 'nikkihaley',
  haley: 'nikkihaley',
  tedcruz: 'tedcruz',
  cruz: 'tedcruz',
  glennyoungkin: 'glennyoungkin',
  youngkin: 'glennyoungkin',
  tulsigabbard: 'tulsigabbard',
  gabbard: 'tulsigabbard',
  robertfkennedyjr: 'rfkjr',
  rfkjr: 'rfkjr',
  rfk: 'rfkjr',
  // Ossoff: normalize "Jon Ossoff" → jonossoff; add short-form alias
  jonossoff: 'jonossoff',
  ossoff: 'jonossoff',
}));

export function canonicalPollster(name) {
  const key = normalize(name);
  return POLLSTER_ALIASES.get(key) || key;
}

export function canonicalCandidate(name) {
  const key = normalize(name);
  if (!key || key === 'other' || key === 'someoneelse' || key === 'undecided' || key === 'dk') return null;
  return CANDIDATE_ALIASES.get(key) || key;
}

export function displayCandidate(name) {
  const key = canonicalCandidate(name);
  if (!key) return null;
  const pretty = {
    alexandriaocasiocortez: 'Alexandria Ocasio-Cortez',
    kamalaharris: 'Kamala Harris',
    gavinnewsom: 'Gavin Newsom',
    petebuttigieg: 'Pete Buttigieg',
    joshshapiro: 'Josh Shapiro',
    gretchenwhitmer: 'Gretchen Whitmer',
    andybeshear: 'Andy Beshear',
    jdvance: 'JD Vance',
    rondesantis: 'Ron DeSantis',
    marcorubio: 'Marco Rubio',
    nikkihaley: 'Nikki Haley',
    tedcruz: 'Ted Cruz',
    glennyoungkin: 'Glenn Youngkin',
    tulsigabbard: 'Tulsi Gabbard',
    rfkjr: 'RFK Jr.',
    jonossoff: 'Jon Ossoff',
    donaldtrumpjr: 'Donald Trump Jr.',
    vivekramaswamy: 'Vivek Ramaswamy',
    corybooker: 'Cory Booker',
    markkelly: 'Mark Kelly',
    jbpritzker: 'JB Pritzker',
  };
  if (pretty[key]) return pretty[key];
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function sampleSize(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function populationCode(value, fallback = 'a') {
  const code = String(value || fallback).toLowerCase();
  return ['lv', 'rv', 'a', 'v'].includes(code) ? code : fallback;
}

function partyFromSubject(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.includes('democrat')) return 'D';
  if (s.includes('republican') || s.includes('gop')) return 'R';
  return null;
}

export function fromVoteHubPrimary(raw) {
  if (!raw || raw.internal) return null;
  if (raw.poll_type !== 'presidential-primary') return null;
  const party = partyFromSubject(raw.subject);
  if (!party) return null;
  const endDate = String(raw.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const answers = [];
  for (const row of raw.answers || []) {
    const id = canonicalCandidate(row.choice);
    const pct = Number(row.pct);
    if (!id || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    answers.push({
      id,
      name: displayCandidate(row.choice) || row.choice,
      pct,
    });
  }
  if (answers.length < 2) return null;
  const population = populationCode(raw.population, null);
  if (!population) return null;
  return {
    id: `votehub:${raw.id}`,
    pollster: String(raw.pollster || 'Unknown'),
    endDate,
    startDate: String(raw.start_date || endDate).slice(0, 10),
    population,
    sampleSize: sampleSize(raw.sample_size),
    partisan: Boolean(raw.partisan),
    party,
    subject: raw.subject || null,
    url: raw.url || null,
    answers,
    sources: ['votehub'],
    sourceIds: [`votehub:${raw.id}`],
  };
}

export function fromPollfinityPrimary(raw, partyHint = null) {
  if (!raw) return null;
  const party = partyHint || partyFromSubject(raw.subject || raw.party || raw.track);
  if (!party) return null;
  const endDate = String(raw.end_date || raw.endDate || raw.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const answersRaw = raw.answers || raw.candidates || raw.results || [];
  const answers = [];
  for (const row of answersRaw) {
    const choice = row.choice || row.name || row.candidate;
    const id = canonicalCandidate(choice);
    const pct = Number(row.pct ?? row.percent ?? row.share);
    if (!id || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    answers.push({id, name: displayCandidate(choice) || choice, pct});
  }
  if (answers.length < 2) return null;
  return {
    id: `pollfinity:${raw.id || `${canonicalPollster(raw.pollster)}-${endDate}-${party}`}`,
    pollster: String(raw.pollster || 'Unknown'),
    endDate,
    startDate: String(raw.start_date || raw.startDate || endDate).slice(0, 10),
    population: populationCode(raw.population, 'lv'),
    sampleSize: sampleSize(raw.sample_size || raw.sampleSize),
    partisan: Boolean(raw.partisan),
    party,
    subject: raw.subject || null,
    url: raw.url || null,
    answers,
    sources: ['pollfinity'],
    sourceIds: [`pollfinity:${raw.id || endDate}`],
  };
}

export function dedupePrimaryPolls(polls) {
  const byKey = new Map();
  let collapsed = 0;
  for (const poll of polls) {
    if (!poll) continue;
    const top = [...poll.answers].sort((a, b) => b.pct - a.pct).slice(0, 3)
      .map(a => `${a.id}:${Math.round(a.pct)}`).join(',');
    const key = [canonicalPollster(poll.pollster), poll.endDate, poll.party, top].join('|');
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, {...poll, sources: [...(poll.sources || [])], sourceIds: [...(poll.sourceIds || [poll.id])]});
      continue;
    }
    collapsed += 1;
    const winner = (poll.sampleSize || 0) >= (old.sampleSize || 0) ? poll : old;
    const loser = winner === poll ? old : poll;
    byKey.set(key, {
      ...winner,
      sources: [...new Set([...(old.sources || []), ...(poll.sources || [])])],
      sourceIds: [...new Set([...(old.sourceIds || [old.id]), ...(poll.sourceIds || [poll.id])])],
      sampleSize: winner.sampleSize || loser.sampleSize || null,
      url: winner.url || loser.url || null,
    });
  }
  return {
    polls: [...byKey.values()].sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id)),
    collapsed,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {headers: {Accept: 'application/json'}});
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export async function fetchVoteHubPrimaryPolls() {
  const rows = await fetchJson('https://api.votehub.com/polls?poll_type=presidential-primary&limit=500');
  if (!Array.isArray(rows)) throw new Error('VoteHub primary payload was not an array');
  return rows;
}

export async function fetchPollfinityPrimaryPolls() {
  const data = await fetchJson('https://pollfinity.com/averages.json');
  const tracks = data?.tracks || {};
  const out = [];
  for (const [key, track] of Object.entries(tracks)) {
    const party = partyFromSubject(key) || partyFromSubject(track.label) || partyFromSubject(track.subtitle);
    if (!party && !/primary|2028/.test(`${key} ${track.label || ''}`)) continue;
    for (const poll of track.polls_used || track.polls || []) {
      const row = fromPollfinityPrimary(poll, party);
      if (row) out.push(row);
    }
  }
  return out;
}

export async function collectPrimaryPolls() {
  const reports = [];
  const errors = [];
  const polls = [];

  try {
    const raw = await fetchVoteHubPrimaryPolls();
    let usable = 0;
    for (const row of raw) {
      const poll = fromVoteHubPrimary(row);
      if (!poll) continue;
      usable += 1;
      polls.push(poll);
    }
    reports.push({
      source: 'votehub',
      sourceUrl: 'https://votehub.com/polls/api/',
      license: 'CC BY 4.0',
      fetched: raw.length,
      usable,
    });
  } catch (error) {
    errors.push({source: 'votehub', error: String(error.message || error)});
  }

  try {
    const raw = await fetchPollfinityPrimaryPolls();
    reports.push({
      source: 'pollfinity',
      sourceUrl: 'https://pollfinity.com/averages.json',
      fetched: raw.length,
      usable: raw.length,
    });
    polls.push(...raw);
  } catch (error) {
    errors.push({source: 'pollfinity', error: String(error.message || error)});
  }

  // Wikipedia fills the gap when VoteHub's public primary dump lags.
  try {
    const {fetchWikipediaPrimaryPolls} = await import('./wikipedia-primary.mjs');
    const wiki = await fetchWikipediaPrimaryPolls();
    reports.push({
      source: 'wikipedia',
      sourceUrl: 'https://en.wikipedia.org/wiki/Nationwide_opinion_polling_for_the_2028_Democratic_Party_presidential_primaries',
      license: 'CC BY-SA',
      fetched: wiki.polls.length,
      usable: wiki.polls.length,
      parties: wiki.reports,
    });
    polls.push(...wiki.polls);
  } catch (error) {
    errors.push({source: 'wikipedia', error: String(error.message || error)});
  }

  const deduped = dedupePrimaryPolls(polls);
  if (!deduped.polls.length) throw new Error('No usable 2028 primary polls');
  return {
    polls: deduped.polls,
    collapsed: deduped.collapsed,
    reports,
    errors,
    sources: [...new Set(deduped.polls.flatMap(p => p.sources || []))],
  };
}
