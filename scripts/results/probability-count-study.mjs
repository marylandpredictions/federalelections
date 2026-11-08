import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseDelimited} from './csv.mjs';
import {matchBallotCandidate} from './candidate-roster.mjs';

const archiveSha256='45111cd664cbadf16ca7571ff5ecc9ef396bae3c7c55b33c25ffab21ae6f51b6';
const mean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
const finiteMargin=n=>Number.isFinite(n)&&Math.abs(n)<=1;
const electionDates={2020:'2020-11-03',2022:'2022-11-08',2024:'2024-11-05'};
const hourAt=(at,cycle)=>(Date.parse(at)-Date.parse(electionDates[cycle]+'T23:00:00Z'))/3600000;
const valid=row=>Number.isFinite(row.hour)&&row.hour>=0&&row.hour<336&&finiteMargin(row.margin);
const band=hour=>hour<5?'first-five-hours':hour<13?'through-next-morning':
  hour<49?'through-second-night':hour<120?'days-three-to-five':'days-six-to-fourteen';
const excluded=new Set(['AK','GA','ME','LA','VT']);
const sha256=body=>createHash('sha256').update(body).digest('hex');

// Sample an observed change from each comparable historical race. Time and
// current margin are observable before the outcome, even without a county feed
// or a provider's turnout estimate. Each race contributes only one residual.
export function countOnlyEstimate(observed,training,{maxHourGap}={}) {
  if (!valid(observed) || !['house','senate'].includes(observed.office))
    throw Error('Missing or unsupported live-count checkpoint');
  const nearest=new Map();
  for (const row of training) {
    if (row.office!==observed.office || !valid(row) || !finiteMargin(row.finalMargin)) continue;
    const outsideWindow=maxHourGap===undefined
      ?observed.hour<49?row.hour>=49:band(row.hour)!==band(observed.hour)
      :Math.abs(row.hour-observed.hour)>maxHourGap;
    if (outsideWindow) continue;
    const timeDistance=Math.log1p(row.hour)-Math.log1p(observed.hour);
    const distance=(timeDistance/.45)**2+((row.margin-observed.margin)/.20)**2;
    if (distance<(nearest.get(row.id)?.distance??Infinity)) nearest.set(row.id,{row,distance});
  }
  const draws=[...nearest.values()].map(({row,distance})=>({
    weight:Math.exp(-distance/2),margin:Math.max(-1,Math.min(1,observed.margin+row.finalMargin-row.margin)),
  })).sort((a,b)=>a.margin-b.margin);
  const weight=draws.reduce((sum,draw)=>sum+draw.weight,0);
  const effective=weight**2/draws.reduce((sum,draw)=>sum+draw.weight**2,0);
  if (!(effective>=6 && weight>=2)) return null;
  const empirical=draws.reduce((sum,draw)=>sum+draw.weight*(draw.margin>0?1:draw.margin===0?.5:0),0)/weight;
  const quantile=q=>{
    let cumulative=0;
    return draws.find(draw=>(cumulative+=draw.weight)>=q*weight).margin;
  };
  return {p:(empirical*effective+.5)/(effective+1),effective,median:quantile(.5),interval80:[quantile(.1),quantile(.9)]};
}

export function finalResults(rows,office,year='2020',{requirePair=true}={}) {
  const results=new Map();
  for (const row of rows) {
    const regularRound=/^false$/i.test(row.runoff??'false')||
      year==='2018'&&row.state_po==='CA'&&row.runoff==='NA';
    if (row.year!==year||!/^gen$/i.test(row.stage)||!/^false$/i.test(row.special)||
        !/^false$/i.test(row.unofficial)||!/^total$/i.test(row.mode)||!regularRound) continue;
    if (excluded.has(row.state_po) ||
        /^(?:OVER|UNDER|BLANK)\s*VOTES?$/i.test(row.candidate)) continue;
    const id=row.state_po+'-'+(office==='house'?'G-H-'+Number(row.district):'G-S');
    const contest=results.get(id)||{d:0,r:0,others:0,dc:0,rc:0,total:Number(row.totalvotes),ballot:[]};
    const votes=Number(row.candidatevotes);
    if (!row.candidatevotes||!Number.isSafeInteger(votes)||votes<0||contest.total!==Number(row.totalvotes)) {
      contest.invalid=true;
    } else {
      const party=row.party_simplified||row.party;
      contest.ballot.push({name:row.candidate,votes});
      if (party==='DEMOCRAT') {contest.d+=votes;contest.dc++;contest.democrat=row.candidate;}
      else if (party==='REPUBLICAN') {contest.r+=votes;contest.rc++;contest.republican=row.candidate;}
      else contest.others+=votes;
    }
    results.set(id,contest);
  }
  return new Map([...results].filter(([,r])=>!r.invalid&&r.d+r.r+r.others===r.total&&
    (!requirePair||r.dc===1&&r.rc===1&&r.d!==r.r&&Math.max(r.d,r.r)>r.others)));
}

