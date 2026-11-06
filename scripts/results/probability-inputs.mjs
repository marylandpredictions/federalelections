import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {matchBallotCandidate} from './candidate-roster.mjs';
import {parseDelimited} from './csv.mjs';
import {simulateWinProbability} from './win-probability.mjs';

const validReference = row => row?.valid===true && Number.isSafeInteger(row.totalVotes) &&
  Number.isSafeInteger(row.demVotes) && Number.isSafeInteger(row.repVotes) &&
  row.demVotes>0 && row.repVotes>0 && row.demVotes+row.repVotes<=row.totalVotes;
const districtKey = race => race.state+'-'+(/^(?:0|AL)$/i.test(String(race.district))?'AL':String(race.district).padStart(2,'0'));
const displayParty = candidate => candidate.partyCode || candidate.party;
const dateTime = value => typeof value==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const requireInput = (condition,message) => {if (!condition) throw Error(message);};
const OHIO_WORKBOOK='https://docs.google.com/spreadsheets/d/13Eo-aFP037lDWPJ9gWgB3ak_P3ROB4R9i_mnnDOXWM4/edit';
const voteFields=['demVotes','repVotes','totalVotes'];
const reconciles=(rows,reference,tolerance=0)=>Boolean(reference) &&
  voteFields.every(field=>Math.abs(rows.reduce((sum,row)=>sum+row[field],0)-reference[field])<=tolerance);

// Known exceptions to the regular model's 2026 plurality assumption.
export function probabilityRule(raceId,electionDate) {
  if (electionDate!=='2026-11-03') return null;
  if (/^(?:house|senate|governor)-AK(?:-|$)/.test(raceId) ||
      /^(?:house|senate)-ME(?:-|$)/.test(raceId)) return 'ranked-choice';
  if (/^(?:house|senate|governor)-GA(?:-|$)/.test(raceId) ||
      /^house-LA-/.test(raceId)) return 'majority-runoff';
  if (raceId==='governor-VT') return 'legislative-contingency';
  return 'plurality';
}

export function probabilityGeographyBasis(geography) {
  const rows=geography.countyReferences, reference=geography.reference;
  if (!reference || rows.length<2) return null;
  if (reconciles(rows,reference,geography.districtCountySource?1:0)) return 'all-votes';
  // Statewide FEC controls and published county returns sometimes differ
  // only in the number of other votes. Use two-party geographic weights
  // only when both major-party counts still reconcile exactly.
  const difference=geography.countyAggregationDifference;
  if (geography.geographicScope==='statewide' && difference &&
      voteFields.every(field=>rows.reduce((sum,row)=>sum+row[field],0)-reference[field]===(difference[field] ?? 0)) &&
      !difference.demVotes && !difference.repVotes) return 'two-party-votes';
  return null;
}

export function matchFrozenCandidateCenter(race,forecast,{availableAt,source}) {
  const row=forecast?.row, election=race.electionDate || race.date;
  const cutoff=dateTime(election+'T00:00:00Z');
  requireInput(dateTime(forecast?.generatedAt)<=dateTime(availableAt) && dateTime(availableAt)<cutoff &&
    typeof source==='string' && source.trim(),'Candidate forecast is not frozen before the election');
  requireInput(forecast.office===race.type && row?.state===race.state &&
    (race.type!=='house' || row.id===districtKey(race)) &&
    (race.type!=='senate' || /special/i.test(row.seat)===/special/i.test(race.electionName)),
  'Forecast refers to a different race');
  requireInput(row.matchupStatus==='CONFIRMED_MATCHUP' && Number.isFinite(row.projectedMargin) &&
    Math.abs(row.projectedMargin)<100,'No confirmed candidate margin');
  const roster=race.candidates;
  const find=(name,partyCode)=>matchBallotCandidate({name,partyCode},roster).name;
  const demName=find(row.demCandidate || row.dem,'D');
  const repName=find(row.repCandidate || row.rep,'R');
  requireInput(demName && repName && demName!==repName,'Missing candidate identities');
  return {raceId:race.id,electionDate:election,availableAt,source,demName,repName,
    projectedMargin:row.projectedMargin,twoCandidateRace:roster.length===2};
}

