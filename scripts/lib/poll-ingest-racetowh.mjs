import { pathToFileURL } from "node:url";
import { validatePollRow } from "./poll-validation.mjs";
import { fetchText, htmlToLines, normalizeDistrictId, normalizeOffice, parsePollDate, writeMergedPollingCache } from "./poll-ingest-common.mjs";

const URLS = [
  "https://www.racetothewh.com/senate-polls",
  "https://www.racetothewh.com/governor-polls",
  "https://www.racetothewh.com/allpolls",
  "https://www.racetothewh.com/house-3"
];

function parseRaceContext(line) {
  const state = line.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i)?.[1]?.toUpperCase();
  const district = line.match(/\b(?:US\s*)?House\s*(?:District)?\s*(AL|\d{1,2})\b/i)?.[1] || line.match(/\b([A-Z]{2})-(AL|\d{1,2})\b/i)?.[2];
  const office = normalizeOffice(line);
  return { state, district, office };
}

export function parseRaceToWHPolls(html, sourceUrl = "") {
  const lines = htmlToLines(html);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const context = parseRaceContext(lines[index]);
    if (!context.state || !context.office) continue;
    const window = lines.slice(index, index + 22).join(" ");
    const spread = window.match(/([A-Za-z.'-]+)\s*(?:leads|ahead|over|\+)\s*(?:by\s*)?(\d+(?:\.\d+)?)/i);
    if (!spread) continue;
    const endDate = parsePollDate(lines, index);
    if (!endDate) continue;
    const sampleMatch = window.match(/([\d,]+)\s*(?:LV|RV|likely voters|registered voters|voters)/i);
    const districtId = context.office === "house" ? normalizeDistrictId(context.state, context.district) : null;
    rows.push({
      office: context.office,
      state: context.state,
      district: districtId,
      raceId: districtId ? `${districtId}-2026` : `${context.state}-${context.office === "governor" ? "GOV" : "SEN"}-2026`,
      source: "Race to the WH",
      sourceKey: "racetowh",
      sourceUrl,
      sourceTrust: "TRUSTED_SEMI_STRUCTURED",
      tableType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
      pollster: lines[index + 1] || "Race to the WH listed poll",
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

export async function updateRaceToWHPollingCache() {
  const rows = [];
  const fetches = [];
  for (const url of URLS) {
    try {
      const response = await fetchText(url);
      fetches.push({ url, ok: response.ok, status: response.status });
      if (response.ok) rows.push(...parseRaceToWHPolls(response.text, url));
    } catch (error) {
      fetches.push({ url, ok: false, status: "FETCH_FAILED", error: error.message });
    }
  }
  const byOffice = Object.groupBy(rows, (row) => row.office);
  const outputs = {};
  for (const office of ["senate", "governor", "house"]) {
    outputs[office] = writeMergedPollingCache(office, byOffice[office] || [], "racetowh", { fetches });
  }
  return { rows: rows.length, fetches, outputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await updateRaceToWHPollingCache();
  console.log(JSON.stringify({ status: "OK", source: "racetowh", rows: result.rows, fetches: result.fetches }, null, 2));
}