export function readApCheckpoints(progress,metadata,at,truth,{fullRoster=false,statewidePair=false}={}) {
  const checked=[];
  for (const [key,entry] of Object.entries(progress)) {
    const race=metadata[key];
    const office={H:'house',S:'senate',...(statewidePair?{G:'governor'}:{})}[race?.officeID],state=race?.statePostal;
    const district=Number(race?.seatNum);
    if (!office||statewidePair&&office==='house'||!state||excluded.has(state)||race.electionDate!==electionDates[2024]||
        race.eventID!=='20241105'||race.raceTypeID!=='G'||race.rankedChoice||race.runoff||
        race.raceID!==key||entry.raceID!==key||state!==entry.statePostal||entry.test!==false||
        entry.resultsType!=='live'||entry.level!=='state'||
        (office==='house'&&(!Number.isInteger(district)||district<1||district>52))||
        !(Date.parse(entry.pollClosingTime)<=Date.parse(entry.lastUpdated)&&Date.parse(entry.lastUpdated)<=Date.parse(at))) continue;
    const id=state+'-G-'+race.officeID+(office==='house'?'-'+district:''),final=truth.get(id);
    const total=entry.parameters?.vote?.total,candidates=entry.candidates;
    if (!final||!Number.isSafeInteger(total)||total<=0||total>=final.total||!Array.isArray(candidates)||
        new Set(candidates.map(c=>c.candidateID)).size!==candidates.length||
        candidates.some(c=>!Number.isSafeInteger(c.voteCount)||c.voteCount<0||!race.candidates?.[c.candidateID])||
        candidates.reduce((sum,c)=>sum+c.voteCount,0)!==total) continue;
    const match=(party,name)=>{
      const rows=candidates.filter(c=>race.candidates[c.candidateID].party===party);
      if (rows.length!==1) return null;
      const details=race.candidates[rows[0].candidateID];
      try {
        matchBallotCandidate({name:[details.first,details.last,details.suffix].filter(Boolean).join(' ')},[{name}]);
      } catch { return null; }
      return rows[0].voteCount;
    };
    const d=fullRoster||statewidePair?null:match('Dem',final.democrat),r=fullRoster||statewidePair?null:match('GOP',final.republican);
    if (!fullRoster&&!statewidePair&&(d===null||r===null||d<=0||r<=0||d>final.d||r>final.r)) continue;
    const roster=fullRoster?matchFullRoster(candidates,race.candidates,final.ballot):null;
    if (fullRoster&&!roster) continue;
    const pair=statewidePair?matchStatewidePair(candidates,race.candidates,final):null;
    if (statewidePair&&!pair) continue;
    // Use the frame's observation time. Its update timestamp only proves
    // availability and is not when we know the full frame was captured.
    checked.push({id,state,office,hour:hourAt(at,2024),updatedAt:entry.lastUpdated,total,
      ...(pair?{...pair,expected:entry.parameters?.vote?.expected?.actual}:
        roster?{roster,expected:entry.parameters?.vote?.expected?.actual}:
        {margin:(d-r)/total,finalMargin:(final.d-final.r)/final.total}),});
  }
  const counts=new Map();
  for (const row of checked) counts.set(row.id,(counts.get(row.id)||0)+1);
  return checked.filter(row=>counts.get(row.id)===1);
}