function ohioDistrictCounties(csv,countyRows,districtRows) {
  const fipsByName=new Map(countyRows.map(row=>[row.county.toUpperCase(),row.fips]));
  const rowsByDistrict=new Map();
  const seen=new Set();
  for (const row of parseDelimited(csv)) {
    if (row.ShortName?.trim()==='Split Counties' && !row.CD && !row.County && !row.Total) continue;
    const id='OH-'+row.CD?.padStart(2,'0');
    const fips=fipsByName.get(row.ShortName?.trim().toUpperCase());
    const key=id+':'+fips;
    requireInput(districtRows.has(id) && fips && !seen.has(key),'Unmapped or duplicate Ohio district county portion');
    seen.add(key);
    const votes=Object.fromEntries(['Harris','Trump','Total'].map((column,i)=>{
      const value=row[column]?.trim().replaceAll(',','');
      return [voteFields[i],/^\d+$/.test(value)?Number(value):NaN];
    }));
    const county={state:'OH',fips,valid:true,...votes};
    requireInput(validReference(county),'Invalid Ohio district county returns');
    const district=rowsByDistrict.get(id)||[];
    district.push(county);
    rowsByDistrict.set(id,district);
  }
  requireInput(rowsByDistrict.size===15 && new Set([...rowsByDistrict.values()].flat().map(row=>row.fips)).size===countyRows.length,
    'Ohio workbook does not cover all current districts and counties');
  const sha256=createHash('sha256').update(csv).digest('hex');
  for (const [id,rows] of rowsByDistrict) {
    const reference=districtRows.get(id);
    // The published table exports rounded county portions. Require all
    // three sums to agree to within one vote with the district reference.
    requireInput(reconciles(rows,reference,1),
      'Ohio workbook totals do not match verified boundaries for '+id);
    rowsByDistrict.set(id,{rows,source:OHIO_WORKBOOK,sha256,geometryId:reference.geometryId});
  }
  return rowsByDistrict;
}

export function readGeographicReferences(root=process.cwd(),{ohioDistrictCsv}={}) {
  const read = path => JSON.parse(readFileSync(join(root,path),'utf8'));
  const state=read('data/baselines/pres-2024-states.json');
  const county=read('data/baselines/pres-2024-counties.json');
  const district=read('data/baselines/pres-2024-districts.json');
  const geometry=read('data/results/district-geography.json');
  const catalogue=read('data/election-night-races.json').races;
  const stateRows=new Map(state.states.filter(validReference).map(row=>[row.state,row]));
  const differences=new Map((state.countyAggregationDifferences || []).map(row=>[row.state,row.countyMinusOfficial]));
  const districtRows=new Map(district.districts.filter(validReference).filter(row=>{
    const boundary=geometry.districts[row.id];
    return row.geographyVerified && boundary?.currentComparable && boundary.geometryId===row.geometryId;
  }).map(row=>[row.id,row]));
  const counties=new Map();
  for (const row of county.rows.filter(validReference)) {
    if (!/^\d{5}$/.test(row.fips)) continue;
    const rows=counties.get(row.state)||[];
    rows.push(row);
    counties.set(row.state,rows);
  }
  const ohio=ohioDistrictCsv===undefined?new Map():ohioDistrictCounties(ohioDistrictCsv,counties.get('OH'),districtRows);
  const races=catalogue.map(race=>{
    const key=race.type==='house'?districtKey(race):null;
    const reference=key?districtRows.get(key):stateRows.get(race.state);
    const statewide=!key || key.endsWith('-AL');
    const portions=ohio.get(key);
    return {raceId:race.id,office:race.type,state:race.state,reference:reference || null,
      rule:probabilityRule(race.id,race.electionDate || race.date),candidateCount:race.candidates.length,
      referenceSource:key?district.sourceUrl:state.sourceUrl,
      countySource:portions?.source || county.sourceUrl,countyReferences:portions?.rows || (statewide?counties.get(race.state)||[]:[]),
      ...(!key && differences.has(race.state)?{countyAggregationDifference:differences.get(race.state)}:{}),
      ...(portions?{districtCountySource:{sha256:portions.sha256,geometryId:portions.geometryId}}:{}),
      geographicScope:statewide?'statewide':'district'};
  });
  return {races};
}

