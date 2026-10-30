/** NBC Firecracker schema adapter. Only explicitly verified source mappings are fetched.
 * Provider contract: fetchResults(catalogue) -> normalized race[]. Throws on invalid data.
 * A projection flag has NO authority unless its exact meaning has been verified in the source manifest.
 */
import { genericName, matchBallotCandidate } from './candidate-roster.mjs';
export function percent(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error("Invalid percentage");
  return n;
}
function timestamp(value) {
  if (!value) return null;
  if (!Number.isFinite(Date.parse(value)))
    throw new Error("Invalid provider timestamp");
  return new Date(value).toISOString();
}
function candidate(raw) {
  const name =
    raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(" ");
  const votes = Number(raw.votes ?? 0);
  if (genericName(name) || !Number.isSafeInteger(votes) || votes < 0)
    throw new Error("Invalid NBC candidate");
  const party = String(raw.party || "").toUpperCase();
  const partyCode =
    {
      DEM: "D",
      GOP: "R",
      REP: "R",
      IND: "I",
      LIB: "L",
      GRN: "G",
      DEMOCRATIC: "D",
      REPUBLICAN: "R",
      NPA: "NP",
      NOP: "NP",
      'NO PARTY': 'NP',
    }[party] || party;
  return {
    id: String(raw.candidateId ?? raw.id ?? name),
    name,
    ...(Array.isArray(raw.partyLabels)?{partyLabels:raw.partyLabels.filter(p=>typeof p==='string').slice(0,8)}:{}),
    party: partyCode,
    partyCode,
    votes,
    percent: percent(raw.percentVote),
    incumbent: raw.isIncumbent === true,
    isWinner: false,
    winner: false,
  };
}
export function parseNbcResults(data, source, catalogue, {onInvalid}={}) {
  if (!data || !Array.isArray(data.races) || !data.races.length)
    throw new Error("NBC races array missing or empty");
  if(onInvalid){
    const rows=[];
    for(const mapping of source.races||[]){
      try{rows.push(...parseNbcResults(data,{...source,races:[mapping]},catalogue));}
      catch(error){onInvalid({race:mapping.feaRaceId,reason:error.message});}
    }
    if(!rows.length)throw Error('No healthy mapped NBC races');
    return rows;
  }
  const rows = [];
  for (const mapping of source.races || []) {
    const local = catalogue.find((r) => r.id === mapping.feaRaceId);
    if (!local) throw new Error(`Unknown FEA mapping: ${mapping.feaRaceId}`);
    const raw = data.races.find(
      (r) =>
        String(r.summary?.raceId ?? r.raceId ?? r.id) ===
        String(mapping.providerRaceId),
    );
    if (
      !raw?.summary ||
      !Array.isArray(raw.summary.candidates) ||
      !raw.summary.candidates.length
    )
      throw new Error(`NBC mapped race missing: ${mapping.feaRaceId}`);
    const summary = raw.summary;
    if (
      String(raw.electionDate || data.electionDate || "").slice(0, 10) !==
      "2026-11-03"
    )
      throw new Error("NBC feed is not the 2026 general election");
    if (data.stateAbbr !== local.state)
      throw new Error("NBC state mismatch or missing state");
    const office = String(summary.officeName || "").toLowerCase();
    if (
      !(local.type === "house"
        ? office.includes("house")
        : office.includes(local.type))
    )
      throw new Error("NBC office mismatch or missing office");
    if (local.type === "house") {
      const district = (value) =>
        /^(AL|0|AT.LARGE)$/i.test(String(value)) ? "AL" : String(Number(value));
      if (district(summary.district) !== district(local.district))
        throw new Error("NBC district mismatch");
    }
    const normalizeCandidate=raw=>matchBallotCandidate(candidate(raw),local.candidates);
    const candidates = summary.candidates.map(normalizeCandidate);
    if (
      new Set(candidates.map((c) => c.id)).size !== candidates.length ||
      new Set(candidates.map((c) => c.name)).size !== candidates.length
    )
      throw new Error("Duplicate NBC candidates");
    if(local.rosterReviewed && local.candidates.some(c=>!candidates.some(k=>k.name===c.name)))
      throw Error('Provider roster incomplete; reviewed candidates missing: '+local.candidates.filter(c=>!candidates.some(k=>k.name===c.name)).map(c=>c.name).join(', '));
    const total = candidates.reduce((n, c) => n + c.votes, 0);
    for (const c of candidates)
      if (c.percent === null) c.percent = total ? (c.votes / total) * 100 : 0;
    // isWinner in an AP object is not automatically an NBC Decision Desk projection.
    const field =
      source.projection?.verified === true
        ? source.projection.candidateFlag
        : null;
    if (field && !["isWinner", "winner"].includes(field))
      throw new Error("Unsupported projection field");
    if(field&&!summary.candidates.every(c=>typeof c[field]==='boolean'))
      throw Error('Verified projection state missing; absent flags cannot retract a public call');
    const winners = field
      ? summary.candidates.filter((c) => c[field] === true)
      : [];
    if (winners.length > 1)
      throw new Error("Ambiguous single-winner projection");
    const updatedAt = timestamp(
      raw.lastUpdated || data.lastUpdated || data.updatedAt || data.currentTime,
    );
    rows.push({
      ...local,
      provider: "NBC",
      source: "NBC News",
      sourceUrl: source.url,
      providerRaceId: String(mapping.providerRaceId),
      electionDate: "2026-11-03",
      candidateStatus: "Candidate roster via NBC.",
      candidates,
      expectedVotePercent: percent(summary.percentIn),
      estimatedVoteReporting: percent(summary.percentIn),
      reportingPercent: percent(summary.precinctsReportingPercent),
      percentReporting: percent(summary.precinctsReportingPercent),
      lastUpdated: updatedAt,
      updatedAt,
      status: "uncalled",
      providerCall: winners.length
        ? {
            provider: "NBC",
            raceId: local.id,
            providerRaceId: String(mapping.providerRaceId),
            candidate: normalizeCandidate(winners[0]).name,
            status: "projected",
            providerTimestamp: timestamp(summary.callTimestamp),
          }
        : null,
      counties: (raw.areas || []).map((a) => ({
        name: String(a.name || ""),
        type: a.areaType || "County",
        fips: /^(?:\d{5}|\d{10})$/.test(String(a.fips || a.geoid || "")) ? String(a.fips || a.geoid) : "",
        estimatedVoteReporting: percent(a.percentIn),
        percentReporting: percent(a.precinctsReportingPercent),
        candidates: (a.candidates || []).map(normalizeCandidate),
      })),
    });
  }
  if (!rows.length) throw new Error("No explicit NBC race mappings configured");
  return rows;
}
export class NbcProvider {
  constructor({ sources = [], fetchImpl = fetch, timeoutMs = 12000 } = {}) {
    Object.assign(this, { sources, fetchImpl, timeoutMs });
    this.httpCache = new Map();
    this.httpCacheBytes = 0;
  }
  async fetchResults(catalogue) {
    this.quarantined=[];
    if (!this.sources.length)
      throw new Error(
        "No verified NBC 2026 general-election source configured",
      );
    const rows = [];
    const mappings=this.sources.flatMap(source=>source.races||[]).map(m=>m.feaRaceId);
    if(new Set(mappings).size!==mappings.length)throw Error('Duplicate source mappings');
    // Validate the complete manifest before issuing any request.
    for (const source of this.sources) {
      const url = new URL(source.url);
      let observedApplication=false;
      try{const page=new URL(source.discovery?.pageUrl);observedApplication=source.discovery?.method==='NBC_2026_GENERAL_APP_AND_SCHEMA_V1'&&page.protocol==='https:'&&['www.nbcnews.com','nbcnews.com'].includes(page.hostname)&&!page.username&&!page.password&&!page.port&&/^[a-f0-9]{64}$/.test(source.discovery.mappingFingerprint||'')&&Number.isFinite(Date.parse(source.discovery.verifiedAt));}catch{}
      if (
        source.status !== "CONFIRMED" ||
        source.election !== "2026-general" ||
        url.protocol !== "https:" ||
        url.hostname !== "www.nbcnews.com" ||
        url.port || url.username || url.password ||
        !url.pathname.startsWith("/firecracker/")&&!observedApplication
      )
        throw new Error(
          "Source must be a verified public NBC general-election feed",
        );
    }
    const readSource=async source=>{
      const url=new URL(source.url);
      const cached = this.httpCache.get(url.href);
      try {
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        headers: { Accept: "application/json",
          ...(cached?.etag ? {"If-None-Match":cached.etag} : {}),
          ...(cached?.modified ? {"If-Modified-Since":cached.modified} : {}) },
      });
      if (!response.ok && response.status !== 304)
        throw new Error(`NBC connection failed: HTTP ${response.status}`);
      if(response.status === 304 && !cached) throw new Error("NBC 304 without a validated cached response");
      const body = response.status === 304 ? cached.body : await response.text();
      if (body.length > 20000000) throw new Error("NBC payload exceeds limit");
      rows.push(...parseNbcResults(JSON.parse(body), source, catalogue,{onInvalid:issue=>this.quarantined.push(issue)}));
      if(response.status !== 304 && Buffer.byteLength(body)<=16*1024*1024) {
        if(cached)this.httpCacheBytes-=Buffer.byteLength(cached.body);
        this.httpCache.delete(url.href);
        this.httpCache.set(url.href, {body,etag:response.headers?.get("etag"),modified:response.headers?.get("last-modified")});
        this.httpCacheBytes+=Buffer.byteLength(body);
        while(this.httpCacheBytes>32*1024*1024 || this.httpCache.size>128){const oldest=this.httpCache.keys().next().value;this.httpCacheBytes-=Buffer.byteLength(this.httpCache.get(oldest).body);this.httpCache.delete(oldest);}
      }
      } catch(error) {
        // A failing state endpoint must not stall healthy states or clear their votes.
        for(const mapping of source.races || [])if(!this.quarantined.some(i=>i.race===mapping.feaRaceId))this.quarantined.push({race:mapping.feaRaceId,reason:error.message});
      }
    };
    // A few slow states should not serially delay the entire national poll.
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(8,this.sources.length)},async()=>{
      while(cursor<this.sources.length)await readSource(this.sources[cursor++]);
    }));
    this.quarantined.sort((a,b)=>String(a.race).localeCompare(String(b.race)));
    if(!rows.length)throw Error(this.quarantined[0]?.reason || 'No healthy mapped NBC races');
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error("Duplicate source mappings");
    const order=new Map(catalogue.map((r,i)=>[r.id,i]));
    return rows.sort((a,b)=>order.get(a.id)-order.get(b.id));
  }
}
