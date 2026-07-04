import { pathToFileURL } from "node:url";
import { validatePollRow } from "./poll-validation.mjs";
import { fetchText, htmlToLines, normalizeDistrictId, normalizeOffice, parsePollDate, writeMergedPollingCache } from "./poll-ingest-common.mjs";

const URLS = [
  "https://www.270towin.com/2026-senate-election/polls/",
  "https://www.270towin.com/2026-governor-election/polls/",
  "https://www.270towin.com/2026-house-election/polls/"
];

function parseHeading(line) {
  const state = line.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i)?.[1]?.toUpperCase();
  const district = line.match(/\b(?:US\s*)?House\s*(?:District)?\s*(AL|\d{1,2})\b/i)?.[1];
  const office = normalizeOffice(line);
  return { state, district, office };
}

export function parse270toWinPolls(html, sourceUrl = "") {
  const lines = htmlToLines(html);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseHeading(lines[index]);
    if (!heading.state || !heading.office) continue;
    const window = lines.slice(index, index + 18).join(" ");
    const spread = window.match(/([A-Za-z.'-]+)\s*\+\s*(\d+(?:\.\d+)?)/);
    if (!spread) continue;
    const endDate = parsePollDate(lines, index);
    if (!endDate) continue;
    const sampleMatch = window.match(/([\d,]+)\s*(?:LV|RV|likely voters|registered voters|voters)/i);
    const districtId = heading.office === "house" ? normalizeDistrictId(heading.state, heading.district) : null;
    rows.push({
      office: heading.office,
      state: heading.state,
      district: districtId,
      raceId: districtId ? `${districtId}-2026` : `${heading.state}-${heading.office === "governor" ? "GOV" : "SEN"}-2026`,
      source: "270toWin",
      sourceKey: "270towin",
      sourceUrl,
      sourceTrust: "TRUSTED_SEMI_STRUCTURED",
      tableType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
      pollster: lines[index + 1] || "270toWin listed poll",
      endDate,
      sampleSize: sampleMatch ? Number(sampleMatch[1].replace(/,/g, "")) : null,
      population: /\bLV\b|likely voters/i.test(window) ? "lv" : /\bRV\b|registered voters/i.test(window) ? "rv" : "a",
      result: spread[0],
      margin: Number(spread[2]),
      candidates: [
        { name: spread[1], pct: null },
        { name: "Opponent", pct: null }
      ]
    });
  }
  return rows
    .map((row) => validatePollRow(row, {
      office: row.office,
      state: row.state,
      source: row.source,
      sourceKey: row.sourceKey,
      requireTableType: true,
      requireStartDate: false,
      allowSpreadOnly: true
    }))
    .filter((row) => row.usedInModel);
}

export async function update270toWinPollingCache() {
  const rows = [];
  const fetches = [];
  for (const url of URLS) {
    try {
      const response = await fetchText(url);
      fetches.push({ url, ok: response.ok, status: response.status });
      if (response.ok) rows.push(...parse270toWinPolls(response.text, url));
    } catch (error) {
      fetches.push({ url, ok: false, status: "FETCH_FAILED", error: error.message });
    }
  }
  const byOffice = Object.groupBy(rows, (row) => row.office);
  const outputs = {};
  for (const office of ["senate", "governor", "house"]) {
    outputs[office] = writeMergedPollingCache(office, byOffice[office] || [], "270towin", { fetches });
  }
  return { rows: rows.length, fetches, outputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await update270toWinPollingCache();
  console.log(JSON.stringify({ status: "OK", source: "270towin", rows: result.rows, fetches: result.fetches }, null, 2));
}
