// Multi-source Trump approval poll ingest + cross-source dedupe.
const normalize = s => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// Collapse common house-name variants so the same survey is not double-counted
// when VoteHub and Pollfinity label it differently.
const POLLSTER_ALIASES = new Map(Object.entries({
  yougovtheeconomist: 'yougov',
  economistyougov: 'yougov',
  yougoveconomist: 'yougov',
  theeconomistyougov: 'yougov',
  yougov: 'yougov',
  harvardcapsharrispoll: 'harvardcaps',
  harvardcapsharris: 'harvardcaps',
  harvardcaps: 'harvardcaps',
  harrispoll: 'harvardcaps',
  emersoncollegepolling: 'emerson',
  emersoncollege: 'emerson',
  emerson: 'emerson',
  rmgresearch: 'rmgresearch',
  tippinsights: 'tipp',
  tipp: 'tipp',
  pewresearchcenter: 'pew',
  pewresearch: 'pew',
  pew: 'pew',
  morningconsult: 'morningconsult',
  quinnipiacuniversity: 'quinnipiac',
  quinnipiac: 'quinnipiac',
}));

export function canonicalPollster(name) {
  const key = normalize(name);
  return POLLSTER_ALIASES.get(key) || key;
}

export function answerPct(answers, want) {
  const hits = (answers || []).filter(a => normalize(a.choice) === want);
  if (hits.length !== 1 || typeof hits[0].pct !== 'number' || !Number.isFinite(hits[0].pct))
    return null;
  if (hits[0].pct < 0 || hits[0].pct > 100) return null;
  return hits[0].pct;
}

function sampleSize(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function populationCode(value, fallback = 'a') {
  const code = String(value || fallback).toLowerCase();
  return ['lv', 'rv', 'a', 'v'].includes(code) ? code : fallback;
}

export function duplicateKey(poll) {
  return [
    canonicalPollster(poll.pollster),
    poll.endDate,
    Math.round(Number(poll.approve)),
    Math.round(Number(poll.disapprove)),
  ].join('|');
}

function scorePoll(poll) {
  return (poll.sampleSize ? 2 : 0) +
    (poll.url ? 2 : 0) +
    (poll.population && poll.population !== 'a' ? 1 : 0) +
    (poll.sourceIds?.length || 1) +
    (poll.id?.startsWith('votehub:') ? 1 : 0);
}

export function dedupeApprovalPolls(polls) {
  const byKey = new Map();
  let collapsed = 0;
  for (const poll of polls) {
    if (!poll) continue;
    const key = duplicateKey(poll);
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, {
        ...poll,
        sources: [...(poll.sources || [])],
        sourceIds: [...(poll.sourceIds || [poll.id])],
      });
      continue;
    }
    collapsed++;
    const winner = scorePoll(poll) > scorePoll(old) ? poll : old;
    const loser = winner === poll ? old : poll;
    byKey.set(key, {
      ...winner,
      sources: [...new Set([...(old.sources || []), ...(poll.sources || [])])],
      sourceIds: [...new Set([
        ...(old.sourceIds || [old.id]),
        ...(poll.sourceIds || [poll.id]),
      ])],
      sampleSize: winner.sampleSize || loser.sampleSize || null,
      url: winner.url || loser.url || null,
      startDate: winner.startDate || loser.startDate,
      population: winner.population === 'a' && loser.population !== 'a'
        ? loser.population
        : winner.population,
    });
  }
  return {
    polls: [...byKey.values()].sort((a, b) =>
      a.endDate.localeCompare(b.endDate) ||
      canonicalPollster(a.pollster).localeCompare(canonicalPollster(b.pollster))),
    collapsed,
  };
}

