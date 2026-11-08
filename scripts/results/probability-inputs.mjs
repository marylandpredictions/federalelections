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
const districtWorkbooks={
  OH:{districts:15,counties:88,source:'https://docs.google.com/spreadsheets/d/13Eo-aFP037lDWPJ9gWgB3ak_P3ROB4R9i_mnnDOXWM4/edit'},
  TX:{districts:38,counties:254,source:'https://docs.google.com/spreadsheets/d/10OEwH1xjBSlzdjH2v8EoGxtZxAwg50G2CPQvi4P8ovQ/edit',splitBallots:true},
};
// Some publisher labels refer to a borough or an election authority
// within a Census county. Keep these source partitions distinct while
// aggregating their votes to the county's FIPS code.
const workbookCountyAliases={
  NY:{NYC_BX:'Bronx',NYC_BK:'Kings',NYC_MN:'New York',NYC_QN:'Queens',NYC_SI:'Richmond'},
  IL:{CookChicago:'Cook',CookSuburban:'Cook','St. ClairEastStLouis':'St. Clair',
    VermilionDanville:'Vermilion',WinnebagoRockford:'Winnebago'},
};
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

export function probabilityGeographyBasis(geography,{allowSingleReportingUnit=false}={}) {
  const rows=geography.countyReferences, reference=geography.reference;
  if (!reference || rows.length<(allowSingleReportingUnit?1:2)) return null;
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

function districtCounties(state,csv,countyRows,districtRows,workbook=districtWorkbooks[state],partial=false) {
  const countyKey=value=>value?.replace(/\s*\(pt\.\)\s*$/i,'').toUpperCase().replace(/[\s.'’-]+/g,'');
  const fipsByName=new Map(countyRows.map(row=>[countyKey(row.county),row.fips]));
  requireInput(fipsByName.size===workbook.counties,'Ambiguous or incomplete county index for '+state);
  const rowsByDistrict=new Map(), countyPortions=new Map(), splitRows=new Set(), baseRows=new Set(), rejected=new Map();
  let section='base';
  for (const row of parseDelimited(csv)) {
    if (/^Split (?:Counties|County|Parishes)$/.test(row.ShortName?.trim()) && !row.CD && !row.County && !row.Total) continue;
    if ((workbook.splitBallots || partial) && !row.CD && !row.Total) {
      if (row.ShortName==='Split E/A/P Votes' && section==='base') {section='split';continue;}
      if ((row.County==='Total E/A/P Votes'||row.ShortName==='Total E/A/P Votes') && section==='split') {section='control';continue;}
    }
    // Some state workbooks put county-only control rows after the split
    // district rows without a separate heading. They have no district ID.
    if (partial && section==='split' && !row.CD && row.ShortName && row.Total) section='control';
    if (section==='control' && !row.CD) continue; // County control totals, not additional ballots.
    const id=state+'-'+row.CD?.padStart(2,'0');
    const label=row.ShortName || row.County || row.Parish || row.Island;
    const alias=partial && Object.hasOwn(workbookCountyAliases[state] || {},label) && workbookCountyAliases[state][label];
    const fips=fipsByName.get(countyKey(alias || label));
    const key=id+':'+fips;
    const sourceKey=alias ? key+':'+label : key;
    requireInput(districtRows.has(id) && section!=='control','Unmapped '+state+' district county portion');
    if (!fips && partial) {rejected.set(id,'Unmapped county: '+(row.ShortName || row.County || row.Parish || row.Island || 'unnamed'));continue;}
    requireInput(fips,'Unmapped '+state+' district county portion');
    const votes=Object.fromEntries(['Harris','Trump','Total'].map((column,i)=>{
      const value=row[column]?.trim().replaceAll(',','');
      return [voteFields[i],/^\d+$/.test(value)?Number(value):NaN];
    }));
    const validCounts=voteFields.every(field=>Number.isSafeInteger(votes[field])) &&
      votes.demVotes+votes.repVotes<=votes.totalVotes;
    if (!validCounts && partial) {rejected.set(id,'Invalid ballot counts for '+fips);continue;}
    if (section==='split') {
      const county=countyPortions.get(key);
      if ((!county || splitRows.has(sourceKey)) && partial) {rejected.set(id,'Unmatched or duplicate split ballot row for '+fips);continue;}
      requireInput(county && !splitRows.has(sourceKey) && validCounts,'Invalid or duplicate split ballot row for '+key);
      splitRows.add(sourceKey);
      for (const field of voteFields) county[field]+=votes[field];
      continue;
    }
    const county={state,fips,valid:true,...votes};
    const precinct=partial && row.Precinct?.trim();
    const baseKey=JSON.stringify([sourceKey,precinct || null,precinct && (row.Town || row.Municipality || null)]);
    if (partial && baseRows.has(baseKey)) {rejected.set(id,'Duplicate source row for '+fips);continue;}
    requireInput(partial || !countyPortions.has(key) && validReference(county),'Invalid or duplicate district county returns for '+key);
    baseRows.add(baseKey);
    if (countyPortions.has(key)) {
      const portion=countyPortions.get(key);
      for (const field of voteFields) portion[field]+=votes[field];
      continue;
    }
    countyPortions.set(key,county);
    const district=rowsByDistrict.get(id)||[];
    district.push(county);
    rowsByDistrict.set(id,district);
  }
  requireInput(partial || rowsByDistrict.size===workbook.districts &&
    new Set([...countyPortions.values()].map(row=>row.fips)).size===workbook.counties &&
    (!workbook.splitBallots || section==='control' && splitRows.size>0),
  state+' workbook does not cover all current districts, counties and ballot sections');
  const sha256=createHash('sha256').update(csv).digest('hex');
  const accepted=new Map();
  for (const [id,reference] of districtRows) {
    if (reference.state!==state) continue;
    const rows=rowsByDistrict.get(id) || [];
    // The published table exports rounded county portions. Require all
    // three sums to agree to within one vote with the district reference.
    const compatible=rows.length && rows.every(validReference) && reconciles(rows,reference,1);
    if (partial && (rejected.has(id) || !compatible)) {
      if (!rejected.has(id)) rejected.set(id,'County totals do not match the district reference or include an empty unit.');
      continue;
    }
    requireInput(compatible,state+' workbook totals do not match verified boundaries for '+id);
    accepted.set(id,{rows,source:workbook.source,sha256,geometryId:reference.geometryId});
  }
  return {accepted,rejected:Object.fromEntries(rejected)};
}

export function readGeographicReferences(root=process.cwd(),{ohioDistrictCsv,texasDistrictCsv,districtTablesDir}={}) {
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
  const districtPortions=new Map(Object.entries({OH:ohioDistrictCsv,TX:texasDistrictCsv})
    .filter(([,csv])=>csv!==undefined).flatMap(([code,csv])=>[...districtCounties(code,csv,counties.get(code),districtRows).accepted]));
  const workbooks={};
  if (districtTablesDir) {
    const index=read('data/results/probability-district-workbooks.json').workbooks;
    for (const [code,spreadsheet] of Object.entries(index)) {
      const targets=[...districtRows.values()].filter(row=>row.state===code);
      if (targets.length<=1) continue;
      try {
        const csv=readFileSync(join(districtTablesDir,code+'.csv'),'utf8');
        const source='https://docs.google.com/spreadsheets/d/'+spreadsheet+'/edit';
        const {accepted,rejected}=districtCounties(code,csv,counties.get(code)||[],districtRows,
          {source,districts:targets.length,counties:counties.get(code)?.length || 0},true);
        for (const [id,rows] of accepted) districtPortions.set(id,rows);
        workbooks[code]={source,accepted:accepted.size,total:targets.length,rejected};
      } catch(error) {
        workbooks[code]={accepted:0,total:targets.length,error:error.code==='ENOENT'?'Table export missing':error.message};
      }
    }
  }
  const officialTexas=read('data/results/probability-texas-official-county-sets.json').districts;
  const countyReferenceIssues=new Map();
  for (const [id,expected] of Object.entries(officialTexas)) {
    const imported=districtPortions.get(id);
    if (!imported) continue;
    const found=new Set(imported.rows.map(row=>row.fips));
    if (expected.length===found.size&&expected.every(fips=>found.has(fips))) continue;
    const reason='Historical county portions do not match the official Texas district county set';
    countyReferenceIssues.set(id,reason);
    districtPortions.delete(id);
    if (workbooks.TX?.rejected) {
      workbooks.TX.accepted--;
      workbooks.TX.rejected[id]=reason;
    }
  }
  const races=catalogue.map(race=>{
    const key=race.type==='house'?districtKey(race):null;
    const reference=key?districtRows.get(key):stateRows.get(race.state);
    const statewide=!key || key.endsWith('-AL');
    const portions=districtPortions.get(key),countyReferenceIssue=countyReferenceIssues.get(key);
    return {raceId:race.id,office:race.type,state:race.state,reference:reference || null,
      rule:probabilityRule(race.id,race.electionDate || race.date),candidateCount:race.candidates.length,
      referenceSource:key?district.sourceUrl:state.sourceUrl,
      countySource:portions?.source || county.sourceUrl,countyReferences:portions?.rows || (statewide?counties.get(race.state)||[]:[]),
      ...(!key && differences.has(race.state)?{countyAggregationDifference:differences.get(race.state)}:{}),
      ...(portions?{districtCountySource:{sha256:portions.sha256,geometryId:portions.geometryId}}:{}),
      ...(countyReferenceIssue?{countyReferenceIssue}:{}),
      geographicScope:statewide?'statewide':'district'};
  });
  return {races,workbooks};
}

// Use historical geography for *relative* differences. An independently
// dated candidate forecast anchors the race's overall expected vote share.
export function buildCountyProbabilityPrior(geography,forecast) {
  const district=geography?.geographicScope==='district' &&
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit$/.test(geography.countySource || '') && geography.reference?.geographyVerified &&
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
export function normalizeProbabilitySnapshot(detail,roster,{at,source,completion={},reportingUnitIds,allowSingleReportingUnit=false}) {
  requireInput(detail?.id && Array.isArray(detail.counties) && detail.counties.length &&
    Number.isFinite(dateTime(at)) && typeof source==='string' && source.trim(),'Missing dated reporting-unit returns');
  requireInput(!(detail.providerBallotAccounting?.ballotsOutsideCandidateTotals>0),
    'Ballots outside ranked-choice candidate totals require a ballot-aware probability model');
  const election=detail.electionDate || detail.date;
  requireInput(Array.isArray(roster)&&roster.length>=2,'At least two named candidates are required by this probability model');
  const candidateIds=roster.map(candidate=>candidate.id);
  requireInput(candidateIds.every(id=>typeof id==='string' && /^[\w-]{1,100}$/.test(id)) &&
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
  const native=detail.reportingUnitScheme!==undefined;
  if(native)requireInput(detail.reportingUnitScheme==='nbc-alaska-state-house-districts'&&
    detail.provider==='NBC'&&detail.state==='AK'&&election==='2026-11-03'&&
    ['house-AK-AL','senate-AK','governor-AK'].includes(detail.id)&&
    Array.isArray(reportingUnitIds)&&[40,41].includes(reportingUnitIds.length)&&new Set(reportingUnitIds).size===reportingUnitIds.length&&
    reportingUnitIds.filter(id=>/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id)).length===40&&
    reportingUnitIds.every(id=>/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id)||id==='AK-OA'),
  'Native reporting-unit scheme does not match the frozen Alaska geography');
  let units=detail.counties.map(unit=>{
    const id=native?unit.id:unit.fips;
    const availableAt=unit.lastUpdated || unit.updatedAt;
    requireInput(typeof id==='string' && (native
      ?((/^AK-HD-(?:0[1-9]|[1-3]\d|40)$/.test(id)&&unit.reportingUnitType==='state-house-district')||
        (id==='AK-OA'&&unit.reportingUnitType==='overseas-absentee'))&&unit.fips===undefined&&unit.source==='NBC News'
      :/^(?:\d{5}|\d{10})$/.test(id)) &&
      dateTime(availableAt)<=dateTime(at),'Missing reporting-unit ID or as-of update');
    const votes=counts(unit.candidates);
    const expected=unit.expectedVotePercent ?? unit.estimatedVoteReporting;
    return {id,availableAt,
      expectedVotePercent:Number.isFinite(expected)&&expected>=0&&expected<=100?expected:null,votes};
  });
  requireInput(new Set(units.map(unit=>unit.id)).size===units.length,'Duplicate reporting units');
  if(reportingUnitIds){
    requireInput(Array.isArray(reportingUnitIds)&&reportingUnitIds.length>=(allowSingleReportingUnit?1:2)&&
      new Set(reportingUnitIds).size===reportingUnitIds.length,'Invalid expected reporting units');
    if(reportingUnitIds.every(id=>/^\d{5}$/.test(id))){
      const groups=new Map();
      for(const unit of units){
        const county=unit.id.slice(0,5),members=groups.get(county)||[];
        requireInput(reportingUnitIds.includes(county),'Reporting unit falls outside the frozen county geography');
        members.push(unit);
        groups.set(county,members);
      }
      units=[...groups].map(([id,members])=>{
        requireInput(members.length===1||members.every(unit=>unit.id.length===10),
          'County totals overlap municipality returns');
        const votes=Object.fromEntries(candidateIds.map(candidate=>[candidate,
          members.reduce((sum,unit)=>sum+unit.votes[candidate],0)]));
        const availableAt=members.reduce((oldest,unit)=>dateTime(unit.availableAt)<dateTime(oldest)?unit.availableAt:oldest,
          members[0].availableAt);
        // A source estimate remains an estimate after aggregation. Zero-vote
        // units cannot supply a turnout denominator through their percentage.
        const estimatedTotal=members.every(unit=>unit.expectedVotePercent>0&&Object.values(unit.votes).some(v=>v>0))
          ?members.reduce((sum,unit)=>sum+Object.values(unit.votes).reduce((n,v)=>n+v,0)/(unit.expectedVotePercent/100),0):null;
        const expectedVotePercent=members.length===1?members[0].expectedVotePercent:
          estimatedTotal?Math.min(100,100*Object.values(votes).reduce((sum,count)=>sum+count,0)/estimatedTotal):null;
        return {id,availableAt,votes,expectedVotePercent};
      });
    }
    requireInput(units.length===reportingUnitIds.length&&units.every(unit=>reportingUnitIds.includes(unit.id)),
      'Reporting units do not cover the frozen geography');
  }
  units=units.map(unit=>{
    const notice=Object.hasOwn(completion,unit.id)?completion[unit.id]:null;
    if(notice)requireInput(notice.raceId===detail.id&&notice.unitId===unit.id&&
      notice.electionDate===election&&dateTime(notice.availableAt)<=dateTime(at)&&
      notice.countedVotes===Object.values(unit.votes).reduce((sum,count)=>sum+count,0)&&
      typeof notice.source==='string'&&notice.source.trim(),'Invalid reporting-unit completion evidence');
    return {...unit,complete:Boolean(notice),...(notice?{completionSource:notice.source}:{})};
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
  const snapshot=normalizeProbabilitySnapshot(detail,roster,{...capture,reportingUnitIds:prior.units?.map(unit=>unit.id)});
  requireInput(snapshot.electionDate===prior.electionDate,'Results are for a different election');
  if (dateTime(snapshot.at)-dateTime(snapshot.sourceUpdatedAt)>maxAgeMs ||
      snapshot.units.some(unit=>!unit.complete && dateTime(snapshot.at)-dateTime(unit.availableAt)>maxAgeMs))
    return {status:'unavailable',reason:'Live race or reporting-unit snapshot is stale'};
  const result=simulateWinProbability(prior,snapshot,{},previousInputHash);
  return result.status==='research'?{...result,providerExpectedVotePercent:snapshot.expectedVotePercent}:result;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [ohio,texas]=process.argv.slice(2);
  const {races,workbooks}=readGeographicReferences(process.cwd(),ohio==='--district-tables'?{districtTablesDir:texas}:{
    ohioDistrictCsv:ohio && ohio!=='-' ? readFileSync(ohio,'utf8') : undefined,
    texasDistrictCsv:texas ? readFileSync(texas,'utf8') : undefined,
  });
  const summary=Object.fromEntries(['house','senate','governor'].map(office=>{
    const rows=races.filter(race=>race.office===office);
    return [office,{races:rows.length,matchedRaceReference:rows.filter(race=>race.reference).length,
      knownNonPluralityRaces:rows.filter(race=>race.rule!=='plurality').map(race=>({id:race.raceId,rule:race.rule})),
      singleCandidateRosters:rows.filter(race=>race.candidateCount===1).map(race=>race.raceId),
      hasCountyReferences:rows.filter(race=>race.countyReferences.length).length,
      reconciledMultiUnitReferences:rows.filter(race=>probabilityGeographyBasis(race)==='all-votes').length,
      additionalTwoPartyReferences:rows.filter(race=>probabilityGeographyBasis(race)==='two-party-votes').length}];
  }));
  const inventory=races.map(race=>({id:race.raceId,office:race.office,rule:race.rule,
    candidates:race.candidateCount,historicalBasis:probabilityGeographyBasis(race),
    reportingUnits:race.countyReferences.length}));
  console.log(JSON.stringify(ohio==='--district-tables'?{...summary,workbooks,races:inventory}:summary,null,2));
}