function matchStatewidePair(counts,metadata,final) {
  const pair={finalD:final.d,finalR:final.r,finalTotal:final.total};
  for (const [role,party] of [['d','DEM'],['r','GOP']]) {
    const options=counts.filter(row=>metadata[row.candidateID].party?.toUpperCase()===party);
    if (options.length!==1) return null;
    const {candidateID,voteCount}=options[0],details=metadata[candidateID];
    const name=[details.first,details.last,details.suffix].filter(Boolean).join(' ');
    const certified=role==='d'?final.democrat:final.republican;
    try { matchBallotCandidate({name},[{name:certified,aliases:final.aliases?.[role]}]); }
    catch { return null; }
    if (voteCount<=0||voteCount>final[role]) return null;
    pair[role]=voteCount;
  }
  return pair;
}

function matchFullRoster(counts,metadata,ballot) {
  if (!ballot?.length||Object.keys(metadata).length!==counts.length) return null;
  const seen=new Set(),roster=[];
  for (const {candidateID,voteCount} of counts) {
    const details=metadata[candidateID];
    const name=[details.first,details.last,details.suffix].filter(Boolean).join(' ');
    let match;
    try { match=matchBallotCandidate({name},ballot); }
    catch { return null; }
    if (seen.has(match.name)) return null;
    const actual=ballot.find(row=>row.name===match.name).votes;
    if (voteCount>actual) return null;
    seen.add(match.name);
    const party=details.party?.toUpperCase();
    roster.push({id:candidateID,votes:voteCount,actual,
      ...(party==='DEM'?{party:'D'}:party==='GOP'?{party:'R'}:{})});
  }
  if (ballot.some(row=>row.votes>0&&!seen.has(row.name))) return null;
  return roster;
}

async function readApHoldout(manifestPath,captureDirectory,truth,options) {
  const manifest=JSON.parse((await readFile(manifestPath,'utf8')).replace(/^\uFEFF/,''));
  const byCount=new Map();
  for (const frame of manifest) {
    if (!/^[a-f0-9]{40}$/.test(frame.commit)||!Number.isFinite(Date.parse(frame.at))) throw Error('Invalid AP archive manifest');
    const inputs=await Promise.all(['progress','metadata'].map(async name=>{
      const file=await readFile(join(captureDirectory,'probability-ap2024-'+frame.commit+'-'+name+'.json'));
      if (sha256(file)!==frame[name+'Hash']) throw Error('AP '+name+' checksum mismatch');
      return JSON.parse(file);
    }));
    for (const row of readApCheckpoints(...inputs,frame.at,truth,options)) {
      const key=JSON.stringify([row.id,row.updatedAt,row.total,row.margin,row.expected,row.d,row.r,row.roster?.map(c=>c.votes)]);
      if (!byCount.has(key)||row.hour<byCount.get(key).hour) byCount.set(key,row);
    }
  }
  return [...byCount.values()];
}

export async function readApFullRosterStudy(manifestPath,captureDirectory) {
  const [house,senate]=await Promise.all([
    readFile('data/baselines/source/1976-2024-house.tab','utf8'),
    readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),
  ]);
  const truth=new Map([
    ...finalResults(parseDelimited(house),'house','2024',{requirePair:false}),
    ...finalResults(parseDelimited(senate,'\t'),'senate','2024',{requirePair:false}),
  ]);
  return readApHoldout(manifestPath,captureDirectory,truth,{fullRoster:true});
}

