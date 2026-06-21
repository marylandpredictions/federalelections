import { readFileSync } from "node:fs";

const SENATE_FORECAST_URL = new URL("../../data/forecast.json", import.meta.url);

function numberAfter(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? Number(match[1]) : null;
}

function cleanSource(source) {
  if (!source || !Number.isFinite(source.margin)) return null;
  return {
    source: source.source || "Unknown",
    margin: Number(source.margin.toFixed(2)),
    dem: Number.isFinite(source.dem) ? Number(source.dem.toFixed(2)) : null,
    rep: Number.isFinite(source.rep) ? Number(source.rep.toFixed(2)) : null,
    polls: Number.isFinite(source.polls) ? source.polls : null,
    weight: Number.isFinite(source.weight) ? source.weight : 1,
    status: source.status || "OK_PARSED"
  };
}

export function parseVoteHubGeneric(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    const polls = Array.isArray(data) ? data : Array.isArray(data.polls) ? data.polls : [];
    const rows = polls.map((poll) => {
      const answers = Array.isArray(poll.answers) ? poll.answers : [];
      const dem = Number(poll.democrat ?? poll.dem ?? answers.find((answer) => /^dem/i.test(answer.choice || ""))?.pct);
      const rep = Number(poll.republican ?? poll.rep ?? answers.find((answer) => /^rep/i.test(answer.choice || ""))?.pct);
      return { dem, rep };
    }).filter((row) => Number.isFinite(row.dem) && Number.isFinite(row.rep));
    if (rows.length) {
      const dem = rows.reduce((sum, row) => sum + row.dem, 0) / rows.length;
      const rep = rows.reduce((sum, row) => sum + row.rep, 0) / rows.length;
      return cleanSource({ source: "VoteHub", margin: dem - rep, dem, rep, polls: rows.length, weight: 1 });
    }
  } catch {
    // A public HTML response is valid input for the text fallback below.
  }
  const dem = numberAfter(text, /Democrats?[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  const rep = numberAfter(text, /Republicans?[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  const explicit = numberAfter(text, /Democrats?\s*\+([0-9]+(?:\.[0-9]+)?)/i);
  if (Number.isFinite(dem) && Number.isFinite(rep)) return cleanSource({ source: "VoteHub", margin: dem - rep, dem, rep, weight: 1 });
  if (Number.isFinite(explicit)) return cleanSource({ source: "VoteHub", margin: explicit, weight: .8 });
  return null;
}

export function parsePollfinityGeneric(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    const candidates = Array.isArray(data) ? data : data.averages || data.polls || [];
    const row = candidates.find((item) => /generic/i.test(String(item.race || item.name || item.slug || ""))) || data.genericBallot || data.generic_ballot;
    const dem = Number(row?.democrat ?? row?.dem ?? row?.d);
    const rep = Number(row?.republican ?? row?.rep ?? row?.r);
    if (Number.isFinite(dem) && Number.isFinite(rep)) return cleanSource({ source: "Pollfinity", margin: dem - rep, dem, rep, polls: Number(row?.polls), weight: .55 });
  } catch {
    return null;
  }
  return null;
}

export function parseUsPollingDataGeneric(text) {
  const input = String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
  const explicit = numberAfter(input, /Democrats?\s*\+\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (Number.isFinite(explicit)) return cleanSource({ source: "USPollingData", margin: explicit, weight: .45 });
  const dem = numberAfter(input, /Democrat(?:s|ic)?[^0-9]{0,120}([0-9]+(?:\.[0-9]+)?)/i);
  const rep = numberAfter(input, /Republican(?:s)?[^0-9]{0,120}([0-9]+(?:\.[0-9]+)?)/i);
  if (Number.isFinite(dem) && Number.isFinite(rep)) return cleanSource({ source: "USPollingData", margin: dem - rep, dem, rep, weight: .45 });
  return null;
}

export function blendGenericBallotSources(sources, options = {}) {
  const usable = (sources || []).map(cleanSource).filter(Boolean);
  const weight = usable.reduce((sum, source) => sum + source.weight, 0);
  const weighted = (field) => weight ? usable.reduce((sum, source) => sum + (Number.isFinite(source[field]) ? source[field] : 0) * source.weight, 0) / weight : null;
  return {
    margin: Number.isFinite(weighted("margin")) ? Number(weighted("margin").toFixed(2)) : null,
    dem: Number.isFinite(weighted("dem")) ? Number(weighted("dem").toFixed(2)) : null,
    rep: Number.isFinite(weighted("rep")) ? Number(weighted("rep").toFixed(2)) : null,
    sources: usable,
    sourceHealth: options.sourceHealth || {},
    lastUpdated: options.lastUpdated || new Date().toISOString()
  };
}

export function readCachedGenericBallot() {
  try {
    const senate = JSON.parse(readFileSync(SENATE_FORECAST_URL, "utf8"));
    const generic = senate.canonicalGenericBallot || senate.sourceSummary?.genericPolling;
    const margin = Number(generic?.margin ?? generic?.genericBallotMargin);
    if (!Number.isFinite(margin)) return null;
    return blendGenericBallotSources((generic.sources || []).map((source) => ({ ...source, status: source.status || "CACHED" })), {
      lastUpdated: senate.generatedAt || null,
      sourceHealth: { cached: true }
    });
  } catch {
    return null;
  }
}

// Generators use their own fetch wrappers so their source-health telemetry stays
// attached to the source that made the HTTP request. This is the shared fetchless
// contract for parsing, blending, caching, and cross-office consistency.
export async function fetchCanonicalGenericBallot(fetchers = {}) {
  const [voteHub, pollfinity, usPollingData] = await Promise.all([
    fetchers.voteHub?.(), fetchers.pollfinity?.(), fetchers.usPollingData?.()
  ]);
  return blendGenericBallotSources([
    parseVoteHubGeneric(voteHub),
    parsePollfinityGeneric(pollfinity),
    parseUsPollingDataGeneric(usPollingData)
  ], { sourceHealth: fetchers.sourceHealth || {} });
}