// Use historical geography for *relative* differences. An independently
// dated candidate forecast anchors the race's overall expected vote share.
export function buildCountyProbabilityPrior(geography,forecast) {
  const district=geography?.geographicScope==='district' && geography.state==='OH' &&
    geography.countySource===OHIO_WORKBOOK && geography.reference?.geographyVerified &&
    geography.districtCountySource?.geometryId===geography.reference.geometryId &&
    /^[a-f0-9]{64}$/.test(geography.districtCountySource?.sha256 || '');
  requireInput((district || geography?.geographicScope==='statewide') && validReference(geography.reference) &&
    geography.countyReferences?.length>=2 && geography.countySource &&
    forecast?.raceId===geography.raceId && forecast.rule==='plurality' &&
    probabilityRule(geography.raceId,forecast.electionDate)==='plurality','No compatible county baseline');
  requireInput(typeof forecast.source==='string' && forecast.source.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(forecast.electionDate) &&
    dateTime(forecast.availableAt)<dateTime(forecast.electionDate+'T00:00:00Z') &&
    Number.isSafeInteger(forecast.turnout) && forecast.turnout>=geography.countyReferences.length &&
    Number.isFinite(forecast.turnoutLogSd) && forecast.turnoutLogSd>0 && forecast.turnoutLogSd<=1,
  'Missing frozen turnout or forecast provenance');
  const candidates=forecast.candidates;
  const democrats=candidates?.filter(c=>displayParty(c)==='D'), republicans=candidates?.filter(c=>displayParty(c)==='R');
  requireInput(candidates?.length>=2 && candidates.length<=12 && democrats.length===1 && republicans.length===1 &&
    candidates.every(c=>typeof c.id==='string' && /^[\w-]{1,100}$/.test(c.id) && c.share>0 && c.share<1) &&
    new Set(candidates.map(c=>c.id)).size===candidates.length &&
    Math.abs(candidates.reduce((sum,c)=>sum+c.share,0)-1)<1e-6,'County re-centering requires a complete frozen candidate forecast');
  const [dem]=democrats, [rep]=republicans;
  const other=candidates.filter(c=>c!==dem && c!==rep);
  const countyRows=geography.countyReferences;
  const geographyBasis=probabilityGeographyBasis(geography);
  requireInput(new Set(countyRows.map(row=>row.fips)).size===countyRows.length &&
    countyRows.every(row=>validReference(row) && row.state===geography.state &&
      /^[\w-]{1,100}$/.test(forecast.regions?.[row.fips] || '')) &&
    geographyBasis,
  'County references do not fully reconcile to the race geography');
  const geographicVotes=row=>geographyBasis==='two-party-votes'?row.demVotes+row.repVotes:row.totalVotes;
  const historicTotal=countyRows.reduce((sum,row)=>sum+geographicVotes(row),0);
  const allocated=countyRows.map(row=>{
    const amount=forecast.turnout*geographicVotes(row)/historicTotal;
    const profile=forecast.otherUnitShares?.[row.fips];
    const shares=Object.fromEntries(other.map(candidate=>[candidate.id,profile?.[candidate.id]]));
    const majorShare=1-Object.values(shares).reduce((sum,share)=>sum+share,0);
    requireInput(majorShare>0 && Object.values(shares).every(share=>Number.isFinite(share) && share>0),
      'Missing frozen county shares for additional candidates');
    return {row,turnout:Math.floor(amount),fraction:amount%1,logOdds:Math.log(row.demVotes/row.repVotes),shares,majorShare};
  });
  const remaining=forecast.turnout-allocated.reduce((sum,unit)=>sum+unit.turnout,0);
  for (const unit of [...allocated].sort((a,b)=>b.fraction-a.fraction || a.row.fips.localeCompare(b.row.fips)).slice(0,remaining)) unit.turnout++;
  requireInput(allocated.every(unit=>unit.turnout>0),'Expected turnout leaves a unit without a prior');
  requireInput(other.every(candidate=>Math.abs(allocated.reduce((sum,unit)=>sum+unit.turnout*unit.shares[candidate.id],0)/
    forecast.turnout-candidate.share)<1e-6),'Additional candidate county shares do not reconcile to the race forecast');
  const share=(unit,shift)=>unit.majorShare/(1+Math.exp(-unit.logOdds-shift));
  let low=-60, high=60;
  for (let i=0;i<60;i++) {
    const shift=(low+high)/2;
    const statewide=allocated.reduce((sum,unit)=>sum+unit.turnout*share(unit,shift),0)/forecast.turnout;
    if (statewide<dem.share) low=shift;
    else high=shift;
  }
  return {raceId:geography.raceId,office:geography.office,rule:forecast.rule,electionDate:forecast.electionDate,
    availableAt:forecast.availableAt,source:forecast.source+'; geographic reference: '+geography.countySource,
    geographyBasis,
    ...(district?{districtCountySource:geography.districtCountySource}:{}),
    candidateIds:[dem.id,rep.id,...other.map(candidate=>candidate.id)],marginCandidateIds:[dem.id,rep.id],
    units:allocated.map(unit=>{
      const d=share(unit,(low+high)/2);
      requireInput(d>0 && d<unit.majorShare,'The frozen county shares exceed numeric precision');
      return {id:unit.row.fips,region:forecast.regions[unit.row.fips],turnout:unit.turnout,
        turnoutLogSd:forecast.turnoutLogSd,shares:{[dem.id]:d,[rep.id]:unit.majorShare-d,...unit.shares}};
    })};
}