export function readNyt2022Ballots(payload,truth,{statewidePair=false,requireExpected=!statewidePair}={}) {
  if (payload?.races?.length!==1) return [];
  const [race]=payload.races;
  const office={H:'house',S:'senate',G:'governor'}[race.office_id],state=race.top_reporting_unit?.state_postal;
  const district=Number(race.seat_number);
  if (!office||statewidePair&&office==='house'||!state||excluded.has(state)||race.election_date!=='2022-11-08'||race.type!=='General'||
      race.race_type_id!=='G'||race.max_winners!==1||race.rcv_nyt_ids?.length||
      (office==='house'&&(!Number.isInteger(district)||district<1||district>52))) return [];
  const id=state+'-G-'+race.office_id+(office==='house'?'-'+district:'');
  const final=truth.get(id),series=payload.timeseries?.[race.nyt_id];
  if (race.nyt_id!==id+'-2022-11-08'||!final||!Array.isArray(series)) return [];
  const closing=payload.pollClosingTimes?.filter(row=>row.reporting_unit?.state_postal===state)??[];
  if (!closing.length || closing.some(row=>!Number.isFinite(Date.parse(row.poll_closing_time)))) return [];
  const pollClose=Math.max(...closing.map(row=>Date.parse(row.poll_closing_time)));
  const metadata=Object.fromEntries(Object.entries(race.candidate_metadata??{}).map(([id,row])=>
    [id,{first:row.first_name,last:row.last_name,suffix:row.suffix,party:row.party?.nyt_id}]));
  const records=new Map(),conflicts=new Set();
  for (const entry of series) {
    const at=entry.provider_updated_at,estimate=entry.nyt_vote_estimate?.total_expected_vote;
    const expected=Number.isSafeInteger(estimate)&&estimate>0?estimate:null;
    if (!(Date.parse(at)>=pollClose)||!Number.isSafeInteger(entry.total_votes)||
        entry.total_votes<=0||entry.total_votes>=final.total||
        requireExpected&&expected===null||!Array.isArray(entry.candidates)) continue;
    const counts=entry.candidates.map(row=>({candidateID:row.nyt_id,voteCount:row.votes?.total}));
    if (new Set(counts.map(c=>c.candidateID)).size!==counts.length||
        counts.some(c=>!metadata[c.candidateID]||!Number.isSafeInteger(c.voteCount)||c.voteCount<0)||
        counts.reduce((sum,c)=>sum+c.voteCount,0)!==entry.total_votes) continue;
    const result=statewidePair?matchStatewidePair(counts,metadata,final):
      {roster:matchFullRoster(counts,metadata,final.ballot)};
    if (statewidePair?!result:!result.roster) continue;
    const row={id,state,office,hour:hourAt(at,2022),expected,total:entry.total_votes,...result,updatedAt:at};
    const prior=records.get(at);
    if (prior && JSON.stringify(prior)!==JSON.stringify(row)) conflicts.add(at);
    records.set(at,row);
  }
  return [...records].filter(([at])=>!conflicts.has(at)).map(([,row])=>row);
}

export async function readNyt2022FullRosterStudy(manifestPath,captureDirectory,options) {
  const [house,senate,governor]=await Promise.all([
    readFile('data/baselines/source/1976-2024-house.tab','utf8'),
    readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),
    readFile('data/results/comparisons/governor-last-states.json','utf8'),
  ]);
  const truth=new Map([
    ...finalResults(parseDelimited(house),'house','2022',{requirePair:false}),
    ...finalResults(parseDelimited(senate,'\t'),'senate','2022',{requirePair:false}),
  ]);
  for (const row of JSON.parse(governor).states) if (row.year===2022&&row.valid&&
      /^https:\/\/(?:[^/]+\.gov|[^/]+\.state\.[a-z]{2}\.us)\//i.test(row.sourceUrl)) {
    const ballot=row.candidates.map(candidate=>({name:candidate.name.split(/\s+\/\s+|\s+and\s+/i)[0],votes:candidate.votes}));
    if (ballot.reduce((sum,row)=>sum+row.votes,0)===row.totalVotes)
      truth.set(row.state+'-G-G',{total:row.totalVotes,ballot});
  }
  return readNyt2022Holdout(manifestPath,captureDirectory,truth,options);
}

async function readNyt2022Holdout(manifestPath,captureDirectory,truth,options) {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),points=[];
  for (const entry of manifest) {
    if (options?.statewidePair&&entry.office==='house') continue;
    if (!/^probability-nyt2022-results-[a-z0-9-]+\.json$/.test(entry.file)||
        entry.source!=='https://static01.nyt.com/elections-assets/2022/data/2022-11-08/'+entry.file.slice('probability-nyt2022-'.length))
      throw Error('Invalid NYT time-series manifest');
    const raw=await readFile(join(captureDirectory,entry.file));
    if (sha256(raw)!==entry.sha256) throw Error('NYT time-series checksum mismatch: '+entry.file);
    points.push(...readNyt2022Ballots(JSON.parse(raw),truth,options));
  }
  return points;
}

