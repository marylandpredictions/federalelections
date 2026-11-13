// Parse nationwide 2028 primary poll tables from Wikipedia (CC BY-SA).
import {canonicalCandidate, canonicalPollster, displayCandidate} from './primary-sources.mjs';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const WIKI_PAGES = {
  D: 'Nationwide_opinion_polling_for_the_2028_Democratic_Party_presidential_primaries',
  R: 'Nationwide_opinion_polling_for_the_2028_Republican_Party_presidential_primaries',
};

function stripWiki(value) {
  return String(value || '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePct(cell) {
  const cleaned = stripWiki(cell);
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === '–' || cleaned === 'N/A') return null;
  if (/^\*+%?$/.test(cleaned)) return null;
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!match) return null;
  const pct = Number(match[1]);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
}

function parseSample(cell) {
  const cleaned = stripWiki(cell);
  const n = Number((cleaned.match(/(\d[\d,]*)/) || [])[1]?.replace(/,/g, ''));
  const sampleSize = Number.isFinite(n) && n > 0 ? n : null;
  let population = 'a';
  if (/\bLV\b/i.test(cleaned)) population = 'lv';
  else if (/\bRV\b/i.test(cleaned)) population = 'rv';
  else if (/\bV\b/i.test(cleaned)) population = 'v';
  else if (/\bA\b/i.test(cleaned) || /adult/i.test(cleaned)) population = 'a';
  return {sampleSize, population};
}

function toIso(year, month, day) {
  if (!year || !month || !day) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDateRange(cell) {
  const cleaned = stripWiki(cell)
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /election/i.test(cleaned)) return null;

  // October 30 - November 5, 2026
  let m = cleaned.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/,
  );
  if (m) {
    const start = toIso(Number(m[5]), MONTHS[m[1].toLowerCase()], Number(m[2]));
    const end = toIso(Number(m[5]), MONTHS[m[3].toLowerCase()], Number(m[4]));
    return start && end ? {startDate: start, endDate: end} : null;
  }

  // October 24-26, 2026
  m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    const start = toIso(Number(m[4]), month, Number(m[2]));
    const end = toIso(Number(m[4]), month, Number(m[3]));
    return start && end ? {startDate: start, endDate: end} : null;
  }

  // October 24, 2026
  m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (m) {
    const day = toIso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
    return day ? {startDate: day, endDate: day} : null;
  }

  return null;
}

function splitCells(row, marker) {
  // Keep template-internal pipes from breaking cells by first neutralizing {{...}}.
  let safe = row;
  const templates = [];
  safe = safe.replace(/\{\{[\s\S]*?\}\}/g, (block) => {
    templates.push(block);
    return `__T${templates.length - 1}__`;
  });
  const parts = safe
    .split(new RegExp(`\\s*\\${marker}\\s*`))
    .map((part) => part.replace(/__T(\d+)__/g, (_, i) => templates[Number(i)]))
    .map((part) => part.trim());
  // Drop the empty chunk created by a leading | or !.
  if (parts[0] === '') parts.shift();
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const cell = parts[i];
    // "|{{Party shading/...}} |'''28%'''" becomes a shade cell + value cell.
    if (/Party shading/i.test(cell) && !/\d/.test(stripWiki(cell)) && parts[i + 1] != null) {
      out.push(parts[i + 1]);
      i += 1;
      continue;
    }
    out.push(cell);
  }
  return out.filter((cell) => cell != null && String(cell).length);
}

function parseHeaderNames(headerRow) {
  const bang = headerRow.indexOf('!');
  const cells = splitCells(bang >= 0 ? headerRow.slice(bang) : headerRow, '!');
  const names = [];
  for (const cell of cells) {
    const name = stripWiki(cell);
    const key = normalizeLoose(name);
    if (!key) continue;
    if (/pollsource|datesadministered|samplesize|^date$|valign|stylefont|classwikitable/.test(key)) continue;
    if (/^(other|undecided)$/.test(key)) continue;
    const id = canonicalCandidate(name);
    if (!id) continue;
    names.push({raw: name, id});
  }
  return names;
}

function normalizeLoose(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsePollTable(wikitext, party) {
  const tables = [...wikitext.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map((m) => m[0]);
  const out = [];
  for (const table of tables) {
    const rows = table.split(/\n\s*\|-\s*/).slice(1);
    if (!rows.length) continue;
    const header = rows.find((row) => row.includes('!'));
    if (!header) continue;
    const candidateCols = parseHeaderNames(header);
    if (candidateCols.length < 3) continue;

    for (const row of rows) {
      if (row.includes('!') && /Poll source|Date/i.test(row)) continue;
      if (/background:lightyellow|elections held/i.test(row)) continue;
      const cells = splitCells(row, '|');
      if (cells.length < 5) continue;
      const pollsterCell = cells[0];
      const pollster = stripWiki(pollsterCell);
      const dates = parseDateRange(cells[1]);
      const sample = parseSample(cells[2]);
      if (!pollster || !dates) continue;
      if (/aggregator|average|realtime|valign|style=/i.test(pollster)) continue;
      const link = String(pollsterCell).match(/\[(https?:\/\/[^\s\]]+)/);
      const url = link ? link[1] : null;

      // Candidate cells begin after pollster/date/sample and align 1:1 with headers.
      const answerCells = cells.slice(3);
      const answers = [];
      candidateCols.forEach((col, index) => {
        const pct = parsePct(answerCells[index]);
        if (pct == null) return;
        answers.push({
          id: col.id,
          name: displayCandidate(col.raw) || col.raw,
          pct,
        });
      });
      if (answers.length < 2) continue;

      const idKey = `${canonicalPollster(pollster)}-${dates.endDate}-${party}-${answers.slice(0, 3).map((a) => a.id).join('_')}`;
      out.push({
        id: `wikipedia:${idKey}`,
        pollster,
        endDate: dates.endDate,
        startDate: dates.startDate,
        population: sample.population,
        sampleSize: sample.sampleSize,
        partisan: false,
        party,
        subject: party === 'D' ? '2028 Democratic' : '2028 Republican',
        url,
        answers,
        sources: ['wikipedia'],
        sourceIds: [`wikipedia:${idKey}`],
      });
    }
  }
  return out;
}

async function fetchWikiText(title) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', title);
  url.searchParams.set('prop', 'wikitext');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FederalElectionsAnalysis/1.0 (polling averages; local research tool)',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Wikipedia ${title} → ${res.status}`);
  const data = await res.json();
  const text = data?.parse?.wikitext;
  if (!text) throw new Error(`Wikipedia ${title} returned no wikitext`);
  return text;
}

function sectionForYear(wikitext, year = 2026) {
  const start = wikitext.search(new RegExp(`==\\s*${year}\\s*==`));
  if (start < 0) return wikitext;
  const rest = wikitext.slice(start);
  const next = rest.slice(3).search(/\n==\s*\d{4}\s*==/);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

export async function fetchWikipediaPrimaryPolls() {
  const polls = [];
  const reports = [];
  for (const [party, title] of Object.entries(WIKI_PAGES)) {
    const text = await fetchWikiText(title);
    const section = sectionForYear(text, 2026) + '\n' + sectionForYear(text, 2025);
    const rows = parsePollTable(section, party);
    reports.push({party, title, usable: rows.length});
    polls.push(...rows);
  }
  return {polls, reports};
}
