import { readFileSync, writeFileSync } from "node:fs";
import { forecastSanityWarnings } from "./forecast-sanity.mjs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const GOVERNOR_HISTORY_URL = new URL("../data/governor-history.json", import.meta.url);
const GOVERNOR_FINANCE_URL = new URL("../data/governor-finance.json", import.meta.url);
const GOVERNOR_FINANCE_SOURCES_URL = new URL("../data/governor-finance-sources.json", import.meta.url);
const previousForecast = readPreviousForecast();
const governorHistoryArchive = readGovernorHistoryArchive();
const MODEL_TIME_ZONE = "America/New_York";

async function fetchText(url, label, status, options = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

  try {
    const response = await fetch(url, {
      headers: options.headers || {},
      signal: controller.signal
    });
    const text = await response.text();
    status[label] = {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      url
    };
    if (!response.ok) {
      status[label].error = text.slice(0, 180);
    }
    return response.ok ? text : null;
  } catch (error) {
    status[label] = {
      ok: false,
      status: "fetch-error",
      ms: Date.now() - startedAt,
      url,
      error: error.message
    };
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function nonNegative(value) {
  return Math.max(0, toNumber(value));
}

function normalizeGovernorFinanceRecord(value, fallbackSource = "Manual governor-finance file") {
  return {
    demReceipts: nonNegative(value.demReceipts),
    repReceipts: nonNegative(value.repReceipts),
    demCash: nonNegative(value.demCash),
    repCash: nonNegative(value.repCash),
    demDebts: nonNegative(value.demDebts),
    repDebts: nonNegative(value.repDebts),
    demDisbursements: nonNegative(value.demDisbursements),
    repDisbursements: nonNegative(value.repDisbursements),
    demIndividual: nonNegative(value.demIndividual),
    repIndividual: nonNegative(value.repIndividual),
    otherReceipts: nonNegative(value.otherReceipts),
    otherCash: nonNegative(value.otherCash),
    otherDebts: nonNegative(value.otherDebts),
    otherDisbursements: nonNegative(value.otherDisbursements),
    otherIndividual: nonNegative(value.otherIndividual),
    source: value.source || fallbackSource,
    sourceUrl: value.sourceUrl || null,
    updatedAt: value.updatedAt || null
  };
}

function hasGovernorFinanceTotals(record) {
  return [
    "demReceipts", "repReceipts", "demCash", "repCash", "demDebts", "repDebts",
    "demDisbursements", "repDisbursements", "demIndividual", "repIndividual",
    "otherReceipts", "otherCash", "otherDebts", "otherDisbursements", "otherIndividual"
  ].some((key) => Number(record[key] || 0) > 0);
}

function rowNumber(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return toNumber(row[name]);
  }
  return 0;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function summarizeGovernorFinance(byState, statusKey, status) {
  const national = {
    demReceipts: 0, repReceipts: 0,
    demCash: 0, repCash: 0,
    demDebts: 0, repDebts: 0,
    demDisbursements: 0, repDisbursements: 0,
    demIndividual: 0, repIndividual: 0,
    otherReceipts: 0, otherCash: 0, otherDebts: 0, otherDisbursements: 0, otherIndividual: 0
  };
  for (const [state, record] of Object.entries(byState)) {
    if (!STATE_NAMES[state]) continue;
    for (const key of Object.keys(national)) national[key] += record[key] || 0;
  }
  national.financeSignal = nationalFinanceSignal(national);
  byState.__national = national;
  if (status) {
    status[statusKey] = {
      ok: true,
      states: Object.keys(byState).filter((state) => state !== "__national").length,
      nationalFinanceSignal: national.financeSignal
    };
  }
  return byState;
}

function stateSlug(state) {
  return STATE_NAMES[state]?.toLowerCase().replace(/\s+/g, "-") || state.toLowerCase();
}

function candidateLastName(name) {
  const cleaned = String(name || "").replace(/\*/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return (parts.at(-1) || cleaned).toLowerCase();
}

function candidateLastNames(name) {
  return String(name || "")
    .split(/\s+\/\s+|\s+or\s+|,/i)
    .map(candidateLastName)
    .filter(Boolean);
}

const MANUAL_GOVERNOR_POLLS = {
  IA: {
    source: "NYT Iowa governor polling table / FEA manual aggregation",
    sourceUrl: "https://www.nytimes.com/interactive/polls/iowa-governor-election-polls-2026.html",
    matchup: "Rob Sand vs Zach Lahn, with reduced-weight Sand vs Randy Feenstra context",
    weightScale: 0.72,
    entries: [
      {
        pollster: "Global Strategy Group",
        sponsor: "Rob Sand",
        sponsorType: "Democratic sponsor",
        startDate: "2026-04-23",
        endDate: "2026-04-28",
        sampleType: "Likely voters",
        sampleSize: null,
        demCandidate: "Rob Sand",
        repCandidate: "Zach Lahn",
        demPct: 50,
        repPct: 41,
        margin: 9,
        weight: 0.62,
        directMatchup: true,
        notes: "Current-candidate matchup; partisan-client poll; sample size was not listed in the provided NYT screenshot."
      },
      {
        pollster: "Echelon Insights",
        sponsor: "NetChoice",
        startDate: "2026-04-03",
        endDate: "2026-04-09",
        sampleType: "Likely voters",
        sampleSize: 377,
        demCandidate: "Rob Sand",
        repCandidate: "Randy Feenstra",
        demPct: 51,
        repPct: 39,
        undecidedPct: 10,
        margin: 12,
        weight: 0.18,
        directMatchup: false,
        notes: "Reduced-weight context because Feenstra is not the current modeled Republican candidate and NYT marked the pollster outside select-pollster criteria."
      },
      {
        pollster: "GBAO",
        sponsor: "ModSquad",
        sponsorType: "Democratic sponsor",
        startDate: "2026-03-10",
        endDate: "2026-03-16",
        sampleType: "Likely voters",
        sampleSize: 1200,
        demCandidate: "Rob Sand",
        repCandidate: "Randy Feenstra",
        demPct: 50,
        repPct: 42,
        margin: 8,
        weight: 0.2,
        directMatchup: false,
        notes: "Reduced-weight context because Feenstra is not the current modeled Republican candidate; partisan-client poll."
      }
    ]
  }
};

function readManualGovernorPolls(status) {
  const governorPolls = {};
  for (const [state, record] of Object.entries(MANUAL_GOVERNOR_POLLS)) {
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight || 0)), 0);
    if (!totalWeight) continue;
    const margin = entries.reduce((sum, entry) => sum + Number(entry.margin || 0) * Math.max(0, Number(entry.weight || 0)), 0) / totalWeight;
    governorPolls[state] = {
      margin: Number(margin.toFixed(2)),
      polls: entries.length,
      source: record.source,
      sourceUrl: record.sourceUrl,
      matchup: record.matchup,
      reducedWeight: false,
      weightScale: Number(record.weightScale || 1),
      pollEntries: entries
    };
  }
  status.manualGovernorPolls = {
    ok: true,
    states: Object.keys(governorPolls).length,
    note: "Manual polling is used only where automated sources lack a current modeled matchup."
  };
  return { governorPolls };
}

function specificCandidateName(name) {
  const value = String(name || "").trim();
  if (!value || /field|democrat|republican|nominee/i.test(value)) return "";
  return value;
}

function modeledPollMatch(title, race) {
  const normalizedTitle = String(title || "").toLowerCase();
  const demSpecific = specificCandidateName(race.demCandidate || race.dem || "");
  const repSpecific = specificCandidateName(race.repCandidate || race.rep || "");
  const demNames = candidateLastNames(demSpecific);
  const repNames = candidateLastNames(repSpecific);
  const demMatches = demNames.length ? demNames.some((name) => normalizedTitle.includes(name)) : false;
  const repMatches = repNames.length ? repNames.some((name) => normalizedTitle.includes(name)) : false;
  if (demNames.length && repNames.length) return demMatches && repMatches;
  if (demNames.length) return demMatches;
  if (repNames.length) return repMatches;
  return false;
}

function reducedWeightGovernorPollMatch(title, race) {
  return false;
}

function parsePercent(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function readGovernorFinance(status) {
  try {
    const data = JSON.parse(readFileSync(GOVERNOR_FINANCE_URL, "utf8"));
    const byState = {};
    for (const [state, value] of Object.entries(data.races || {})) {
      if (!STATE_NAMES[state]) continue;
      const record = normalizeGovernorFinanceRecord(value);
      if (hasGovernorFinanceTotals(record)) byState[state] = record;
    }
    return summarizeGovernorFinance(byState, "governorFinance", status);
  } catch (error) {
    status.governorFinance = { ok: false, error: error.message };
    return {};
  }
}

function readGovernorFinanceSources(status) {
  try {
    const data = JSON.parse(readFileSync(GOVERNOR_FINANCE_SOURCES_URL, "utf8"));
    status.governorFinanceSourcesConfig = {
      ok: true,
      states: Object.keys(data.sources || {}).length,
      scope: data.scope || "configured states"
    };
    return data.sources || {};
  } catch (error) {
    status.governorFinanceSourcesConfig = { ok: false, error: error.message };
    return {};
  }
}

function extractFirstNumber(text, patterns = []) {
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "is");
      const match = text.match(regex);
      if (match?.[1] !== undefined) return nonNegative(decodeHtml(match[1]));
    } catch {
      // Bad config patterns should not break the whole forecast run.
    }
  }
  return null;
}

function normalizeOnlineFinancePayload(text, source) {
  if (!source.extractors || !Object.keys(source.extractors).length) return null;
  const record = {};
  for (const key of [
    "demReceipts", "repReceipts", "demCash", "repCash", "demDebts", "repDebts",
    "demDisbursements", "repDisbursements", "demIndividual", "repIndividual",
    "otherReceipts", "otherCash", "otherDebts", "otherDisbursements", "otherIndividual"
  ]) {
    const value = extractFirstNumber(text, source.extractors[key] || []);
    if (value !== null) record[key] = value;
  }
  const extractedKeys = Object.keys(record);
  if (!extractedKeys.length) return null;
  return normalizeGovernorFinanceRecord({
    ...record,
    source: source.sourceName || "Online state campaign-finance source",
    sourceUrl: source.sourceUrl || source.url,
    updatedAt: new Date().toISOString()
  }, source.sourceName || "Online state campaign-finance source");
}