export async function readStatewidePairStudy(apManifest,nytManifest,captureDirectory,governorControls) {
  const senate=parseDelimited(await readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),'\t');
  const truth=year=>new Map([...finalResults(senate,'senate',String(year)),
    ...governorControls.filter(row=>row.year===year).map(row=>[row.state+'-G-G',row])]);
  const options={statewidePair:true};
  return Promise.all([
    readNyt2022Holdout(nytManifest,captureDirectory,truth(2022),options),
    readApHoldout(apManifest,captureDirectory,truth(2024),options),
  ]);
}

export async function readNyt2020StatewidePairs(manifestPath,captureDirectory,governorControls) {
  const senate=parseDelimited(await readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),'\t');
  const truth=new Map([...finalResults(senate,'senate'),
    ...governorControls.filter(row=>row.year===2020).map(row=>[row.state+'-G-G',row])]);
  const rows=[];
  for await (const payload of readNyt2020Files(manifestPath,captureDirectory)) for (const race of payload.data.races) {
    const office={S:'senate',G:'governor'}[race.officeid],state=race.state_id;
    const id=state+'-G-'+race.officeid,final=truth.get(id);
    if (!office||!final||excluded.has(state)||race.election_type!=='general'||race.election_date!=='2020-11-03'||
        race.race_id!==id+'-2020-11-03'||race.runoff||race.uncontested||
        !Array.isArray(race.candidates)||!Array.isArray(race.timeseries)) continue;
    const identity=(party,name,aliases)=>{
      const options=race.candidates.filter(candidate=>candidate.party_id===party);
      if (options.length!==1) return null;
      try { matchBallotCandidate({name:options[0].name_display},[{name,aliases}]); }
      catch { return null; }
      return options[0].candidate_key;
    };
    const d=identity('democrat',final.democrat,final.aliases?.d);
    const r=identity('republican',final.republican,final.aliases?.r);
    if (!d||!r||d===r) continue;
    const records=new Map(),conflicts=new Set();
    for (const point of race.timeseries) {
      const at=point.timestamp,total=point.votes,dShare=point.vote_shares?.[d],rShare=point.vote_shares?.[r];
      if (!(Date.parse(at)>=Date.parse(race.poll_time))||!Number.isSafeInteger(total)||total<=0||total>=final.total||
          !(dShare>0&&rShare>0&&dShare+rShare<=1.001)||
          total*(dShare-.0005)>final.d||total*(rShare-.0005)>final.r) continue;
      const row={id,state,office,hour:hourAt(at,2020),total,dShare,rShare,finalD:final.d,finalR:final.r,finalTotal:final.total};
      const previous=records.get(at);
      if (previous&&JSON.stringify(previous)!==JSON.stringify(row)) conflicts.add(at);
      records.set(at,row);
    }
    rows.push(...[...records].filter(([at])=>!conflicts.has(at)).map(([,row])=>row));
  }
  return rows;
}

async function* readNyt2020Files(manifestPath,captureDirectory) {
  for (const entry of JSON.parse(await readFile(manifestPath,'utf8'))) {
    if (!/^probability-nyt2020-[a-z-]+\.json$/.test(entry.file)||
        entry.source!=='https://static01.nyt.com/elections-assets/2020/data/api/2020-11-03/state-page/'+entry.file.slice('probability-nyt2020-'.length))
      throw Error('Invalid NYT 2020 manifest');
    const raw=await readFile(join(captureDirectory,entry.file));
    if (sha256(raw)!==entry.sha256) throw Error('NYT 2020 checksum mismatch: '+entry.file);
    yield JSON.parse(raw);
  }
}