export function fromVoteHub(raw) {
  if (!raw || raw.poll_type !== 'approval' || raw.internal) return null;
  const approve = answerPct(raw.answers, 'approve');
  const disapprove = answerPct(raw.answers, 'disapprove');
  if (approve == null || disapprove == null) return null;
  const endDate = String(raw.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const population = populationCode(raw.population, null);
  if (!population) return null;
  return {
    id: `votehub:${raw.id || `${normalize(raw.pollster)}-${endDate}`}`,
    pollster: String(raw.pollster || 'Unknown'),
    endDate,
    startDate: String(raw.start_date || endDate).slice(0, 10),
    population,
    sampleSize: sampleSize(raw.sample_size),
    partisan: Boolean(raw.partisan),
    approve,
    disapprove,
    net: approve - disapprove,
    url: raw.url || null,
    sources: ['votehub'],
    sourceIds: [`votehub:${raw.id || `${normalize(raw.pollster)}-${endDate}`}`],
  };
}

export function fromPollfinity(raw) {
  if (!raw) return null;
  const approve = Number(raw.approve);
  const disapprove = Number(raw.disapprove);
  if (!Number.isFinite(approve) || !Number.isFinite(disapprove)) return null;
  if (approve < 0 || approve > 100 || disapprove < 0 || disapprove > 100) return null;
  const endDate = String(raw.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const pollster = String(raw.pollster || 'Unknown');
  return {
    id: `pollfinity:${normalize(pollster)}-${endDate}-${Math.round(approve)}-${Math.round(disapprove)}`,
    pollster,
    endDate,
    startDate: endDate,
    population: populationCode(raw.population, 'a'),
    sampleSize: sampleSize(raw.sample_size),
    partisan: Boolean(raw.partisan),
    approve,
    disapprove,
    net: approve - disapprove,
    url: raw.url || null,
    sources: ['pollfinity'],
    sourceIds: [`pollfinity:${normalize(pollster)}-${endDate}`],
  };
}

async function fetchJson(url, {timeoutMs = 30000, maxBytes = 8_000_000} = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {accept: 'application/json', 'user-agent': 'FederalElectionsAnalysis/1.0'},
  });
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  const body = await response.text();
  if (body.length > maxBytes) throw Error(`Oversized response from ${url}`);
  return JSON.parse(body);
}

export async function fetchVoteHubApprovalPolls() {
  const data = await fetchJson('https://api.votehub.com/polls?poll_type=approval&subject=trump');
  const rows = Array.isArray(data) ? data : Array.isArray(data.polls) ? data.polls : null;
  if (!rows) throw Error('Unexpected VoteHub schema');
  return {
    source: 'votehub',
    sourceUrl: 'https://votehub.com/polls/api/',
    license: 'CC BY 4.0',
    fetched: rows.length,
    polls: rows.map(fromVoteHub).filter(Boolean),
  };
}

export async function fetchPollfinityApprovalPolls() {
  const data = await fetchJson('https://pollfinity.com/averages.json', {timeoutMs: 20000, maxBytes: 2_000_000});
  const used = data?.tracks?.trump_approval?.polls_used;
  if (!Array.isArray(used)) throw Error('Unexpected Pollfinity schema');
  return {
    source: 'pollfinity',
    sourceUrl: 'https://pollfinity.com/averages.json',
    license: null,
    fetched: used.length,
    polls: used.map(fromPollfinity).filter(Boolean),
    current: data.tracks.trump_approval.current || null,
    lastUpdated: data.tracks.trump_approval.last_updated || null,
  };
}

export async function collectApprovalPolls() {
  const reports = [];
  const errors = [];
  const all = [];

  for (const job of [
    ['votehub', fetchVoteHubApprovalPolls],
    ['pollfinity', fetchPollfinityApprovalPolls],
  ]) {
    try {
      const report = await job[1]();
      reports.push({
        source: report.source,
        sourceUrl: report.sourceUrl,
        license: report.license,
        fetched: report.fetched,
        usable: report.polls.length,
        lastUpdated: report.lastUpdated || null,
      });
      all.push(...report.polls);
    } catch (error) {
      errors.push({source: job[0], error: error.message});
    }
  }

  if (!all.length) throw Error(`No approval polls collected (${errors.map(e => e.error).join('; ')})`);
  const {polls, collapsed} = dedupeApprovalPolls(all);
  return {
    polls,
    collapsed,
    reports,
    errors,
    sources: reports.map(r => r.source),
  };
}