async function fetchGovernorOnlineFinance(status) {
  const sources = readGovernorFinanceSources(status);
  const byState = {};
  const entries = Object.entries(sources).filter(([, source]) => source.enabled !== false);
  const sourceStatus = { configured: entries.length, fetched: 0, parsed: 0, skipped: 0, failed: 0, states: {} };
  for (const [state, source] of entries) {
    if (!STATE_NAMES[state]) continue;
    if (!source.url) {
      sourceStatus.skipped += 1;
      sourceStatus.states[state] = { ok: false, reason: "missing-url" };
      continue;
    }
    const label = `governorFinanceSource${state}`;
    const text = await fetchText(source.url, label, status, {
      headers: {
        accept: source.accept || "text/html,application/json,text/plain,*/*",
        "user-agent": "Federal Elections Analysis forecast bot; contact federalelectionsanalysis@gmail.com"
      },
      timeoutMs: source.timeoutMs || 18000
    });
    if (!text) {
      sourceStatus.failed += 1;
      sourceStatus.states[state] = { ok: false, reason: "fetch-failed", url: source.url };
      continue;
    }
    sourceStatus.fetched += 1;
    const record = normalizeOnlineFinancePayload(text, source);
    if (!record) {
      const hasExtractors = Boolean(source.extractors && Object.keys(source.extractors).length);
      sourceStatus.skipped += 1;
      sourceStatus.states[state] = {
        ok: true,
        parsed: false,
        reason: hasExtractors ? "extractor-no-match" : "portal-reachable-no-machine-extractor",
        url: source.sourceUrl || source.url
      };
      continue;
    }
    byState[state] = record;
    sourceStatus.parsed += 1;
    sourceStatus.states[state] = { ok: true, parsed: true, url: source.sourceUrl || source.url };
  }
  status.governorOnlineFinance = sourceStatus;
  return summarizeGovernorFinance(byState, "governorOnlineFinanceParsed", null);
}

function mergeGovernorFinance(manualFinance, onlineFinance, status) {
  const byState = {};
  for (const [state, record] of Object.entries(manualFinance || {})) {
    if (STATE_NAMES[state]) byState[state] = record;
  }
  for (const [state, record] of Object.entries(onlineFinance || {})) {
    if (STATE_NAMES[state]) byState[state] = record;
  }
  const merged = summarizeGovernorFinance(byState, "governorFinanceMerged", status);
  status.governorFinanceMerged.sources = {
    manualStates: Object.keys(manualFinance || {}).filter((state) => STATE_NAMES[state]).length,
    onlineStates: Object.keys(onlineFinance || {}).filter((state) => STATE_NAMES[state]).length
  };
  return merged;
}

async function fetchDdhqGenericBallot(status) {
  const url = "https://polls.decisiondeskhq.com/averages/generic-ballot/national/lv-rv-adults";
  const text = await fetchText(url, "ddhqGenericBallot", status, { timeoutMs: 15000 });
  if (!text) return { genericBallotMargin: null, polls: 0 };
  if (/Vercel Security Checkpoint/i.test(text)) {
    status.ddhqGenericBallot.ok = false;
    status.ddhqGenericBallot.error = "Vercel security checkpoint";
    return { genericBallotMargin: null, polls: 0 };
  }
  const match = text.match(/"margin":\s*([0-9.-]+)/);
  const margin = match ? Number(match[1]) : null;
  const pollsMatch = text.match(/"polls":\s*([0-9]+)/);
  const polls = pollsMatch ? Number(pollsMatch[1]) : 0;
  return { genericBallotMargin: margin, polls };
}

async function fetchPollfinityAverages(status) {
  const url = "https://pollfinity.com/averages.json";
  const text = await fetchText(url, "pollfinityAverages", status, {
    headers: { accept: "application/json" },
    timeoutMs: 15000
  });
  if (!text) return { genericBallotMargin: null, governorPolls: {} };
  try {
    const data = JSON.parse(text);
    const generic = data.generic_ballot?.national?.margin;
    const governorPolls = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("governor_")) {
        const state = key.replace("governor_", "").toUpperCase();
        if (value.margin !== undefined && STATE_NAMES[state]) {
          governorPolls[state] = { margin: value.margin, polls: value.poll_count || 0 };
        }
      }
    }
    return { genericBallotMargin: generic, governorPolls };
  } catch {
    return { genericBallotMargin: null, governorPolls: {} };
  }
}

function inferHeaderParty(headerHtml, candidateName, race) {
  const style = (headerHtml.match(/style="([^"]*)"/i)?.[1] || "").toLowerCase();
  const name = stripHtml(candidateName).toLowerCase();
  const demSpecific = specificCandidateName(race.demCandidate || race.dem || "");
  const repSpecific = specificCandidateName(race.repCandidate || race.rep || "");
  if (demSpecific && name.includes(candidateLastName(demSpecific))) return "D";
  if (repSpecific && name.includes(candidateLastName(repSpecific))) return "R";
  if (/#3e5a96|#244999|blue/i.test(style)) return "D";
  if (/#c23237|#b22222|red/i.test(style)) return "R";
  return "";
}

function parseTwoSeventyGovernorPage(html, race) {
  const blocks = [...html.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<table id="polls"[\s\S]*?<\/table>/gi)];
  const directParsed = [];
  const fallbackParsed = [];
  for (const block of blocks) {
    const title = stripHtml(block[1]);
    const table = block[0];
    if (!/ vs\.? /i.test(title)) continue;
    const directMatch = modeledPollMatch(title, race);
    const fallbackMatch = !directMatch && reducedWeightGovernorPollMatch(title, race);
    if (!directMatch && !fallbackMatch) continue;
    const headerMatches = [...table.matchAll(/<th[^>]*class="[^"]*\bcan_name\b[^"]*"[^>]*>([\s\S]*?)<\/th>/gi)];
    const candidates = headerMatches.map((match) => ({
      name: stripHtml(match[1]).replace(/\*$/, "").trim(),
      party: inferHeaderParty(match[0], match[1], race)
    }));
    const demIndex = candidates.findIndex((candidate) => candidate.party === "D");
    const repIndex = candidates.findIndex((candidate) => candidate.party === "R");
    if (demIndex < 0 || repIndex < 0) continue;

    const avgRow = table.match(/<tr id=['"]poll_avg_row['"][\s\S]*?<\/tr>/i)?.[0] || "";
    if (avgRow) {
      const cells = [...avgRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
      const values = cells.slice(1, 1 + candidates.length).map(parsePercent);
      if (Number.isFinite(values[demIndex]) && Number.isFinite(values[repIndex])) {
        const row = {
          margin: values[demIndex] - values[repIndex],
          polls: Number((cells[0] || "").match(/Average of\s+(\d+)/i)?.[1] || 1),
          source: fallbackMatch ? "270toWin reduced-weight alternate governor polling average" : "270toWin polling average",
          sourceUrl: `https://www.270towin.com/2026-governor-polls/${stateSlug(race.state)}`,
          matchup: title,
          demCandidate: candidates[demIndex].name,
          repCandidate: candidates[repIndex].name,
          reducedWeight: fallbackMatch,
          weightScale: fallbackMatch ? .35 : 1
        };
        (fallbackMatch ? fallbackParsed : directParsed).push(row);
        continue;
      }
    }

    const pollRows = [...table.matchAll(/<tr[^>]*class="[^"]*\bpoll_row\b[^"]*"[\s\S]*?<\/tr>/gi)];
    const margins = [];
    for (const row of pollRows) {
      const cells = [...row[0].matchAll(/<td[^>]*class="[^"]*\bpoll_data\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => parsePercent(stripHtml(match[1])));
      if (Number.isFinite(cells[demIndex]) && Number.isFinite(cells[repIndex])) margins.push(cells[demIndex] - cells[repIndex]);
    }
    if (margins.length) {
      const row = {
        margin: margins.reduce((sum, value) => sum + value, 0) / margins.length,
        polls: margins.length,
        source: fallbackMatch ? "270toWin reduced-weight alternate governor polls" : "270toWin latest governor polls",
        sourceUrl: `https://www.270towin.com/2026-governor-polls/${stateSlug(race.state)}`,
        matchup: title,
        demCandidate: candidates[demIndex].name,
        repCandidate: candidates[repIndex].name,
        reducedWeight: fallbackMatch,
        weightScale: fallbackMatch ? .35 : 1
      };
      (fallbackMatch ? fallbackParsed : directParsed).push(row);
    }
  }
  return directParsed.sort((a, b) => b.polls - a.polls)[0] || fallbackParsed.sort((a, b) => b.polls - a.polls)[0] || null;
}

function parseTwoSeventyGovernorPrimarySignal(html, race) {
  const blocks = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<table id="polls"[\s\S]*?<\/table>/gi)];
  const parsed = [];
  for (const block of blocks) {
    const title = stripHtml(block[1]);
    const party = /republican primary/i.test(title) ? "R" : /democratic primary/i.test(title) ? "D" : "";
    if (!party) continue;
    const targetName = specificCandidateName(party === "R" ? (race.repCandidate || race.rep) : (race.demCandidate || race.dem));
    const targetLastName = candidateLastName(targetName);
    if (!targetLastName) continue;
    const table = block[0];
    const headerMatches = [...table.matchAll(/<th[^>]*class="[^"]*\bcan_name\b[^"]*"[^>]*>([\s\S]*?)<\/th>/gi)];
    const candidates = headerMatches.map((match) => stripHtml(match[1]).replace(/\*$/, "").trim());
    const targetIndex = candidates.findIndex((candidate) => candidateLastName(candidate) === targetLastName);
    if (targetIndex < 0) continue;

    const rows = [];
    const avgRow = table.match(/<tr id=['"]poll_avg_row['"][\s\S]*?<\/tr>/i)?.[0] || "";
    if (avgRow) rows.push(avgRow);
    rows.push(...[...table.matchAll(/<tr[^>]*class="[^"]*\bpoll_row\b[^"]*"[\s\S]*?<\/tr>/gi)].map((match) => match[0]));

    const targetLeads = [];
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*class="[^"]*\bpoll_data\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => parsePercent(stripHtml(match[1])));
      if (!cells.length) {
        const allCells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => parsePercent(stripHtml(match[1])));
        const values = allCells.slice(1, 1 + candidates.length);
        if (values.length) cells.push(...values);
      }
      const targetValue = cells[targetIndex];
      const topOther = Math.max(...cells.filter((value, index) => index !== targetIndex && Number.isFinite(value)));
      if (Number.isFinite(targetValue) && Number.isFinite(topOther)) targetLeads.push(targetValue - topOther);
    }
    if (!targetLeads.length) continue;
    const lead = targetLeads.reduce((sum, value) => sum + value, 0) / targetLeads.length;
    parsed.push({
      margin: (party === "D" ? 1 : -1) * clamp(lead / 10, -.55, .55),
      lead: Number(lead.toFixed(2)),
      polls: targetLeads.length,
      source: "270toWin primary polling signal",
      sourceUrl: `https://www.270towin.com/2026-governor-polls/${stateSlug(race.state)}`,
      matchup: title,
      candidate: candidates[targetIndex],
      party
    });
  }
  return parsed.sort((a, b) => b.polls - a.polls)[0] || null;
}