export async function readNyt2020HouseStudy(manifestPath,captureDirectory) {
  const house=await readFile('data/baselines/source/1976-2024-house.tab','utf8');
  const truth=finalResults(parseDelimited(house),'house');
  const points=[];
  for await (const payload of readNyt2020Files(manifestPath,captureDirectory)) {
    for (const race of payload.data.races) {
      if (race.officeid!=='H'||race.election_type!=='general'||race.election_date!=='2020-11-03'||
          excluded.has(race.state_id)||race.runoff||race.uncontested||
          !Array.isArray(race.candidates)||!Array.isArray(race.timeseries)) continue;
      const id=race.state_id+'-G-H-'+Number(race.seat),final=truth.get(id);
      if (!final||race.race_id!==id+'-2020-11-03'||!Number.isFinite(Date.parse(race.poll_time))) continue;
      const metadata=Object.fromEntries(race.candidates.map(row=>[row.candidate_key,
        {first:row.first_name,last:row.last_name,party:row.party_id==='democrat'?'DEM':
          row.party_id==='republican'?'GOP':undefined}]));
      const identity=matchFullRoster(Object.keys(metadata).map(candidateID=>({candidateID,voteCount:0})),metadata,final.ballot);
      if (!identity) continue;
      const records=new Map(),conflicts=new Set();
      for (const entry of race.timeseries) {
        if (entry.eevp_source!=='edison'||!(entry.eevp>0&&entry.eevp<=100)||
            !Number.isSafeInteger(entry.votes)||entry.votes<=0||entry.votes>=final.total||
            !(Date.parse(entry.timestamp)>=Date.parse(race.poll_time))||
            Object.keys(entry.vote_shares??{}).length!==identity.length) continue;
        const roster=identity.map(({id,actual,party})=>({id,actual,party,share:entry.vote_shares[id]}));
        if (roster.some(row=>!Number.isFinite(row.share)||row.share<0||row.share>1||
            entry.votes*(row.share-.0005)>row.actual)||
            Math.abs(roster.reduce((sum,row)=>sum+row.share,0)-1)>.0005*roster.length+1e-10) continue;
        const row={id,state:race.state_id,office:'house',hour:hourAt(entry.timestamp,2020),
          reportedShare:entry.eevp/100,reportedVotes:entry.votes,roster};
        const old=records.get(entry.timestamp);
        if (old&&JSON.stringify(old)!==JSON.stringify(row)) conflicts.add(entry.timestamp);
        records.set(entry.timestamp,row);
      }
      points.push(...[...records].filter(([at])=>!conflicts.has(at)).map(([,row])=>row));
    }
  }
  return points;
}

function archiveCheckpoints(rows,truth) {
  const points=new Map(),conflicts=new Set();
  for (const row of rows) {
    const race=row.race_id?.replace(/G-H-0*(\d+)$/,'G-H-$1');
    const id=row.state+'-'+race,final=truth.get(id);
    if (!final || !row.timestamp || !row.votes2020 || !row.vf_dem || !row.vf_rep) continue;
    const total=Number(row.votes2020),d=Number(row.vf_dem),r=Number(row.vf_rep);
    if (!Number.isSafeInteger(total)||total<=0||total>=final.total||d<=0||r<=0||d+r>1.001||
        // Rounded historical shares are checked with half a unit of precision.
        total*(d-.0005)>final.d||total*(r-.0005)>final.r) continue;
    const key=id+'|'+row.timestamp,point={id,state:row.state,office:race==='G-S'?'senate':'house',
      hour:hourAt(row.timestamp,2020),margin:d-r,finalMargin:(final.d-final.r)/final.total,total};
    const old=points.get(key);
    if (old && (old.margin!==point.margin||old.total!==total)) conflicts.add(key);
    points.set(key,point);
  }
  return [...points].filter(([key,row])=>valid(row)&&!conflicts.has(key)).map(([,row])=>row);
}

function firstCheckpoints(rows) {
  const byRaceAndBand=new Map();
  for (const row of rows.filter(valid).sort((a,b)=>a.hour-b.hour)) {
    const key=row.id+'|'+band(row.hour);
    if (!byRaceAndBand.has(key)) byRaceAndBand.set(key,row);
  }
  return [...byRaceAndBand.values()];
}

// Stronger comparison: learn how confident the observed margin should make
// us, separately by office and time window, using training races only.
const logistic=value=>1/(1+Math.exp(-value));
function fitCountedMargin(rows) {
  const groups=new Map();
  for (const row of firstCheckpoints(rows)) {
    const key=row.office+'|'+band(row.hour),group=groups.get(key)||[];
    group.push(row);
    groups.set(key,group);
  }
  return new Map([...groups].map(([key,group])=>{
    let best={loss:Infinity,slope:0};
    for (const slope of [0,1,2,4,8,12,16,24,32,48,64,96,128,192,256]) {
      const loss=mean(group.map(row=>Math.log1p(Math.exp(-slope*row.margin*Math.sign(row.finalMargin)))));
      if (loss<best.loss) best={slope,loss};
    }
    return [key,best.slope];
  }));
}