// Expected vote in is an estimate, including at 100%. A separate notice
// with an as-of timestamp is required to mark a reporting unit complete.
export function normalizeProbabilitySnapshot(detail,roster,{at,source,completion={}}) {
  requireInput(detail?.id && Array.isArray(detail.counties) && detail.counties.length &&
    Number.isFinite(dateTime(at)) && typeof source==='string' && source.trim(),'Missing dated reporting-unit returns');
  const election=detail.electionDate || detail.date;
  const candidateIds=roster.map(candidate=>candidate.id);
  requireInput(roster.length>=2 && candidateIds.every(id=>typeof id==='string' && /^[\w-]{1,100}$/.test(id)) &&
    new Set(candidateIds).size===candidateIds.length,'Missing stable race-specific candidate IDs');
  const byName=new Map(roster.map(candidate=>[candidate.name,candidate]));
  requireInput(byName.size===roster.length,'Duplicate names in frozen candidate roster');
  function counts(rows) {
    requireInput(Array.isArray(rows),'Missing candidate returns');
    const seen=new Set();
    const result=Object.fromEntries(rows.map(candidate=>{
      const partyCode=displayParty(candidate);
      requireInput(partyCode && Number.isSafeInteger(candidate.votes) && candidate.votes>=0,'Invalid candidate party or votes');
      const matched=matchBallotCandidate({...candidate,partyCode},roster);
      const id=byName.get(matched.name)?.id;
      requireInput(id && !seen.has(id),'Duplicate or unmatched candidate identity');
      seen.add(id);
      return [id,candidate.votes];
    }));
    const missing=roster.filter(candidate=>!seen.has(candidate.id));
    requireInput(!missing.length,'Candidate count does not match frozen roster; missing: '+missing.map(candidate=>candidate.name).join(', '));
    return result;
  }
  const sourceUpdatedAt=detail.lastUpdated || detail.updatedAt;
  requireInput(election && dateTime(sourceUpdatedAt)<=dateTime(at),'Invalid race date or provider timestamp');
  const units=detail.counties.map(unit=>{
    const id=unit.fips;
    const availableAt=unit.lastUpdated || unit.updatedAt;
    requireInput(typeof id==='string' && /^(?:\d{5}|\d{10})$/.test(id) &&
      dateTime(availableAt)<=dateTime(at),'Missing reporting-unit ID or as-of update');
    const notice=Object.hasOwn(completion,id)?completion[id]:null;
    const votes=counts(unit.candidates);
    if (notice) requireInput(notice.raceId===detail.id && notice.unitId===id &&
      notice.electionDate===election && dateTime(notice.availableAt)<=dateTime(at) &&
      notice.countedVotes===Object.values(votes).reduce((sum,count)=>sum+count,0) &&
      typeof notice.source==='string' && notice.source.trim(),'Invalid reporting-unit completion evidence');
    const expected=unit.expectedVotePercent ?? unit.estimatedVoteReporting;
    return {id,availableAt,complete:Boolean(notice),...(notice?{completionSource:notice.source}:{}),
      expectedVotePercent:Number.isFinite(expected)&&expected>=0&&expected<=100?expected:null,votes};
  });
  const totals=counts(detail.candidates);
  requireInput(new Set(units.map(unit=>unit.id)).size===units.length &&
    candidateIds.every(id=>units.reduce((sum,unit)=>sum+unit.votes[id],0)===totals[id]),
  'Reporting-unit votes do not reconcile to the race');
  const expected=detail.expectedVotePercent ?? detail.estimatedVoteReporting;
  return {raceId:detail.id,electionDate:election,at,sourceUpdatedAt,source,totals,units,
    expectedVotePercent:Number.isFinite(expected)&&expected>=0&&expected<=100?expected:null};
}