async function fetchTwoSeventyGovernorPolls(status) {
  const governorPolls = {};
  const governorPrimarySignals = {};
  const sourceStatus = { checked: 0, parsed: 0, primarySignals: 0, noPolls: 0, failed: 0, states: {} };
  const racesToCheck = GOVERNOR_RACES.filter((race) => Math.abs(race.pvi || 0) < 12 || Math.abs(race.lastMargin || 0) < 12);
  for (const baseRace of racesToCheck) {
    const candidateInfo = GOVERNOR_CANDIDATE_STATUS[baseRace.state] || {};
    const race = {
      ...baseRace,
      ...candidateInfo,
      demCandidate: candidateInfo.dem || baseRace.demCandidate,
      repCandidate: candidateInfo.rep || baseRace.repCandidate
    };
    const url = `https://www.270towin.com/2026-governor-polls/${stateSlug(race.state)}`;
    const label = `twoSeventyGovernorPolls${race.state}`;
    const text = await fetchText(url, label, status, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html,*/*" },
      timeoutMs: 12000
    });
    sourceStatus.checked += 1;
    if (!text) {
      sourceStatus.failed += 1;
      sourceStatus.states[race.state] = { ok: false, url };
      continue;
    }
    const parsed = parseTwoSeventyGovernorPage(text, race);
    if (!parsed) {
      const primarySignal = parseTwoSeventyGovernorPrimarySignal(text, race);
      if (primarySignal) {
        governorPrimarySignals[race.state] = {
          margin: Number(primarySignal.margin.toFixed(2)),
          lead: primarySignal.lead,
          polls: primarySignal.polls,
          source: primarySignal.source,
          sourceUrl: primarySignal.sourceUrl,
          matchup: primarySignal.matchup,
          candidate: primarySignal.candidate,
          party: primarySignal.party
        };
        sourceStatus.primarySignals += 1;
        sourceStatus.states[race.state] = {
          ok: true,
          parsed: true,
          primarySignal: true,
          polls: primarySignal.polls,
          margin: Number(primarySignal.margin.toFixed(2)),
          matchup: primarySignal.matchup,
          url
        };
        continue;
      }
      sourceStatus.noPolls += 1;
      sourceStatus.states[race.state] = { ok: true, parsed: false, url };
      continue;
    }
    governorPolls[race.state] = {
      margin: Number(parsed.margin.toFixed(2)),
      polls: parsed.polls,
      source: parsed.source,
      sourceUrl: parsed.sourceUrl,
      matchup: parsed.matchup,
      demCandidate: parsed.demCandidate,
      repCandidate: parsed.repCandidate,
      reducedWeight: Boolean(parsed.reducedWeight),
      weightScale: Number(parsed.weightScale || 1)
    };
    sourceStatus.parsed += 1;
    sourceStatus.states[race.state] = {
      ok: true,
      parsed: true,
      polls: parsed.polls,
      margin: Number(parsed.margin.toFixed(2)),
      matchup: parsed.matchup,
      url
    };
  }
  status.twoSeventyGovernorPolls = sourceStatus;
  return { governorPolls, governorPrimarySignals };
}

function mergeGovernorPolling(status, ...sources) {
  const governorPolls = {};
  for (const source of sources) {
    for (const [state, value] of Object.entries(source?.governorPolls || {})) {
      if (!STATE_NAMES[state] || !value || !Number.isFinite(Number(value.margin)) || !Number(value.polls)) continue;
      if (!governorPolls[state]) governorPolls[state] = [];
      governorPolls[state].push(value);
    }
  }
  const merged = {};
  for (const [state, rows] of Object.entries(governorPolls)) {
    const weightedRows = rows.map((row) => ({
      row,
      weight: Math.max(1, Number(row.polls || 1)) * clamp(Number(row.weightScale || 1), 0.05, 1)
    }));
    const totalWeight = weightedRows.reduce((sum, item) => sum + item.weight, 0);
    const margin = weightedRows.reduce((sum, item) => sum + Number(item.row.margin) * item.weight, 0) / totalWeight;
    merged[state] = {
      margin: Number(margin.toFixed(2)),
      polls: rows.reduce((sum, row) => sum + Number(row.polls || 0), 0),
      sources: rows.map((row) => row.source || "Governor polling source"),
      sourceUrls: rows.map((row) => row.sourceUrl).filter(Boolean),
      matchups: rows.map((row) => row.matchup).filter(Boolean),
      reducedWeight: rows.every((row) => row.reducedWeight),
      weightScale: totalWeight / rows.reduce((sum, row) => sum + Math.max(1, Number(row.polls || 1)), 0),
      pollEntries: rows.flatMap((row) => Array.isArray(row.pollEntries) ? row.pollEntries : [])
    };
  }
  status.governorPollingMerged = { states: Object.keys(merged).length };
  return { governorPolls: merged };
}

async function fetchAllSources() {
  const status = { checkedAt: new Date().toISOString() };
  const [manualGovernorFinance, onlineGovernorFinance, ddhqGeneric, pollfinity, twoSeventyGovernor] = await Promise.all([
    Promise.resolve(readGovernorFinance(status)),
    fetchGovernorOnlineFinance(status),
    fetchDdhqGenericBallot(status),
    fetchPollfinityAverages(status),
    fetchTwoSeventyGovernorPolls(status)
  ]);
  const manualGovernorPolls = readManualGovernorPolls(status);
  const governorFinance = mergeGovernorFinance(manualGovernorFinance, onlineGovernorFinance, status);
  const governorPolling = mergeGovernorPolling(status, manualGovernorPolls, pollfinity, twoSeventyGovernor);
  return { governorFinance, fec: governorFinance, ddhqGeneric, pollfinity, twoSeventyGovernor, governorPolling, status };
}

const SETTINGS = {
  simulations: 100000,
  electionDate: "2026-11-03",
  currentDemGovernors: 24,
  currentRepGovernors: 26,
  demNotUp: 6,
  repNotUp: 8,
  dataSources: [
    "Manual 2026 gubernatorial race ledger with candidates, incumbency, PVI, and last gubernatorial margin",
      "Cook Political Report, Inside Elections, Sabato's Crystal Ball, WH, VoteHub, and RCP context references",
    "Current Senate model generic ballot signal as a broad midterm environment input",
    "Pollfinity governor polling averages where available",
    "270toWin state-level 2026 governor polling pages where available",
    "NYT polling-table manual aggregation for Iowa governor while automated sources lack the current nominee matchup",
    "State-level gubernatorial campaign finance file plus configured online state portals for competitive races"
  ]
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IA: "Iowa", KS: "Kansas", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NM: "New Mexico", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", VT: "Vermont", WI: "Wisconsin", WY: "Wyoming"
};

const MODEL_WEIGHTS = {
  nationalFinance: .45
};

const INDEPENDENT_CONTROL_FINANCE = {
  NE: { side: "dem", label: "Dan Osborn" }
};

const STATE_COALITION_TRAITS = {
  AL: ["deep_south", "rural", "evangelical"], AK: ["frontier", "independent"], AZ: ["sunbelt", "suburban", "latino"], AR: ["south", "rural"],
  CA: ["urban", "college", "latino"], CO: ["suburban", "college"], CT: ["suburban", "college"], DE: ["suburban"],
  FL: ["sunbelt", "suburban", "latino", "senior"], GA: ["suburban", "black_belt"], HI: ["minority"], ID: ["rural"],
  IL: ["urban", "suburban"], IN: ["working_class"], IA: ["rural", "working_class"], KS: ["suburban", "rural"],
  KY: ["appalachian", "rural", "working_class"], LA: ["deep_south", "black_belt"], ME: ["independent", "rural"], MD: ["suburban", "college"],
  MA: ["college", "urban"], MI: ["working_class", "suburban"], MN: ["college", "suburban"], MS: ["black_belt", "rural"],
  MO: ["rural", "working_class"], MT: ["frontier", "rural", "independent"], NE: ["rural", "suburban", "independent"], NV: ["sunbelt", "working_class", "latino"],
  NH: ["independent", "suburban"], NJ: ["suburban", "college"], NM: ["latino"], NY: ["urban", "college"], NC: ["suburban", "black_belt"],
  ND: ["rural"], OH: ["appalachian", "working_class"], OK: ["evangelical", "rural"], OR: ["college"], PA: ["working_class", "suburban"],
  RI: ["urban"], SC: ["black_belt", "suburban", "evangelical"], SD: ["rural"], TN: ["appalachian", "evangelical"], TX: ["sunbelt", "suburban", "latino"],
  UT: ["suburban", "religious"], VT: ["rural", "college"], VA: ["suburban", "college"], WA: ["college", "urban"], WV: ["appalachian", "rural", "working_class"],
  WI: ["working_class", "rural"], WY: ["rural"]
};

const MIDTERM_LIKELY_VOTER_BASELINES = {
  AL: { white_college: .24, white_noncollege: .43, black: .27, latino: .03, asian_other: .03 },
  AK: { white_college: .31, white_noncollege: .42, black: .03, latino: .04, asian_other: .20 },
  AR: { white_college: .25, white_noncollege: .55, black: .14, latino: .03, asian_other: .03 },
  CO: { white_college: .47, white_noncollege: .31, black: .03, latino: .14, asian_other: .05 },
  DE: { white_college: .39, white_noncollege: .35, black: .18, latino: .05, asian_other: .03 },
  FL: { white_college: .31, white_noncollege: .36, black: .12, latino: .16, asian_other: .05 },
  GA: { white_college: .31, white_noncollege: .31, black: .30, latino: .04, asian_other: .04 },
  ID: { white_college: .32, white_noncollege: .54, black: .01, latino: .09, asian_other: .04 },
  IL: { white_college: .40, white_noncollege: .36, black: .13, latino: .07, asian_other: .04 },
  IA: { white_college: .32, white_noncollege: .58, black: .03, latino: .04, asian_other: .03 },
  KS: { white_college: .34, white_noncollege: .49, black: .06, latino: .07, asian_other: .04 },
  KY: { white_college: .28, white_noncollege: .59, black: .08, latino: .03, asian_other: .02 },
  LA: { white_college: .24, white_noncollege: .41, black: .29, latino: .03, asian_other: .03 },
  ME: { white_college: .42, white_noncollege: .51, black: .01, latino: .02, asian_other: .04 },
  MA: { white_college: .55, white_noncollege: .28, black: .07, latino: .06, asian_other: .04 },
  MI: { white_college: .35, white_noncollege: .49, black: .10, latino: .03, asian_other: .03 },
  MN: { white_college: .42, white_noncollege: .44, black: .06, latino: .04, asian_other: .04 },
  MS: { white_college: .21, white_noncollege: .41, black: .34, latino: .02, asian_other: .02 },
  MT: { white_college: .36, white_noncollege: .54, black: .01, latino: .03, asian_other: .06 },
  NE: { white_college: .33, white_noncollege: .54, black: .04, latino: .06, asian_other: .03 },
  NV: { white_college: .33, white_noncollege: .38, black: .08, latino: .16, asian_other: .05 },
  NH: { white_college: .47, white_noncollege: .47, black: .01, latino: .02, asian_other: .03 },
  NJ: { white_college: .43, white_noncollege: .31, black: .12, latino: .10, asian_other: .04 },
  NM: { white_college: .30, white_noncollege: .30, black: .02, latino: .33, asian_other: .05 },
  NY: { white_college: .43, white_noncollege: .31, black: .12, latino: .10, asian_other: .04 },
  NC: { white_college: .34, white_noncollege: .42, black: .19, latino: .03, asian_other: .02 },
  OH: { white_college: .33, white_noncollege: .53, black: .09, latino: .03, asian_other: .02 },
  OK: { white_college: .25, white_noncollege: .51, black: .07, latino: .06, asian_other: .11 },
  OR: { white_college: .43, white_noncollege: .40, black: .02, latino: .08, asian_other: .07 },
  PA: { white_college: .38, white_noncollege: .42, black: .10, latino: .04, asian_other: .02 },
  RI: { white_college: .43, white_noncollege: .36, black: .06, latino: .11, asian_other: .04 },
  SC: { white_college: .29, white_noncollege: .43, black: .24, latino: .02, asian_other: .02 },
  SD: { white_college: .31, white_noncollege: .56, black: .02, latino: .03, asian_other: .08 },
  TN: { white_college: .29, white_noncollege: .53, black: .13, latino: .03, asian_other: .02 },
  TX: { white_college: .29, white_noncollege: .37, black: .12, latino: .18, asian_other: .04 },
  UT: { white_college: .35, white_noncollege: .48, black: .01, latino: .10, asian_other: .06 },
  VA: { white_college: .43, white_noncollege: .33, black: .16, latino: .05, asian_other: .03 },
  WA: { white_college: .45, white_noncollege: .33, black: .04, latino: .08, asian_other: .10 },
  WV: { white_college: .23, white_noncollege: .72, black: .03, latino: .01, asian_other: .01 },
  WI: { white_college: .38, white_noncollege: .48, black: .06, latino: .03, asian_other: .05 },
  WY: { white_college: .30, white_noncollege: .61, black: .01, latino: .05, asian_other: .03 }
};

const MIDTERM_AGE_BASELINES = {
  AL: { youth: .13, core_age: .57, senior: .30 },
  AK: { youth: .16, core_age: .63, senior: .21 },
  AR: { youth: .13, core_age: .56, senior: .31 },
  CO: { youth: .17, core_age: .60, senior: .23 },
  DE: { youth: .13, core_age: .55, senior: .32 },
  FL: { youth: .12, core_age: .55, senior: .33 },
  GA: { youth: .15, core_age: .59, senior: .26 },
  ID: { youth: .15, core_age: .57, senior: .28 },
  IL: { youth: .15, core_age: .58, senior: .27 },
  IA: { youth: .14, core_age: .55, senior: .31 },
  KS: { youth: .15, core_age: .57, senior: .28 },
  KY: { youth: .13, core_age: .56, senior: .31 },
  LA: { youth: .14, core_age: .58, senior: .28 },
  ME: { youth: .11, core_age: .52, senior: .37 },
  MA: { youth: .15, core_age: .57, senior: .28 },
  MI: { youth: .14, core_age: .56, senior: .30 },
  MN: { youth: .15, core_age: .57, senior: .28 },
  MS: { youth: .14, core_age: .57, senior: .29 },
  MT: { youth: .13, core_age: .55, senior: .32 },
  NE: { youth: .15, core_age: .56, senior: .29 },
  NV: { youth: .16, core_age: .60, senior: .24 },
  NH: { youth: .12, core_age: .55, senior: .33 },
  NJ: { youth: .14, core_age: .57, senior: .29 },
  NM: { youth: .14, core_age: .56, senior: .30 },
  NC: { youth: .15, core_age: .58, senior: .27 },
  OH: { youth: .14, core_age: .56, senior: .30 },
  OK: { youth: .14, core_age: .57, senior: .29 },
  OR: { youth: .14, core_age: .57, senior: .29 },
  PA: { youth: .13, core_age: .56, senior: .31 },
  RI: { youth: .13, core_age: .56, senior: .31 },
  SC: { youth: .13, core_age: .56, senior: .31 },
  SD: { youth: .14, core_age: .55, senior: .31 },
  TN: { youth: .13, core_age: .57, senior: .30 },
  TX: { youth: .16, core_age: .60, senior: .24 },
  UT: { youth: .15, core_age: .57, senior: .28 },
  VA: { youth: .15, core_age: .58, senior: .27 },
  WA: { youth: .16, core_age: .59, senior: .25 },
  WV: { youth: .11, core_age: .54, senior: .35 },
  WI: { youth: .14, core_age: .56, senior: .30 },
  WY: { youth: .13, core_age: .56, senior: .31 }
};

const PATH_CENTRALITY = {
  OH: 1.85, TX: 1.65, AK: 1.6, MI: 1.35, GA: 1.25, NC: 1.12, ME: 1.1, NH: 1,
  IA: .75, NE: .72, MT: .68, SC: .55, KS: .45, FL: .25
};

const STATE_ELASTICITY = {
  AK: 1.18, AZ: 1.08, GA: 1.12, IA: 1.1, ME: .86, MI: 1.12, MN: .9, MT: 1.04,
  NC: 1.18, NH: .94, OH: 1.22, PA: 1.12, TX: 1.16, VA: .86, WI: 1.12
};

const CANDIDATE_HISTORY = {
  OH: 1.15, PA: 1.25, GA: .7, MI: .25, NE: 1.45, MT: .8, NC: 1.25
};

const GOVERNOR_RACES = [
  { state: "AL", incumbentParty: "R", incumbent: "Kay Ivey", status: "Term-limited", pvi: -15, lastMargin: -33.8, rating: "Safe R", demCandidate: "Doug Jones", repCandidate: "Tommy Tuberville", candidateEdge: 1.2 },
  { state: "AK", incumbentParty: "R", incumbent: "Mike Dunleavy", status: "Term-limited", pvi: -6, lastMargin: -5.7, rating: "Lean R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "AZ", incumbentParty: "D", incumbent: "Katie Hobbs", status: "Incumbent running", pvi: -2, lastMargin: .6, rating: "Toss-up", demCandidate: "Katie Hobbs", repCandidate: "Republican", candidateEdge: -.4 },
  { state: "AR", incumbentParty: "R", incumbent: "Sarah Huckabee Sanders", status: "Incumbent renominated", pvi: -15, lastMargin: -26, rating: "Safe R", demCandidate: "Fredrick Love", repCandidate: "Sarah Huckabee Sanders", candidateEdge: -1 },
  { state: "CA", incumbentParty: "D", incumbent: "Gavin Newsom", status: "Term-limited", pvi: 12, lastMargin: 18.4, rating: "Safe D", demCandidate: "Xavier Becerra", repCandidate: "Steve Hilton", candidateEdge: .2 },
  { state: "CO", incumbentParty: "D", incumbent: "Jared Polis", status: "Term-limited", pvi: 6, lastMargin: 19.3, rating: "Safe D", demCandidate: "Phil Weiser", repCandidate: "Republican", candidateEdge: 1 },
  { state: "CT", incumbentParty: "D", incumbent: "Ned Lamont", status: "Incumbent running", pvi: 8, lastMargin: 12, rating: "Safe D", demCandidate: "Ned Lamont", repCandidate: "Ryan Fazio", candidateEdge: .6 },
  { state: "FL", incumbentParty: "R", incumbent: "Ron DeSantis", status: "Term-limited", pvi: -5, lastMargin: -19.4, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: -.2 },
  { state: "GA", incumbentParty: "R", incumbent: "Brian Kemp", status: "Term-limited", pvi: -1, lastMargin: -7.5, rating: "Toss-up", demCandidate: "Keisha Lance Bottoms", repCandidate: "Rick Jackson", candidateEdge: .65 },
  { state: "HI", incumbentParty: "D", incumbent: "Josh Green", status: "Incumbent running", pvi: 13, lastMargin: 26.4, rating: "Safe D", demCandidate: "Josh Green", repCandidate: "Gary Cordery", candidateEdge: 1 },
  { state: "ID", incumbentParty: "R", incumbent: "Brad Little", status: "Incumbent renominated", pvi: -18, lastMargin: -20.6, rating: "Safe R", demCandidate: "Terri Pickens", repCandidate: "Brad Little", candidateEdge: -1 },
  { state: "IL", incumbentParty: "D", incumbent: "JB Pritzker", status: "Incumbent renominated", pvi: 6, lastMargin: 12.5, rating: "Safe D", demCandidate: "JB Pritzker", repCandidate: "Darren Bailey", candidateEdge: 1.1 },
  { state: "IA", incumbentParty: "R", incumbent: "Kim Reynolds", status: "Incumbent retiring", pvi: -6, lastMargin: -18.6, rating: "Toss-up", demCandidate: "Rob Sand", repCandidate: "Zach Lahn", candidateEdge: 2.1 },
  { state: "KS", incumbentParty: "D", incumbent: "Laura Kelly", status: "Term-limited", pvi: -8, lastMargin: 2.2, rating: "Lean R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .5 },
  { state: "ME", incumbentParty: "D", incumbent: "Janet Mills", status: "Term-limited", pvi: 4, lastMargin: 12.8, rating: "Likely D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "MD", incumbentParty: "D", incumbent: "Wes Moore", status: "Incumbent running", pvi: 15, lastMargin: 29.9, rating: "Safe D", demCandidate: "Wes Moore", repCandidate: "Republican", candidateEdge: 1.5 },
  { state: "MA", incumbentParty: "D", incumbent: "Maura Healey", status: "Incumbent running", pvi: 14, lastMargin: 29.2, rating: "Safe D", demCandidate: "Maura Healey", repCandidate: "Republican", candidateEdge: 1.2 },
  { state: "MI", incumbentParty: "D", incumbent: "Gretchen Whitmer", status: "Term-limited", pvi: 0, lastMargin: 10.6, rating: "Lean D", demCandidate: "Jocelyn Benson", repCandidate: "Republican", candidateEdge: .9 },
  { state: "MN", incumbentParty: "D", incumbent: "Tim Walz", status: "Incumbent retiring", pvi: 3, lastMargin: 7.7, rating: "Likely D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "NE", incumbentParty: "R", incumbent: "Jim Pillen", status: "Incumbent running", pvi: -10, lastMargin: -23.8, rating: "Safe R", demCandidate: "Lynne Walz", repCandidate: "Jim Pillen", candidateEdge: -1 },
  { state: "NV", incumbentParty: "R", incumbent: "Joe Lombardo", status: "Incumbent running", pvi: -1, lastMargin: -1.5, rating: "Toss-up", demCandidate: "Democrat", repCandidate: "Joe Lombardo", candidateEdge: -1.6 },
  { state: "NH", incumbentParty: "R", incumbent: "Kelly Ayotte", status: "Incumbent running", pvi: 2, lastMargin: -9.2, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Kelly Ayotte", candidateEdge: -1.6 },
  { state: "NM", incumbentParty: "D", incumbent: "Michelle Lujan Grisham", status: "Term-limited", pvi: 4, lastMargin: 6.4, rating: "Likely D", demCandidate: "Deb Haaland", repCandidate: "Republican", candidateEdge: .6 },
  { state: "NY", incumbentParty: "D", incumbent: "Kathy Hochul", status: "Incumbent running", pvi: 8, lastMargin: 6.4, rating: "Safe D", demCandidate: "Kathy Hochul", repCandidate: "Republican", candidateEdge: .3 },
  { state: "OH", incumbentParty: "R", incumbent: "Mike DeWine", status: "Term-limited", pvi: -5, lastMargin: -25.4, rating: "Toss-up", demCandidate: "Amy Acton", repCandidate: "Vivek Ramaswamy", candidateEdge: -.4 },
  { state: "OK", incumbentParty: "R", incumbent: "Kevin Stitt", status: "Term-limited", pvi: -17, lastMargin: -13.7, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Gentner Drummond / Mike Mazzei runoff", candidateEdge: -.45 },
  { state: "OR", incumbentParty: "D", incumbent: "Tina Kotek", status: "Incumbent running", pvi: 8, lastMargin: 3.4, rating: "Likely D", demCandidate: "Tina Kotek", repCandidate: "Christine Drazan", candidateEdge: .2 },
  { state: "PA", incumbentParty: "D", incumbent: "Josh Shapiro", status: "Incumbent running", pvi: -1, lastMargin: 14.8, rating: "Safe D", demCandidate: "Josh Shapiro", repCandidate: "Stacy Garrity", candidateEdge: 2.2 },
  { state: "RI", incumbentParty: "D", incumbent: "Dan McKee", status: "Incumbent running", pvi: 8, lastMargin: 19.3, rating: "Safe D", demCandidate: "Dan McKee", repCandidate: "Republican", candidateEdge: .5 },
  { state: "SC", incumbentParty: "R", incumbent: "Henry McMaster", status: "Term-limited", pvi: -8, lastMargin: -17.8, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Alan Wilson", candidateEdge: -.7 },
  { state: "SD", incumbentParty: "R", incumbent: "Larry Rhoden", status: "Incumbent running", pvi: -15, lastMargin: -24, rating: "Safe R", demCandidate: "Daniel Ahlers", repCandidate: "Larry Rhoden", candidateEdge: -.8 },
  { state: "TN", incumbentParty: "R", incumbent: "Bill Lee", status: "Term-limited", pvi: -14, lastMargin: -32.7, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Andy Ogles", candidateEdge: -1 },
  { state: "TX", incumbentParty: "R", incumbent: "Greg Abbott", status: "Incumbent renominated", pvi: -6, lastMargin: -10.9, rating: "Safe R", demCandidate: "Gina Hinojosa", repCandidate: "Greg Abbott", candidateEdge: -1.7 },
  { state: "VT", incumbentParty: "R", incumbent: "Phil Scott", status: "Incumbent running", pvi: 17, lastMargin: -46.9, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Phil Scott", candidateEdge: -6.5 },
  { state: "WI", incumbentParty: "D", incumbent: "Tony Evers", status: "Incumbent retiring", pvi: 0, lastMargin: 3.4, rating: "Toss-up", demCandidate: "Sara Rodriguez", repCandidate: "Tom Tiffany", candidateEdge: .5 },
  { state: "WY", incumbentParty: "R", incumbent: "Mark Gordon", status: "Term-limited", pvi: -23, lastMargin: -53.8, rating: "Safe R", demCandidate: "Gabriel Green", repCandidate: "Republican", candidateEdge: -.8 }
];

const GOVERNOR_CANDIDATE_STATUS = {
  AL: { dem: "Doug Jones", rep: "Tommy Tuberville", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Jones won the Democratic primary and Tuberville won the Republican primary on May 19, 2026." },
  AK: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "top-four", primaryDate: "2026-08-18", primarySummary: "Alaska uses a nonpartisan top-four primary. Multiple Democrats, Republicans, and independents remain possible general-election options." },
  AZ: { dem: "Katie Hobbs", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Hobbs is the Democratic incumbent and treated as presumptive; the Republican primary remains open." },
  AR: { dem: "Fredrick Love", rep: "Sarah Huckabee Sanders", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Sanders and Love are treated as nominated after Arkansas' March primary." },
  CA: { dem: "Xavier Becerra", rep: "Steve Hilton", demStatus: "front-runner", repStatus: "front-runner", primary: "top-two", primaryDate: "2026-06-02", primarySummary: "California's top-two primary has a large field. Becerra and Hilton are tracked as the leading Democratic and Republican options before votes are reported." },
  CO: { dem: "Phil Weiser", rep: "Republican", demStatus: "front-runner", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-30", primarySummary: "Weiser is tracked as the leading Democratic option in Colorado's open-seat race; the Republican side remains unresolved." },
  CT: { dem: "Ned Lamont", rep: "Ryan Fazio", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Lamont is the Democratic incumbent and treated as presumptive while the Republican side remains unsettled." },
  FL: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", primarySummary: "Florida is an open seat with both major-party primaries unresolved." },
  GA: { dem: "Keisha Lance Bottoms", rep: "Rick Jackson", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-06-16", primarySummary: "Bottoms won the Democratic primary on May 19, 2026. Jackson won the June 16 Republican runoff." },
  HI: { dem: "Josh Green", rep: "Gary Cordery", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-08", primarySummary: "Green is the Democratic incumbent and treated as presumptive." },
  ID: { dem: "Terri Pickens", rep: "Brad Little", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Little and Pickens are treated as nominated after Idaho's May primary." },
  IL: { dem: "JB Pritzker", rep: "Darren Bailey", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-17", primarySummary: "Pritzker and Bailey are treated as nominated after Illinois' March primary." },
  IA: { dem: "Rob Sand", rep: "Zach Lahn", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-06-02", primarySummary: "Iowa held its June 2 primaries. Sand won the Democratic nomination and Lahn won the Republican nomination." },
  KS: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Both Kansas primaries remain unresolved in the manual ledger." },
  ME: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Maine's open-seat field is unsettled." },
  MD: { dem: "Wes Moore", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Moore is the Democratic incumbent and treated as presumptive." },
  MA: { dem: "Maura Healey", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-01", primarySummary: "Healey is the Democratic incumbent and treated as presumptive." },
  MI: { dem: "Jocelyn Benson", rep: "Republican", demStatus: "front-runner", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Benson is tracked as the leading Democratic option in Michigan's open-seat race; the Republican primary remains unresolved." },
  MN: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Minnesota is an open seat and the model is not assigning a presumptive major-party nominee yet." },
  NE: { dem: "Lynne Walz", rep: "Jim Pillen", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-12", primarySummary: "Walz won the Democratic primary and Pillen won the Republican primary on May 12, 2026." },
  NV: { dem: "Democrat", rep: "Joe Lombardo", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Lombardo is the Republican incumbent and treated as presumptive." },
  NH: { dem: "Democrat", rep: "Kelly Ayotte", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-09-08", primarySummary: "Ayotte is the Republican incumbent and treated as presumptive." },
  NM: { dem: "Deb Haaland", rep: "Republican", demStatus: "front-runner", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Haaland is tracked as the leading Democratic option in New Mexico's open-seat race; the Republican primary remains unresolved." },
  NY: { dem: "Kathy Hochul", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Hochul is the Democratic incumbent and treated as presumptive." },
  OH: { dem: "Amy Acton", rep: "Vivek Ramaswamy", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-05", primarySummary: "Acton won the Democratic primary and Ramaswamy won the Republican primary on May 5, 2026." },
  OK: { dem: "Democrat", rep: "Gentner Drummond / Mike Mazzei runoff", demStatus: "unresolved", repStatus: "runoff", primary: "runoff", primaryDate: "2026-08-25", primarySummary: "Oklahoma's June 16 Republican primary advanced Drummond and Mazzei to an August 25 runoff; the Democratic side remains unresolved in the manual ledger." },
  OR: { dem: "Tina Kotek", rep: "Christine Drazan", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Kotek won the Democratic primary and Drazan won the Republican primary on May 19, 2026." },
  PA: { dem: "Josh Shapiro", rep: "Stacy Garrity", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Shapiro won the Democratic primary and Garrity won the Republican primary on May 19, 2026." },
  RI: { dem: "Dan McKee", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-09", primarySummary: "McKee is the Democratic incumbent and treated as presumptive." },
  SC: { dem: "Democrat", rep: "Alan Wilson", demStatus: "unresolved", repStatus: "front-runner", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Wilson is tracked as the leading Republican option in South Carolina's open-seat race; the Democratic primary remains unresolved." },
  SD: { dem: "Daniel Ahlers", rep: "Larry Rhoden", demStatus: "presumptive", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Ahlers is the presumptive Democratic nominee. Rhoden is the Republican incumbent and treated as presumptive for the June 2 primary." },
  TN: { dem: "Democrat", rep: "Andy Ogles", demStatus: "unresolved", repStatus: "front-runner", primary: "unresolved", primaryDate: "2026-08-06", primarySummary: "Ogles is tracked as the leading Republican option in Tennessee's open-seat race; the Democratic primary remains unresolved." },
  TX: { dem: "Gina Hinojosa", rep: "Greg Abbott", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Abbott and Hinojosa are treated as nominated after the Texas primary." },
  VT: { dem: "Democrat", rep: "Phil Scott", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Scott is the Republican incumbent and treated as presumptive; Democrats have multiple declared candidates." },
  WI: { dem: "Sara Rodriguez", rep: "Tom Tiffany", demStatus: "front-runner", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Wisconsin is an open seat. Rodriguez is tracked as the leading Democratic option and Tiffany is treated as the Republican front-runner." },
  WY: { dem: "Gabriel Green", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", primarySummary: "Wyoming is an open seat and both primaries remain unresolved." }
};

const GOVERNOR_DEMOGRAPHIC_PROFILES = {
  incumbentDemocrat: { white_college: .12, white_noncollege: -.06, black: .08, latino: .05, asian_other: .05, youth: .02, senior: .04 },
  incumbentRepublican: { white_college: -.02, white_noncollege: .12, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 },
  statewideDemocrat: { white_college: .1, white_noncollege: -.02, black: .08, latino: .05, asian_other: .04, youth: .03, senior: .01 },
  statewideRepublican: { white_college: -.03, white_noncollege: .11, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .06 },
  standardDemocrat: { white_college: .06, white_noncollege: -.05, black: .07, latino: .04, asian_other: .03, youth: .03, senior: -.01 },
  standardRepublican: { white_college: -.06, white_noncollege: .1, black: -.07, latino: -.04, asian_other: -.03, youth: -.04, senior: .05 },
  independent: { white_college: .04, white_noncollege: .12, black: .01, latino: .02, asian_other: .02, youth: .05, senior: .01 }
};

const GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES = {
  "phil scott": { profile: "popular Vermont Republican incumbent", scores: { white_college: .18, white_noncollege: .3, black: -.02, latino: .01, asian_other: .02, youth: .02, senior: .22 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "josh shapiro": { profile: "high-approval Pennsylvania Democratic incumbent", scores: { white_college: .18, white_noncollege: .08, black: .1, latino: .04, asian_other: .05, youth: .03, senior: .12 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "rob sand": { profile: "Iowa statewide Democratic auditor", scores: { white_college: .08, white_noncollege: .18, black: .04, latino: .03, asian_other: .02, youth: .04, senior: .06 }, strengths: ["White non-college", "White college"], weaknesses: [] },
  "zach lahn": { profile: "Iowa Republican nominee with rural-conservative primary profile", scores: { white_college: -.05, white_noncollege: .17, black: -.07, latino: -.03, asian_other: -.02, youth: -.04, senior: .08 }, strengths: ["White non-college", "65+"], weaknesses: ["White college", "Black"] },
  "joe lombardo": { profile: "Nevada Republican incumbent", scores: { white_college: -.02, white_noncollege: .12, black: -.06, latino: .02, asian_other: -.01, youth: -.04, senior: .08 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["18-29"] },
  "kelly ayotte": { profile: "New Hampshire Republican incumbent", scores: { white_college: .02, white_noncollege: .1, black: -.05, latino: -.02, asian_other: -.01, youth: -.05, senior: .08 }, strengths: ["White college", "65+"], weaknesses: ["18-29"] },
  "katie hobbs": { profile: "Arizona Democratic incumbent", scores: { white_college: .12, white_noncollege: -.05, black: .06, latino: .08, asian_other: .04, youth: .03, senior: -.01 }, strengths: ["White college", "Latino"], weaknesses: ["White non-college"] },
  "greg abbott": { profile: "Texas Republican incumbent", scores: { white_college: -.08, white_noncollege: .2, black: -.09, latino: .02, asian_other: -.04, youth: -.08, senior: .12 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["White college", "18-29"] },
  "amy acton": { profile: "Former Ohio health director, public health background", scores: { white_college: .08, white_noncollege: -.03, black: .09, latino: .05, asian_other: .04, youth: .05, senior: .01 }, strengths: ["White college", "Black", "Latino"], weaknesses: ["White non-college"] },
  "vivek ramaswamy": { profile: "Entrepreneur, Trump-aligned Republican", scores: { white_college: -.07, white_noncollege: .19, black: -.11, latino: -.04, asian_other: .02, youth: -.03, senior: .04 }, strengths: ["White non-college"], weaknesses: ["White college", "Black", "Latino"] },
  "keisha lance bottoms": { profile: "Former Atlanta mayor, Black woman, progressive Democrat", scores: { white_college: .05, white_noncollege: -.06, black: .15, latino: .04, asian_other: .03, youth: .04, senior: -.02 }, strengths: ["Black"], weaknesses: ["White non-college"] },
  "rick jackson": { profile: "Georgia Republican nominee after runoff, rural-conservative profile", scores: { white_college: -.05, white_noncollege: .14, black: -.08, latino: -.03, asian_other: -.03, youth: -.05, senior: .07 }, strengths: ["White non-college", "65+"], weaknesses: ["Black", "White college"] },
  "gentner drummond": { profile: "Oklahoma attorney general, statewide Republican profile", scores: { white_college: -.03, white_noncollege: .14, black: -.08, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 }, strengths: ["White non-college", "65+"], weaknesses: ["Black"] },
  "mike mazzei": { profile: "Oklahoma Republican runoff candidate, conservative business profile", scores: { white_college: -.04, white_noncollege: .13, black: -.08, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 }, strengths: ["White non-college", "65+"], weaknesses: ["Black"] },
  "lynne walz": { profile: "Former Nebraska state senator, educator", scores: { white_college: .07, white_noncollege: -.04, black: .07, latino: .05, asian_other: .04, youth: .04, senior: 0 }, strengths: [], weaknesses: [] },
  "jim pillen": { profile: "Nebraska incumbent governor, rancher", scores: { white_college: -.01, white_noncollege: .14, black: -.07, latino: -.03, asian_other: -.02, youth: -.04, senior: .09 }, strengths: ["White non-college", "Senior"], weaknesses: [] },
  "tina kotek": { profile: "Oregon incumbent governor, progressive Democrat", scores: { white_college: .14, white_noncollege: -.04, black: .09, latino: .06, asian_other: .06, youth: .03, senior: .05 }, strengths: ["White college", "Asian/other", "Latino"], weaknesses: ["White non-college"] },
  "christine drazan": { profile: "Former Oregon Senate minority leader, 2022 Republican nominee", scores: { white_college: -.04, white_noncollege: .12, black: -.06, latino: -.03, asian_other: -.02, youth: -.03, senior: .06 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college"] },
  "stacy garrity": { profile: "Pennsylvania state treasurer, former military officer", scores: { white_college: -.04, white_noncollege: .12, black: -.06, latino: -.03, asian_other: -.02, youth: -.03, senior: .07 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college"] },
  "daniel ahlers": { profile: "South Dakota Democratic Party executive director, former state senator", scores: { white_college: .07, white_noncollege: -.04, black: .07, latino: .04, asian_other: .03, youth: .04, senior: -.01 }, strengths: [], weaknesses: [] },
  "larry rhoden": { profile: "South Dakota incumbent governor, former lieutenant governor", scores: { white_college: -.01, white_noncollege: .14, black: -.07, latino: -.03, asian_other: -.02, youth: -.04, senior: .09 }, strengths: ["White non-college", "Senior"], weaknesses: [] },
  "tom tiffany": { profile: "Wisconsin Republican congressional profile", scores: { white_college: -.08, white_noncollege: .18, black: -.08, latino: -.03, asian_other: -.03, youth: -.06, senior: .06 }, strengths: ["White non-college"], weaknesses: ["White college", "18-29"] }
  ,"xavier becerra": { profile: "California Democratic statewide federal official", scores: { white_college: .1, white_noncollege: -.04, black: .08, latino: .16, asian_other: .07, youth: .04, senior: .02 }, strengths: ["Latino", "White college", "Asian/other"], weaknesses: ["White non-college"] },
  "steve hilton": { profile: "California conservative media candidate", scores: { white_college: -.09, white_noncollege: .15, black: -.08, latino: -.03, asian_other: -.03, youth: -.05, senior: .07 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college", "Black"] },
  "phil weiser": { profile: "Colorado Democratic attorney general", scores: { white_college: .14, white_noncollege: -.02, black: .08, latino: .06, asian_other: .06, youth: .03, senior: .04 }, strengths: ["White college", "Latino"], weaknesses: [] },
  "jocelyn benson": { profile: "Michigan Democratic secretary of state", scores: { white_college: .13, white_noncollege: -.01, black: .09, latino: .04, asian_other: .04, youth: .04, senior: .03 }, strengths: ["White college", "Black"], weaknesses: [] },
  "peggy flanagan": { profile: "Minnesota Democratic lieutenant governor", scores: { white_college: .11, white_noncollege: -.03, black: .08, latino: .06, asian_other: .05, youth: .05, senior: .01 }, strengths: ["White college", "Youth"], weaknesses: ["White non-college"] },
  "deb haaland": { profile: "New Mexico Democratic former Interior secretary", scores: { white_college: .1, white_noncollege: -.02, black: .07, latino: .12, asian_other: .05, youth: .05, senior: .02 }, strengths: ["Latino", "White college", "Youth"], weaknesses: [] },
  "alan wilson": { profile: "South Carolina Republican attorney general", scores: { white_college: -.03, white_noncollege: .13, black: -.08, latino: -.03, asian_other: -.02, youth: -.04, senior: .08 }, strengths: ["White non-college", "Senior"], weaknesses: ["Black"] },
  "andy ogles": { profile: "Tennessee conservative congressional Republican", scores: { white_college: -.08, white_noncollege: .18, black: -.09, latino: -.04, asian_other: -.03, youth: -.06, senior: .06 }, strengths: ["White non-college"], weaknesses: ["White college", "Black"] },
  "sara rodriguez": { profile: "Wisconsin Democratic lieutenant governor", scores: { white_college: .12, white_noncollege: -.01, black: .08, latino: .07, asian_other: .05, youth: .04, senior: .03 }, strengths: ["White college", "Latino"], weaknesses: [] },
  "randy feenstra": { profile: "Iowa Republican congressional profile", scores: { white_college: -.04, white_noncollege: .15, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college"] }
};

function readPreviousForecast() {
  try {
    return JSON.parse(readFileSync(FORECAST_URL, "utf8"));
  } catch {
    return null;
  }
}

function readGovernorHistoryArchive() {
  try {
    return JSON.parse(readFileSync(GOVERNOR_HISTORY_URL, "utf8"));
  } catch {
    return null;
  }
}

function mergeHistoryPoints(...histories) {
  const byDate = new Map();
  for (const history of histories) {
    if (!Array.isArray(history)) continue;
    for (const point of history) {
      if (!point?.date) continue;
      byDate.set(point.date, point);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function readSenateSignals() {
  try {
    const senate = JSON.parse(readFileSync(new URL("../data/forecast.json", import.meta.url), "utf8"));
    const generic = Number(senate?.sourceSummary?.genericPolling?.genericBallotMargin);
    const approval = Number(senate?.sourceSummary?.trumpApproval?.netApproximation);
    return {
      genericBallotMargin: Number.isFinite(generic) ? generic : 0,
      approvalNet: Number.isFinite(approval) ? approval : null
    };
  } catch {
    return { genericBallotMargin: 0, approvalNet: null };
  }
}

function erf(value) {
  const sign = Math.sign(value);
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value, mean, sd) {
  return 0.5 * (1 + erf((value - mean) / (sd * Math.sqrt(2))));
}

function sampleNormal(mean, sd) {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function localDateKey(date = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(process.env.MODEL_DATE || "")) return process.env.MODEL_DATE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localRunDateLabel(date = new Date()) {
  const modelDate = process.env.MODEL_DATE;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(modelDate || "") ? new Date(`${modelDate}T12:00:00`) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(source);
}

function candidateProfileKey(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function governorProfileKey(race, party) {
  const status = party === "D" ? race.demStatus : race.repStatus;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty === "I") return "independent";
  if (party === "D" && race.incumbentParty === "D" && status === "presumptive") return "incumbentDemocrat";
  if (party === "R" && race.incumbentParty === "R" && status === "presumptive") return "incumbentRepublican";
  if (party === "D" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.dem || "")) return "statewideDemocrat";
  if (party === "R" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.rep || "")) return "statewideRepublican";
  return party === "D" ? "standardDemocrat" : "standardRepublican";
}

function governorCandidateProfile(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const specific = GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES[candidateProfileKey(name)];
  if (specific) {
    return { key: candidateProfileKey(name), label: name, source: "candidate", ...specific };
  }
  const genericKey = governorProfileKey(race, party);
  return {
    key: genericKey,
    label: genericKey.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    source: "generic",
    scores: GOVERNOR_DEMOGRAPHIC_PROFILES[genericKey] || {},
    strengths: [],
    weaknesses: []
  };
}

function financeSideForRace(fec, race) {
  const independent = INDEPENDENT_CONTROL_FINANCE[race.state];
  if (independent?.side === "dem" && fec.otherReceipts > fec.demReceipts) {
    return {
      ...fec,
      demReceipts: fec.otherReceipts,
      demCash: fec.otherCash,
      demDebts: fec.otherDebts,
      demIndividual: fec.otherIndividual,
      demFinanceLabel: independent.label,
      demFinanceParty: "I",
      financeTreatment: `${independent.label} is an independent who counts with Democrats for control, so independent-side FEC money is compared against Republican money.`
    };
  }
  return { ...fec, demFinanceLabel: "Democratic side", repFinanceLabel: "Republican side" };
}

function nationalFinanceSignal(finance) {
  const demScore = Math.log1p(Math.max(finance.demReceipts, 0) + Math.max(finance.demCash, 0) * 1.1) - Math.log1p(Math.max(finance.demDebts, 0) * 1.2);
  const repScore = Math.log1p(Math.max(finance.repReceipts, 0) + Math.max(finance.repCash, 0) * 1.1) - Math.log1p(Math.max(finance.repDebts, 0) * 1.2);
  return Number(clamp((demScore - repScore) / 5, -.8, .8).toFixed(3));
}

function governorElectorateWeights(state) {
  const baseline = MIDTERM_LIKELY_VOTER_BASELINES[state] || { white_college: .3, white_noncollege: .4, black: .1, latino: .1, asian_other: .05 };
  const ageBaseline = MIDTERM_AGE_BASELINES[state] || { youth: .15, core_age: .6, senior: .25 };
  const weights = {
    white_college: baseline.white_college,
    white_noncollege: baseline.white_noncollege,
    black: baseline.black,
    latino: baseline.latino,
    asian_other: baseline.asian_other,
    youth: ageBaseline.youth,
    senior: ageBaseline.senior
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
}

function stateElectorateComposition(race) {
  const state = race.state;
  const traits = STATE_COALITION_TRAITS[state] || [];
  const highCollege = traits.includes("college") || traits.includes("suburban");
  const highNoncollege = traits.includes("rural") || traits.includes("working_class") || traits.includes("appalachian") || traits.includes("frontier");
  const highBlack = traits.includes("black_belt") || ["GA", "NC", "SC", "MS", "LA", "AL", "MD", "VA"].includes(state);
  const highLatino = traits.includes("latino") || ["AZ", "CA", "FL", "NV", "NM", "TX"].includes(state);
  const highAsianOther = ["CA", "HI", "NJ", "NY", "WA", "VA", "MD", "NV"].includes(state);
  const fastGrowth = ["AZ", "FL", "GA", "NC", "NV", "TX"].includes(state);

  const raceEducation = {
    white_college: highCollege ? .27 : highNoncollege ? .14 : .2,
    white_noncollege: highNoncollege ? .38 : highCollege ? .22 : .31,
    black: highBlack ? .2 : .08,
    latino: highLatino ? (fastGrowth ? .21 : .18) : .06,
    asian_other: highAsianOther ? .12 : .05
  };
  const baseline = MIDTERM_LIKELY_VOTER_BASELINES[state];
  const modeledAge = {
    youth: traits.includes("urban") || traits.includes("college") || fastGrowth ? .13 : .09,
    core_age: traits.includes("senior") || highNoncollege ? .7 : .75,
    senior: traits.includes("senior") || highNoncollege ? .21 : .16
  };
  const ageBaseline = MIDTERM_AGE_BASELINES[state];
  return {
    source: baseline && ageBaseline
      ? "Manual midterm likely-voter baseline; not fixed truth"
      : baseline
      ? "Manual midterm likely-voter baseline; not fixed truth"
      : "Modeled from state turnout traits",
    raceEducation: baseline ? baseline : raceEducation,
    age: ageBaseline ? ageBaseline : modeledAge,
    notes: [
      "Race/education blocs are mutually exclusive expected-voter shares and sum to 100%.",
      "Age shares are a separate turnout overlay and are not added to race/education shares."
    ]
  };
}

function demographicWeightsForRace(race) {
  const composition = race.electorateComposition || stateElectorateComposition(race);
  return {
    ...composition.raceEducation,
    youth: composition.age.youth,
    senior: composition.age.senior
  };
}

function demographicPullAdjustment(race) {
  const weights = demographicWeightsForRace(race);
  const demProfile = governorCandidateProfile(race, "D");
  const repProfile = governorCandidateProfile(race, "R");
  const groups = Object.keys(weights).map((group) => {
    const effect = weights[group] * ((demProfile.scores[group] || 0) - (repProfile.scores[group] || 0)) * 1.75;
    return { group, weight: weights[group], effect: Number(effect.toFixed(2)) };
  });
  const raw = groups.reduce((sum, group) => sum + group.effect, 0);
  const saturation = Math.abs(race.pvi) > 18 ? .55 : Math.abs(race.pvi) > 10 ? .75 : 1;
  return {
    adjustment: Number(clamp(raw * saturation, -1.1, 1.1).toFixed(2)),
    demProfile,
    repProfile,
    topGroups: groups.filter((group) => Math.abs(group.effect) >= .03).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 5)
  };
}

function ratingFromProbability(probability, margin) {
  const side = probability >= 0.5 ? "D" : "R";
  const winnerProbability = Math.max(probability, 1 - probability);
  const absMargin = Math.abs(margin);
  if (winnerProbability >= 0.97 || absMargin >= 15) return `Safe ${side}`;
  if (winnerProbability >= 0.84 || absMargin >= 8) return `Likely ${side}`;
  if (winnerProbability >= 0.68 || absMargin >= 4) return `Lean ${side}`;
  if (winnerProbability >= 0.56 || absMargin >= 1.5) return `Tilt ${side}`;
  return "Toss-up";
}

function governorRaceError(race, fundamentals, hasPolls) {
  const structuralCertainty = Math.min(2.25, Math.abs(fundamentals) * .13);
  const incumbentStability = race.status.includes("Incumbent") ? .45 : 0;
  const pollingCertainty = hasPolls ? .45 : 0;
  const openSeatUncertainty = race.status.includes("Term-limited") || race.status.includes("retiring") ? .85 : 0;
  return clamp(9.4 - structuralCertainty - incumbentStability - pollingCertainty + openSeatUncertainty, 5.6, 12);
}

function statusEffect(race) {
  if (race.status.includes("Incumbent")) return race.incumbentParty === "D" ? 2.4 : -2.4;
  if (race.status.includes("Term-limited") || race.status.includes("retiring")) return race.incumbentParty === "D" ? -.8 : .8;
  return 0;
}

const EXPERT_RATING_INTERVALS = {
  "Safe D": [12, Infinity], "Likely D": [6, 12], "Lean D": [2, 6], "Tilt D": [.5, 2],
  "Toss-up": [-1, 1],
  "Tilt R": [-2, -.5], "Lean R": [-6, -2], "Likely R": [-12, -6], "Safe R": [-Infinity, -12]
};

function softGovernorRatingAdjustment(margin, rating) {
  const interval = EXPERT_RATING_INTERVALS[rating];
  if (!interval || !Number.isFinite(margin)) return { margin, adjustment: 0, weight: 0 };
  const [lower, upper] = interval;
  const boundary = margin < lower ? lower : margin > upper ? upper : margin;
  const days = Math.max(0, (new Date("2026-11-03T12:00:00Z") - new Date()) / 86400000);
  const progress = clamp(1 - days / 306, 0, 1);
  const weight = .14 + .16 * progress;
  const adjustment = (boundary - margin) * weight;
  return { margin: margin + adjustment, adjustment: Number(adjustment.toFixed(3)), weight: Number(weight.toFixed(3)) };
}

function buildRace(baseRace, nationalShift, sourceData) {
  const candidateInfo = GOVERNOR_CANDIDATE_STATUS[baseRace.state] || {};
  const race = {
    ...baseRace,
    ...candidateInfo,
    dem: candidateInfo.dem || baseRace.demCandidate || "Democratic field",
    rep: candidateInfo.rep || baseRace.repCandidate || "Republican field",
    demStatus: candidateInfo.demStatus || "unresolved",
    repStatus: candidateInfo.repStatus || "unresolved",
    independent: candidateInfo.extraCandidates?.some((candidate) => candidate.party === "I") ? "tracked independent candidate" : "none",
    caucusTarget: "none"
  };
  const electorateComposition = stateElectorateComposition(race);
  const fundamentals = (race.pvi * .34) + (race.lastMargin * .18) + statusEffect(race);
  const candidateAndLocal = race.candidateEdge || 0;
  const demographicPull = demographicPullAdjustment({ ...race, electorateComposition });
  
  // Candidate history adjustment
  const candidateHistory = CANDIDATE_HISTORY[race.state] || 0;
  
  // Finance integration
  let financeSignal = 0;
  let nationalFinance = 0;
  let raceFec = null;
  const fec = sourceData?.fec?.[race.state];
  if (fec) {
    raceFec = financeSideForRace(fec, race);
    const demEfficiency = (raceFec.demCash + raceFec.demIndividual * .45 - raceFec.demDebts * .7) / Math.sqrt(1 + Math.max(raceFec.demDisbursements, 1));
    const repEfficiency = (raceFec.repCash + raceFec.repIndividual * .45 - raceFec.repDebts * .7) / Math.sqrt(1 + Math.max(raceFec.repDisbursements, 1));
    const efficiencySignal = clamp((demEfficiency - repEfficiency) / 1800, -1.35, 1.35);
    const rawReceiptSignal = clamp((raceFec.demReceipts - raceFec.repReceipts) / 8000000, -1, 1);
    financeSignal = efficiencySignal * .72 + rawReceiptSignal * .28;
  }
  if (sourceData?.fec?.__national) {
    nationalFinance = sourceData.fec.__national.financeSignal * MODEL_WEIGHTS.nationalFinance;
  }
  // Polling integration
  let pollMargin = 0;
  const governorPoll = sourceData?.governorPolling?.governorPolls?.[race.state];
  const governorPrimarySignal = sourceData?.twoSeventyGovernor?.governorPrimarySignals?.[race.state];
  if (governorPoll && governorPoll.polls > 0) {
    const pollWeight = clamp(.2 + Math.log1p(governorPoll.polls) * .12, .25, .5) * (governorPoll.weightScale || 1);
    pollMargin = governorPoll.margin * pollWeight;
  }
  const directGovernorPoll = governorPoll?.reducedWeight ? null : governorPoll;
  const primaryPollSignal = 0;
  
  const rawMargin = fundamentals + candidateAndLocal + (nationalShift * governorStateElasticity(race)) + demographicPull.adjustment + candidateHistory + financeSignal + pollMargin + primaryPollSignal;
  const expertRating = race.rating;
  const expertRatingAdjustment = softGovernorRatingAdjustment(rawMargin, expertRating);
  const margin = governorMarginGuardrail(race, expertRatingAdjustment.margin, fundamentals, directGovernorPoll);
  const error = governorRaceError(race, fundamentals, Boolean(governorPoll?.polls));
  const demProbability = clamp(normalCdf(margin, 0, error), 0.001, 0.999);
  const winnerParty = demProbability >= .5 ? "D" : "R";
  const modelRating = ratingFromProbability(demProbability, margin);
  return {
    ...race,
    displayName: `${STATE_NAMES[race.state]} Governor`,
    demCandidate: race.dem,
    repCandidate: race.rep,
    margin: Number(margin.toFixed(2)),
    error: Number(error.toFixed(2)),
    fundamentalsMargin: Number(fundamentals.toFixed(2)),
    rating: modelRating,
    structuralMargin: Number(fundamentals.toFixed(2)),
    candidateAndLocal: Number(candidateAndLocal.toFixed(2)),
    electorateComposition,
    demographicPull,
    sourceInputs: {
      financeSignal,
      finance: raceFec,
      nationalFinance,
      candidateHistory,
      pollMargin,
      pollCount: governorPoll?.polls || 0,
      pollSources: governorPoll?.sources || [],
      pollSourceUrls: governorPoll?.sourceUrls || [],
      pollMatchups: governorPoll?.matchups || [],
      pollEntries: governorPoll?.pollEntries || [],
      pollReducedWeight: Boolean(governorPoll?.reducedWeight),
      pollWeightScale: governorPoll?.weightScale || 1,
      primaryPollSignal,
      primaryPollCount: 0,
      primaryPollSources: [],
      primaryPollSourceUrls: [],
      primaryPollMatchups: [],
      expertRating,
      expertRatingAdjustment
    },
    modelRating,
    demProbability: Number(demProbability.toFixed(5)),
    repProbability: Number((1 - demProbability).toFixed(5)),
    winnerParty,
    winnerProbability: Number(Math.max(demProbability, 1 - demProbability).toFixed(5)),
    competitive: demProbability > 0.25 && demProbability < 0.75
  };
}

function governorStateElasticity(race) {
  const traits = STATE_COALITION_TRAITS[race.state] || [];
  let elasticity = .72;
  if (Math.abs(race.pvi) < 5) elasticity += .18;
  if (traits.includes("suburban") || traits.includes("sunbelt")) elasticity += .08;
  if (traits.includes("rural") || traits.includes("frontier")) elasticity -= .08;
  if (race.status.includes("Incumbent")) elasticity -= .08;
  return clamp(elasticity, .5, 1.02);
}

function governorMarginGuardrail(race, rawMargin, fundamentals, governorPoll) {
  const anchor = fundamentals;
  const anchorWeight = governorPoll?.polls ? .08 : .18;
  let margin = rawMargin * (1 - anchorWeight) + anchor * anchorWeight;
  const structuralSide = Math.sign(fundamentals);
  if (structuralSide && Math.sign(margin) !== structuralSide && Math.abs(fundamentals) >= 9 && !governorPoll?.polls) {
    margin = structuralSide * Math.max(4.5, Math.abs(margin) * .55);
  }
  margin = applyDeepStateGovernorFloor(race, margin, governorPoll);
  return Number(margin.toFixed(3));
}

function applyDeepStateGovernorFloor(race, margin, governorPoll) {
  if (governorPoll?.polls) return margin;
  const structuralSide = Math.sign((race.pvi * .34) + (race.lastMargin * .18) + statusEffect(race));
  if (!structuralSide) return margin;
  const pviSide = Math.sign(race.pvi || 0);
  const lastSide = Math.sign(race.lastMargin || 0);
  const sameSidePvi = pviSide === structuralSide ? Math.abs(race.pvi) : 0;
  const sameSideLast = lastSide === structuralSide ? Math.abs(race.lastMargin) : 0;
  if (sameSidePvi < 8 && sameSideLast < 12) return margin;
  const floor = 12.6 + Math.min(5.6, sameSidePvi * .4) + Math.min(2.6, sameSideLast * .08);
  if (structuralSide > 0 && margin < floor) return floor;
  if (structuralSide < 0 && margin > -floor) return -floor;
  return margin;
}

function appendHistory(forecast) {
  const key = forecast.modelDate;
  const point = { date: key, demGovernors: forecast.medianDemGovernors, repGovernors: forecast.medianRepGovernors };
  return mergeHistoryPoints(
    governorHistoryArchive?.governorCountHistory,
    previousForecast?.governorCountHistory,
    [point]
  )
    .filter((item) => item.date <= key)
    .slice(-365);
}

function governorMovementDrivers(race) {
  const previousRace = previousForecast?.races?.find((item) => item.state === race.state);
  if (!previousRace) return [{ label: "First saved run", detail: "No previous generated race file to compare." }];
  const drivers = [];
  const addDriver = (label, value, detail) => {
    if (!Number.isFinite(value) || Math.abs(value) < .05) return;
    drivers.push({ label, change: Number(value.toFixed(2)), detail });
  };
  addDriver("Polling", (race.sourceInputs?.pollMargin ?? 0) - (previousRace.sourceInputs?.pollMargin ?? 0), "Weighted governor polling margin changed.");
  addDriver("Projected margin", race.margin - previousRace.margin, "Combined governor model margin changed.");
  addDriver("Finance", (race.sourceInputs?.financeSignal ?? 0) - (previousRace.sourceInputs?.financeSignal ?? 0), "State campaign-finance signal changed.");
  addDriver("Generic ballot", (race.sourceInputs?.nationalFinance ?? 0) - (previousRace.sourceInputs?.nationalFinance ?? 0), "Shared national environment changed.");
  addDriver("Demographic pull", (race.demographicPull?.adjustment ?? 0) - (previousRace.demographicPull?.adjustment ?? 0), "Candidate coalition profile changed.");
  if (race.rating !== previousRace.rating) drivers.push({ label: "Rating", change: null, detail: `${previousRace.rating} to ${race.rating}` });
  return drivers
    .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
    .slice(0, 5);
}

function buildRaceHistory(race, key) {
  const current = { date: key, dem: race.demProbability, rep: race.repProbability };
  const previousRace = previousForecast?.races?.find((item) => item.state === race.state);
  return mergeHistoryPoints(
    governorHistoryArchive?.stateHistory?.[race.state],
    previousForecast?.stateHistory?.[race.state],
    previousRace?.history,
    [current]
  )
    .filter((point) => point.date <= key)
    .slice(-180);
}

function probabilityMovement(history) {
  if (!Array.isArray(history) || history.length < 2) {
    return { sinceLastRun: 0, sinceWeek: 0, previousDate: null, weekDate: null };
  }
  const latest = history.at(-1);
  const previous = history.at(-2);
  const latestDate = new Date(`${latest.date}T00:00:00Z`);
  const weekCutoff = new Date(latestDate);
  weekCutoff.setUTCDate(weekCutoff.getUTCDate() - 7);
  const weekPoint = [...history].reverse().find((point) => new Date(`${point.date}T00:00:00Z`) <= weekCutoff) || history[0];
  return {
    sinceLastRun: Number(((latest.dem - previous.dem) * 100).toFixed(1)),
    sinceWeek: Number(((latest.dem - weekPoint.dem) * 100).toFixed(1)),
    previousDate: previous.date,
    weekDate: weekPoint.date
  };
}

async function buildForecast() {
  const sourceData = await fetchAllSources();
  const modelDate = localDateKey();
  const senateSignals = readSenateSignals();
  const nationalShift = clamp(senateSignals.genericBallotMargin * 0.18, -1.8, 1.8);
  const modeledRaces = GOVERNOR_RACES.map((race) => buildRace(race, nationalShift, sourceData));
  const distribution = {};
  const decisive = Object.fromEntries(modeledRaces.map((race) => [race.state, 0]));
  const demCounts = [];
  let demWinningRaceTotal = 0;
  let repWinningRaceTotal = 0;
  let demCountTotal = 0;
  let repCountTotal = 0;

  for (let simulation = 0; simulation < SETTINGS.simulations; simulation += 1) {
    let demGovernors = SETTINGS.demNotUp;
    const sampled = [];
    for (const race of modeledRaces) {
      // Use the same uncertainty inputs as the displayed race probability.
      // Calling this without fundamentals produced NaN samples, which then
      // recorded every simulated contest as a Republican win.
      const calculatedError = governorRaceError(
        race,
        race.fundamentalsMargin ?? race.structuralMargin ?? 0,
        Boolean(race.sourceInputs?.pollCount)
      );
      const error = Number.isFinite(calculatedError) ? calculatedError : 9.4;
      const sampledMargin = sampleNormal(race.margin, error);
      const demWin = sampledMargin > 0;
      if (demWin) demGovernors += 1;
      sampled.push({ state: race.state, demWin, distance: Math.abs(sampledMargin) });
    }
    demCounts.push(demGovernors);
    distribution[demGovernors] = (distribution[demGovernors] || 0) + 1;
    const closest = sampled.sort((a, b) => a.distance - b.distance)[0];
    if (closest) decisive[closest.state] += 1;
  }

  demCounts.sort((a, b) => a - b);
  for (const race of modeledRaces) {
    if (race.demProbability >= .5) demWinningRaceTotal += 1;
    else repWinningRaceTotal += 1;
    race.tippingPower = Number((decisive[race.state] / SETTINGS.simulations).toFixed(5));
    race.movementDrivers = governorMovementDrivers(race);
    race.history = buildRaceHistory(race, modelDate);
    race.movement = probabilityMovement(race.history);
  }
  for (const [count, simulations] of Object.entries(distribution)) {
    demCountTotal += Number(count) * simulations;
    repCountTotal += (50 - Number(count)) * simulations;
  }

  const medianDemGovernors = demCounts[Math.floor(demCounts.length / 2)];
  const forecast = {
    model: "2026 gubernatorial forecast",
    modelDate,
    generatedAt: new Date().toISOString(),
    runDate: localRunDateLabel(),
    settings: SETTINGS,
    sourceSummary: {
      genericBallotMargin: senateSignals.genericBallotMargin,
      gubernatorialNationalShift: Number(nationalShift.toFixed(2)),
      approvalNet: senateSignals.approvalNet,
      dataSources: sourceData.status,
      nationalFinance: sourceData.governorFinance?.__national || null,
      governorPolling: sourceData.governorPolling || null,
      financeNote: "Gubernatorial finance is state-regulated. The model checks configured official state portals for competitive races and uses normalized state-level finance records when machine-readable totals are available. Federal FEC data is not treated as a governor finance source."
    },
    modelWarnings: forecastSanityWarnings(modeledRaces, {
      model: "governor",
      id: (race) => race.state,
      name: (race) => race.displayName,
      baseline: (race) => race.structuralMargin,
      partisanship: (race) => race.pvi,
      candidateAdjustment: (race) => race.candidateAndLocal
    }),
    projectedDemRaceWins: demWinningRaceTotal,
    projectedRepRaceWins: repWinningRaceTotal,
    averageDemGovernors: Number((demCountTotal / SETTINGS.simulations).toFixed(2)),
    averageRepGovernors: Number((repCountTotal / SETTINGS.simulations).toFixed(2)),
    medianDemGovernors,
    medianRepGovernors: 50 - medianDemGovernors,
    distribution,
    stateHistory: Object.fromEntries(modeledRaces.map((race) => [race.state, race.history])),
    races: modeledRaces.sort((a, b) => STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]))
  };
  forecast.governorCountHistory = appendHistory(forecast);
  return forecast;
}

async function writeForecast() {
  const forecast = await buildForecast();
  writeFileSync(FORECAST_URL, JSON.stringify(forecast, null, 2), "utf8");
  writeFileSync(GOVERNOR_HISTORY_URL, JSON.stringify({
    updatedAt: forecast.generatedAt,
    modelDate: forecast.modelDate,
    stateHistory: forecast.stateHistory,
    governorCountHistory: forecast.governorCountHistory
  }, null, 2), "utf8");
  console.log(`Wrote gubernatorial forecast for ${forecast.races.length} races`);
  console.log(`Data sources status:`, Object.keys(forecast.sourceSummary.dataSources || {}).join(", "));
}

writeForecast().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error("Error generating forecast:", error);
  process.exit(1);
});