function score(rows,trainingFor,mixtureWeights) {
  const groups=new Map(),baselines=new Map();
  for (const row of firstCheckpoints(rows)) {
    const key=band(row.hour),group=groups.get(key)||{opportunities:0,scored:[]};
    group.opportunities++;
    const training=trainingFor(row);
    const estimate=countOnlyEstimate(row,training);
    if (estimate) {
      const actual=Number(row.finalMargin>0);
      const leader= row.margin===0?.5:row.margin>0?.9:.1;
      if (!baselines.has(training)) baselines.set(training,fitCountedMargin(training));
      const slope=baselines.get(training).get(row.office+'|'+key)??0;
      const calibrated=logistic(slope*row.margin);
      group.scored.push({id:row.id,state:row.state,p:estimate.p,calibrated,actual,brier:(estimate.p-actual)**2,
        logLoss:-Math.log(actual?estimate.p:1-estimate.p),leaderBrier:(leader-actual)**2,
        leaderLogLoss:-Math.log(actual?leader:1-leader),
        calibratedLeaderBrier:(calibrated-actual)**2,
        calibratedLeaderLogLoss:Math.log1p(Math.exp(-slope*row.margin*(actual?1:-1))),
        marginError:Math.abs(estimate.median-row.finalMargin),
        rawMarginError:Math.abs(row.margin-row.finalMargin),
        close:Math.abs(row.margin)<=.10,
        covered80:Number(row.finalMargin>=estimate.interval80[0]&&row.finalMargin<=estimate.interval80[1])});
    }
    groups.set(key,group);
  }
  const metrics=scored=>scored.length?Object.fromEntries(['brier','logLoss','leaderBrier','leaderLogLoss',
    'calibratedLeaderBrier','calibratedLeaderLogLoss','marginError','rawMarginError','covered80']
    .map(metric=>[metric,mean(scored.map(row=>row[metric]))])):null;
  const sensitivity=scored=>{
    const states=new Set(scored.map(row=>row.state));
    if (states.size<2) return null;
    const differences=[...states].map(state=>mean(scored.filter(row=>row.state!==state)
      .map(row=>row.brier-row.calibratedLeaderBrier)));
    return [Math.min(...differences),Math.max(...differences)];
  };
  const reliability=(scored,method)=>{
    const bins=new Map();
    for (const row of scored) {
      const probability=row[method],key=Math.min(9,Math.floor(probability*10)),group=bins.get(key)||[];
      group.push(row);
      bins.set(key,group);
    }
    return [...bins].sort(([a],[b])=>a-b).map(([bin,group])=>({
      bin,n:group.length,predicted:mean(group.map(row=>row[method])),actual:mean(group.map(row=>row.actual)),
    }));
  };
  const mixedScores=(scored,weight)=>{
    if (!scored.length) return null;
    const outcomes=scored.map(({p,calibrated,actual})=>{
      const blended=weight*p+(1-weight)*calibrated;
      const assigned=Math.max(Number.EPSILON,actual?blended:1-blended);
      return {brier:(blended-actual)**2,logLoss:-Math.log(assigned)};
    });
    return {brier:mean(outcomes.map(row=>row.brier)),logLoss:mean(outcomes.map(row=>row.logLoss))};
  };
  return Object.fromEntries([...groups].map(([key,{opportunities,scored}])=>{
    const close=scored.filter(row=>row.close);
    // Derive the blend only from predictions made with the target state
    // excluded. Freeze it before applying it to the other election cycles.
    const weight=mixtureWeights?.[key]??(mixtureWeights||!scored.length?null:
      [0,.25,.5,.75,1].map(weight=>({weight,loss:mixedScores(scored,weight).logLoss}))
        .sort((a,b)=>a.loss-b.loss)[0].weight);
    return [key,{opportunities,races:scored.length,scores:metrics(scored),
      brierDifferenceLeavingOneStateOut:sensitivity(scored),
      reliability:{analog:reliability(scored,'p'),countedMargin:reliability(scored,'calibrated')},
      closeCount:{races:close.length,scores:metrics(close)},
      ...(weight===null?{}:{combination:{weightOnAnalog:weight,
        status:mixtureWeights?'out-of-cycle':'weight-fitting',
        scores:mixedScores(scored,weight),closeScores:mixedScores(close,weight)}}),
      ...(scored.length&&scored.length<=20?{forecasts:scored.map(({id,p,actual})=>({id,p,actual}))}:{}),
    }];
  }));
}