export function evaluateRegularProbability(prior,detail,roster,{maxAgeMs,...capture},previousInputHash) {
  requireInput(Number.isSafeInteger(maxAgeMs) && maxAgeMs>0,'Missing live freshness policy');
  if (detail?.provider!=='NBC' || detail.counties?.some(unit=>unit.source!=='NBC News'))
    return {status:'unavailable',reason:'Waiting for NBC race and reporting-unit returns'};
  if (detail?.providerStale===true) return {status:'unavailable',reason:'Provider reports delayed results'};
  const snapshot=normalizeProbabilitySnapshot(detail,roster,capture);
  requireInput(snapshot.electionDate===prior.electionDate,'Results are for a different election');
  if (dateTime(snapshot.at)-dateTime(snapshot.sourceUpdatedAt)>maxAgeMs ||
      snapshot.units.some(unit=>!unit.complete && dateTime(snapshot.at)-dateTime(unit.availableAt)>maxAgeMs))
    return {status:'unavailable',reason:'Live race or reporting-unit snapshot is stale'};
  const result=simulateWinProbability(prior,snapshot,{},previousInputHash);
  return result.status==='research'?{...result,providerExpectedVotePercent:snapshot.expectedVotePercent}:result;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const csv=process.argv[2];
  const {races}=readGeographicReferences(process.cwd(),csv?{ohioDistrictCsv:readFileSync(csv,'utf8')}:{});
  console.log(JSON.stringify(Object.fromEntries(['house','senate','governor'].map(office=>{
    const rows=races.filter(race=>race.office===office);
    return [office,{races:rows.length,matchedRaceReference:rows.filter(race=>race.reference).length,
      knownNonPluralityRaces:rows.filter(race=>race.rule!=='plurality').map(race=>({id:race.raceId,rule:race.rule})),
      singleCandidateRosters:rows.filter(race=>race.candidateCount===1).map(race=>race.raceId),
      hasCountyReferences:rows.filter(race=>race.countyReferences.length).length,
      reconciledMultiUnitReferences:rows.filter(race=>probabilityGeographyBasis(race)==='all-votes').length,
      additionalTwoPartyReferences:rows.filter(race=>probabilityGeographyBasis(race)==='two-party-votes').length}];
  })),null,2));
}