export async function runCountOnlyStudy(archivePath,holdoutPath,apManifestPath,captureDirectory) {
  const [archive,holdout,house,senate]=await Promise.all([
    readFile(archivePath),readFile(holdoutPath,'utf8'),
    readFile('data/baselines/source/1976-2024-house.tab','utf8'),
    readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),
  ]);
  if (sha256(archive)!==archiveSha256) throw Error('2020 archive checksum mismatch');
  const officialHouse=parseDelimited(house),officialSenate=parseDelimited(senate,'\t');
  const truth=new Map([...finalResults(officialHouse,'house'),...finalResults(officialSenate,'senate')]);
  const checkpoints=archiveCheckpoints(parseDelimited(archive.toString('utf8')),truth);
  const separate=JSON.parse(holdout);
  const external=['midtermStress','midtermSecond','holdout','redirectedHoldout','lateHoldout']
    .flatMap(key=>separate[key].rows).flatMap(row=>{
      const cycle=row.id.slice(0,4),state=row.id.slice(5,7).toUpperCase();
      if (!['2022','2024'].includes(cycle)||excluded.has(state)||row.d<=0||row.r<=0||
          !(row.d+row.r<=row.reported&&row.finalD>=row.d&&row.finalR>=row.r&&row.reported<row.actual&&
            row.finalD+row.finalR<=row.actual&&Math.max(row.finalD,row.finalR)>row.actual-row.finalD-row.finalR&&
            row.finalD!==row.finalR)) return [];
      return [{id:row.id,cycle,state,office:'senate',hour:hourAt(row.sourceUpdatedAt,cycle),
        margin:(row.d-row.r)/row.reported,finalMargin:(row.finalD-row.finalR)/row.actual}];
    });
  const ap2024=apManifestPath?await readApHoldout(apManifestPath,captureDirectory??dirname(apManifestPath),new Map([
    ...finalResults(officialHouse,'house','2024'),...finalResults(officialSenate,'senate','2024'),
  ])):null;
  const offices=['house','senate'];
  const internal=Object.fromEntries(offices.map(office=>{
      const rows=checkpoints.filter(row=>row.office===office);
      const training=new Map([...new Set(rows.map(row=>row.state))].map(state=>[state,rows.filter(row=>row.state!==state)]));
      return [office,{races:new Set(rows.map(row=>row.id)).size,checkpoints:rows.length,
        leaveStateOut:score(rows,held=>training.get(held.state))}];
  }));
  const mixtureWeights=office=>Object.fromEntries(Object.entries(internal[office].leaveStateOut)
    .filter(([,report])=>report.combination).map(([band,report])=>[band,report.combination.weightOnAnalog]));
  return {status:'research-only',archiveSha256,internal,
    external:Object.fromEntries(['2022','2024'].map(cycle=>
      [cycle,score(external.filter(row=>row.cycle===cycle),()=>checkpoints,mixtureWeights('senate'))])),
    ...(ap2024?{ap2024:Object.fromEntries(offices.map(office=>{
      const rows=ap2024.filter(row=>row.office===office);
      return [office,{races:new Set(rows.map(row=>row.id)).size,checkpoints:rows.length,
        holdout:score(rows,()=>checkpoints,mixtureWeights(office))}];
    }))}:{}),
  };
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]||!process.argv[3]) throw Error('Usage: probability-count-study.mjs <2020-count-archive.csv> <turnout-study.json> [2024-ap-manifest.json] [capture-directory]');
  console.log(JSON.stringify(await runCountOnlyStudy(...process.argv.slice(2)),null,2));
}
