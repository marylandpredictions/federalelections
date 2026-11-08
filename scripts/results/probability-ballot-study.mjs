import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readApFullRosterStudy,readNyt2020HouseStudy,readNyt2022FullRosterStudy} from './probability-count-study.mjs';
import {parseDelimited} from './csv.mjs';
import {parseNbcNational} from './nbc-provider.mjs';
import {probabilityRule} from './probability-inputs.mjs';

const sum=xs=>xs.reduce((total,x)=>total+x,0);
const mean=xs=>sum(xs)/xs.length;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const group=share=>share<.25?'under-25':share<.60?'25-59':share<.90?'60-89':'90-plus';
const maxHours=336;
const hasPair=roster=>['D','R'].every(party=>roster?.filter(candidate=>candidate.party===party).length===1);
const digest=value=>createHash('sha256').update(value).digest('hex');

function observed(row) {
  if (!row||!['house','senate','governor'].includes(row.office)||!Number.isFinite(row.hour)||
      row.hour<0||row.hour>=maxHours||!integer(row.expected)||!row.expected||
      !Array.isArray(row.roster)||row.roster.length<2||row.roster.length>20||
      row.roster.some(candidate=>typeof candidate.id!=='string'||!candidate.id||!integer(candidate.votes))||
      new Set(row.roster.map(candidate=>candidate.id)).size!==row.roster.length) return null;
  const ranked=[...row.roster].sort((a,b)=>b.votes-a.votes||a.id.localeCompare(b.id));
  const total=sum(ranked.map(candidate=>candidate.votes));
  if (!total||!integer(total)||total>row.expected*1.2) return null;
  const share=total/row.expected;
  const gap=(ranked[0].votes-ranked[1].votes)/total;
  return {...row,ranked,total,share,gap};
}

function trainingRow(row) {
  const input=observed(row);
  if (!input||input.ranked.some(candidate=>!integer(candidate.actual)||candidate.actual<candidate.votes)) return null;
  const final=sum(input.ranked.map(candidate=>candidate.actual));
  if (!integer(final)||final<=input.total) return null;
  return {...input,turnoutError:final/input.expected,
    remainingShares:input.ranked.map(candidate=>(candidate.actual-candidate.votes)/(final-input.total))};
}

// Work in candidate count ranks to support full plurality ballots. Draw the
// remaining ballot split and the turnout error together from the same analog.
// Reported votes are never reassigned or rescaled. No inferred reporting stage
// or certified outcome from the target race enters the estimate.
export function estimateFromBallotAnalogs(row,training,coefficient) {
  const target=observed(row);
  if (!target) return null;
  const analogs=new Map();
  for (const input of training) {
    if (input.office!==target.office||input.ranked.length!==target.ranked.length||
        input.id===target.id||input.state===target.state) continue;
    const distance=((input.share-target.share)/.15)**2+((input.gap-target.gap)/.15)**2+
      ((Math.log1p(input.hour)-Math.log1p(target.hour))/.9)**2;
    if (distance<(analogs.get(input.id)?.distance??Infinity)) analogs.set(input.id,{input,distance});
  }
  const draws=[...analogs.values()].map(({input,distance})=>({
    weight:Math.exp(-distance/2),
    expected:target.expected*input.turnoutError,
    votes:input.remainingShares.map((share,i)=>target.ranked[i].votes+
      Math.max(0,target.expected*input.turnoutError-target.total)*share),
  })).filter(draw=>draw.weight>0);
  const weights=sum(draws.map(draw=>draw.weight));
  const effective=weights**2/sum(draws.map(draw=>draw.weight**2));
  if (!(weights>=2&&effective>=6)) return null;
  const wins=target.ranked.map(()=>0);
  const turnoutMass=target.ranked.map(()=>0);
  let expectedFinal=0;
  for (const draw of draws) {
    const maximum=Math.max(...draw.votes);
    const tied=draw.votes.filter(votes=>votes===maximum).length;
    for (let i=0;i<wins.length;i++) if (draw.votes[i]===maximum) wins[i]+=draw.weight/tied;
    if (Number.isFinite(coefficient)) {
      const probability=marginBaseline({...target,expected:draw.expected},coefficient);
      for (let i=0;i<turnoutMass.length;i++) turnoutMass[i]+=draw.weight*probability[i].probability;
    }
    expectedFinal+=draw.weight*sum(draw.votes);
  }
  const candidates=target.ranked.map((candidate,i)=>({id:candidate.id,
    probability:(wins[i]/weights*effective+1/wins.length)/(effective+1)}));
  const turnoutOnly=Number.isFinite(coefficient)?target.ranked.map((candidate,i)=>({
    id:candidate.id,probability:turnoutMass[i]/weights,
  })):null;
  return {effective,expectedFinal:expectedFinal/weights,candidates,turnoutOnly};
}

function firstByStage(rows) {
  const points=new Map();
  for (const row of [...rows].sort((a,b)=>a.hour-b.hour)) {
    const key=row.id+'|'+group(row.share);
    if (!points.has(key)) points.set(key,row);
  }
  return [...points.values()];
}

function winner(row) {
  const [first,second]=[...row.ranked].sort((a,b)=>b.actual-a.actual);
  return first.actual===second.actual?null:first.id;
}

export function marginBaseline(row,coefficient,leanWeight=0,majorWeight=0) {
  const remaining=Math.max(.01*row.expected,row.expected-row.total);
  const contrast=candidate=>row.reportedShare===undefined?candidate.votes-row.ranked[0].votes:
    row.total*(candidate.share-row.ranked[0].share);
  const scores=row.ranked.map(candidate=>coefficient*contrast(candidate)/remaining+
    (candidate.party==='D'?leanWeight*(row.lean??0)+majorWeight:
      candidate.party==='R'?-leanWeight*(row.lean??0)+majorWeight:0));
  const ceiling=Math.max(...scores);
  const mass=scores.map(score=>Math.exp(score-ceiling));
  const total=sum(mass);
  return row.ranked.map((candidate,i)=>({id:candidate.id,probability:mass[i]/total}));
}

function errors(candidates,actual) {
  return {
    brier:sum(candidates.map(candidate=>(candidate.probability-Number(candidate.id===actual))**2)),
    logLoss:-Math.log(Math.max(Number.EPSILON,candidates.find(candidate=>candidate.id===actual).probability)),
  };
}

function fitBaseline(rows) {
  const groups=new Map();
  for (const row of firstByStage(rows)) {
    if (!winner(row)) continue;
    const stage=group(row.share),list=groups.get(stage)||[];
    list.push(row);
    groups.set(stage,list);
  }
  return new Map([...groups].map(([stage,list])=>{
    const options=[0,.25,.5,1,2,4,8,12,16,24].map(coefficient=>({
      coefficient,loss:mean(list.map(row=>errors(marginBaseline(row,coefficient),winner(row)).logLoss)),
    }));
    return [stage,options.sort((a,b)=>a.loss-b.loss)[0].coefficient];
  }));
}

export function fitPrior(rows) {
  const groups=new Map();
  for (const row of firstByStage(rows)) {
    const actual=winner(row);
    if (!actual) continue;
    const stage=group(row.share),list=groups.get(stage)||[];
    list.push({row,actual});
    groups.set(stage,list);
  }
  return new Map([...groups].map(([stage,rows])=>{
    const fit=leads=>{
      let best={params:[0,0,0],loss:Infinity};
      for (const lead of leads) for (const lean of [0,.5,1,2,4]) for (const major of [0,2,4,6]) {
        const loss=mean(rows.map(({row,actual})=>
          errors(marginBaseline(row,lead,lean,major),actual).logLoss))+.002*(lean**2+(major/2)**2);
        if (loss<best.loss) best={params:[lead,lean,major],loss};
      }
      return best.params;
    };
    return [stage,{prior:fit([0]),combined:fit([0,.5,1,2,4,8,12,16])}];
  }));
}

export async function readLean(path) {
  const data=await readFile(path);
  const hash=digest(data);
  if (hash==='04a7d16013302657ea367425c0cda58c5346363e8354470bcb1ba48a2f089d88')
    return {basis:'538-2022-partisan-lean',values:new Map(parseDelimited(data.toString('utf8')).map(row=>[
      row.district.replace('-', '-G-H-'),Number(row['2022'])/10,
    ]))};
  if (hash==='40a174a694dc147cdb3fc423b09f4293b3ed191a0053dcd6f5b9a1d3f80f52a2')
    return {basis:'2020-presidential-margin',values:new Map(parseDelimited(data.toString('utf8')).map(row=>{
      const [state,district]=row.District.split('-');
      return [state+'-G-H-'+(district==='AL'?1:Number(district)),(Number(row.Biden)-Number(row.Trump))/10];
    }))};
  if (hash==='efcae3d7edbe39f0cd1895e4f328d8653e6bdd9eb658e0c9576e425b95d132ac') {
    // The worksheet repeats several candidate headings, so read the four
    // required columns by position and keep the 2020 vote columns out.
    const columns=['district','incumbent','party','biden20','trump20','clinton16','trump16',
      'obama12','romney12','obama08','mccain08'];
    const table=parseDelimited(columns.join(',')+'\n'+data.toString('utf8').split(/\r?\n/).slice(2).join('\n'));
    return {basis:'2016-presidential-margin',values:new Map(table.filter(row=>row.clinton16&&row.trump16).map(row=>{
      const [state,district]=row.district.split('-');
      return [state+'-G-H-'+(district==='AL'?1:Number(district)),(Number(row.clinton16)-Number(row.trump16))/10];
    }))};
  }
  throw Error('Frozen district input checksum mismatch');
}

function priorStudyRow(row) {
  if (row.reportedShare===undefined) return trainingRow(row);
  if (!Number.isFinite(row.hour)||row.hour<0||row.hour>=maxHours) return null;
  const ranked=[...row.roster].sort((a,b)=>b.share-a.share||a.id.localeCompare(b.id));
  if (ranked.length<2) return null;
  return {...row,ranked,share:row.reportedShare,gap:ranked[0].share-ranked[1].share,total:row.reportedVotes,
    expected:row.reportedVotes/row.reportedShare};
}

export function stateResampledDifference(rows,reference) {
  const states=new Map();
  for (const row of rows) {
    const group=states.get(row.state)||{n:0,sum:0};
    group.n++;
    group.sum+=row.combined.brier-row[reference].brier;
    states.set(row.state,group);
  }
  const blocks=[...states.values()];
  if (blocks.length<8) return null;
  let seed=14892913;
  const samples=Array.from({length:2000},()=>{
    let n=0,delta=0;
    for (let i=0;i<blocks.length;i++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const pick=blocks[Math.floor(seed/4294967296*blocks.length)];
      n+=pick.n;
      delta+=pick.sum;
    }
    return delta/n;
  }).sort((a,b)=>a-b);
  return {states:blocks.length,interval95:[samples[49],samples[1949]]};
}

export function benchmarkPriorUpdate(rawTraining,rawHoldout,trainingLean,holdoutLean=trainingLean,{binaryOnly=false}={}) {
  // Exclude districts whose maps changed between the two general elections.
  const changedMaps=new Set(['AL','GA','LA','NC','NY','OH']);
  const input=(rows,lean)=>firstByStage(rows.filter(row=>row.office==='house'&&hasPair(row.roster)&&
    (!binaryOnly||row.roster.length===2)&&!changedMaps.has(row.state)&&Number.isFinite(lean.get(row.id)))
    .map(row=>priorStudyRow({...row,lean:lean.get(row.id)})).filter(Boolean));
  const training=input(rawTraining,trainingLean),holdout=input(rawHoldout,holdoutLean);
  const folds=new Map([...new Set(holdout.map(row=>row.state))].map(state=>{
    const other=training.filter(row=>row.state!==state);
    return [state,{count:fitBaseline(other),prior:fitPrior(other)}];
  }));
  const results=new Map();
  for (const row of holdout) {
    const actual=winner(row),stage=group(row.share),fold=folds.get(row.state),settings=fold.prior.get(stage);
    if (!actual||!settings) continue;
    const rows=results.get(stage)||[];
    const combined=marginBaseline(row,...settings.combined);
    const favorite=[...combined].sort((a,b)=>b.probability-a.probability)[0];
    rows.push({close:row.gap<=.10,multi:row.ranked.length>2,state:row.state,
      probability:favorite.probability,hit:Number(favorite.id===actual),
      count:errors(marginBaseline(row,fold.count.get(stage)??0),actual),
      prior:errors(marginBaseline(row,...settings.prior),actual),
      combined:errors(combined,actual)});
    results.set(stage,rows);
  }
  const metrics=rows=>rows.length?Object.fromEntries(['count','prior','combined'].map(key=>[key,{
    brier:mean(rows.map(row=>row[key].brier)),logLoss:mean(rows.map(row=>row[key].logLoss)),
  }])):null;
  return {trainingRaces:new Set(training.map(row=>row.id)).size,heldOutRaces:new Set(holdout.map(row=>row.id)).size,
    stages:Object.fromEntries([...results].map(([stage,rows])=>{
      const bands=[.5,.7,.9,.95,.99,1.01];
      const reliability=bands.slice(1).map((high,i)=>{
        const subset=rows.filter(row=>row.probability>=bands[i]&&row.probability<high);
        return {from:bands[i],to:Math.min(1,high),races:subset.length,
          predicted:subset.length?mean(subset.map(row=>row.probability)):null,
          observed:subset.length?mean(subset.map(row=>row.hit)):null};
      });
      const binary=rows.filter(row=>!row.multi);
      return [stage,{scored:rows.length,scores:metrics(rows),closeScores:metrics(rows.filter(row=>row.close)),
        twoCandidate:{races:binary.length,scores:metrics(binary),
          closeScores:metrics(binary.filter(row=>row.close)),
          differenceAgainstCount:stateResampledDifference(binary,'count'),
          differenceAgainstPrior:stateResampledDifference(binary,'prior')},
        multiCandidateScores:metrics(rows.filter(row=>row.multi)),reliability}];
    }))};
}

export async function auditNbcPriorInputs(captureDirectory,training,trainingLean,{includeStudyInputs=false}={}) {
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const [{races},config,district,geometry]=await Promise.all([
    read('data/election-night-races.json'),read('data/results-provider.json'),
    read('data/baselines/pres-2024-districts.json'),read('data/results/district-geography.json'),
  ]);
  const reference=new Map(district.districts.filter(row=>row.valid&&row.geographyVerified&&row.totalVotes>0&&
    Number.isSafeInteger(row.demVotes)&&Number.isSafeInteger(row.repVotes)&&row.demVotes>0&&row.repVotes>0&&
    row.demVotes+row.repVotes<=row.totalVotes&&geometry.districts[row.id]?.currentComparable&&
    geometry.districts[row.id].geometryId===row.geometryId).map(row=>[row.id,row]));
  const inputs=new Map(),rejected=new Map(),upstream={};
  for (const office of ['house','senate','governor']) {
    const source=config.sources.find(row=>row.format==='nbc-national-v2'&&row.office===office);
    const body=await readFile(join(captureDirectory,'probability-nbc-current-'+office+'.json'));
    const raw=JSON.parse(body);
    upstream[office]={url:source.url,at:raw.currentTime,updatedAt:raw.lastModified,sha256:digest(body)};
    for (const row of parseNbcNational(raw,source,races,{onInvalid:issue=>rejected.set(issue.race,issue.reason)})) {
      inputs.set(row.id,row);
    }
  }
  const result=races.map(race=>{
    const row=inputs.get(race.id),reasons=[];
    const key=race.state+'-'+(/^AL$/i.test(race.district)?'AL':String(race.district).padStart(2,'0'));
    const baseline=reference.get(key);
    if (!row) reasons.push(rejected.get(race.id)||'No matched NBC race');
    if (probabilityRule(race.id,race.electionDate)!=='plurality') reasons.push('Different winner rule');
    if (!row?.candidates.some(c=>c.votes>0)||!(row?.expectedVotePercent>0&&row.expectedVotePercent<=100))
      reasons.push('NBC positive returns and count estimate required');
    if (!hasPair(row?.candidates?.map(c=>({party:c.partyCode||c.party}))))
      reasons.push('A unique D/R pair is required for this prior');
    if (race.type==='house'&&!baseline) reasons.push('No exact current-district baseline');
    if (race.type!=='house') reasons.push('Outside the House prior-study scope');
    const stage=row?.expectedVotePercent>0?group(row.expectedVotePercent/100):null;
    const review=row?.providerRosterReview;
    const rosterMatches=review&&['added','missing','partyChanges'].every(key=>review[key]?.length===0);
    let studyInput;
    if (includeStudyInputs&&!reasons.length&&rosterMatches) {
      const at=Date.parse(upstream.house.at),updated=Date.parse(upstream.house.updatedAt);
      if (at>=updated&&at-updated<=5*60*1000) {
        const roster=row.candidates.map(candidate=>({id:candidate.name,votes:candidate.votes,
          party:candidate.partyCode||candidate.party}));
        const total=sum(roster.map(candidate=>candidate.votes));
        studyInput={id:race.id,state:race.state,office:race.type,roster,
          hour:(at-Date.parse('2026-11-03T23:00:00Z'))/3600000,
          expected:Math.round(total/(row.expectedVotePercent/100)),
          lean:(baseline.demVotes-baseline.repVotes)/baseline.totalVotes};
      }
    }
    let estimate;
    if (training&&reasons.length===0&&stage==='60-89'&&row.candidates.length===2&&rosterMatches) {
      const rows=training.filter(point=>point.office==='house'&&point.roster.length===2&&
        hasPair(point.roster)&&point.state!==race.state&&
        Number.isFinite(trainingLean.get(point.id))).map(point=>priorStudyRow({
        ...point,lean:trainingLean.get(point.id),
      })).filter(Boolean);
      const params=fitPrior(rows).get(stage)?.combined;
      const ranked=row.candidates.map(candidate=>({id:candidate.name,votes:candidate.votes,
        party:candidate.partyCode||candidate.party})).sort((a,b)=>b.votes-a.votes);
      const total=sum(ranked.map(candidate=>candidate.votes));
      if (params) estimate={status:'research',source:'NBC News national returns',
        candidates:marginBaseline({total,ranked,expected:total/(row.expectedVotePercent/100),
          lean:10*(baseline.demVotes-baseline.repVotes)/baseline.totalVotes},...params)};
    }
    return {id:race.id,office:race.type,eligibleInputs:reasons.length===0,rosterMatches:Boolean(rosterMatches),
      ...(stage?{stage}:{}),...(row?.candidates.length?{candidates:row.candidates.length}:{}),
      ...(estimate?{estimate}:{}),...(studyInput?{studyInput}:{}),reasons};
  });
  return {status:'research-inputs-only',total:result.length,priorHash:digest(JSON.stringify(district)),
    ...(training?{trainingHash:digest(JSON.stringify(training)),
      trainingPriorHash:digest(JSON.stringify([...trainingLean]))}:{}),
    eligibleInputs:result.filter(row=>row.eligibleInputs).length,
    researchEstimates:result.filter(row=>row.estimate).length,upstream,races:result};
}

export function benchmarkBallotAnalogs(rawRows,{externalTraining}={}) {
  const rows=rawRows.map(trainingRow).filter(Boolean);
  const external=externalTraining?.map(trainingRow).filter(Boolean);
  const result={};
  for (const office of ['house','senate','governor']) {
    const inputs=rows.filter(row=>row.office===office);
    const folds=new Map([...new Set(inputs.map(row=>row.state))].map(state=>{
      const training=(external??inputs).filter(row=>row.office===office&&row.state!==state);
      return [state,{training,baseline:fitBaseline(training)}];
    }));
    const stageScores=new Map();
    for (const row of firstByStage(inputs)) {
      const actual=winner(row);
      if (!actual) continue;
      const stage=group(row.share),scores=stageScores.get(stage)||{opportunities:0,rows:[]};
      scores.opportunities++;
      stageScores.set(stage,scores);
      const {training,baseline}=folds.get(row.state);
      const coefficient=baseline.get(stage)??0;
      const forecast=estimateFromBallotAnalogs(row,training,coefficient);
      if (!forecast) continue;
      scores.rows.push({
        model:errors(forecast.candidates,actual),
        baseline:errors(marginBaseline(row,coefficient),actual),
        turnoutOnly:errors(forecast.turnoutOnly,actual),
        effective:forecast.effective,close:row.gap<=.10,multi:row.ranked.length>2,
        otherWinner:row.ranked.findIndex(candidate=>candidate.id===actual)>1,
      });
    }
    const metrics=rows=>rows.length?Object.fromEntries(['model','baseline','turnoutOnly'].map(key=>[
      key,Object.fromEntries(['brier','logLoss'].map(metric=>[metric,mean(rows.map(row=>row[key][metric]))])),
    ])):null;
    result[office]={races:new Set(inputs.map(row=>row.id)).size,
      checkpoints:inputs.length,stages:Object.fromEntries([...stageScores].map(([stage,{opportunities,rows}])=>[
        stage,{opportunities,scored:rows.length,multiCandidateScored:rows.filter(row=>row.multi).length,
          winnerStartedBelowSecond:rows.filter(row=>row.otherWinner).length,
          scores:metrics(rows),closeScores:metrics(rows.filter(row=>row.close))},
      ]))};
  }
  return {status:external?'research-only-cross-cycle':'research-only-one-cycle',results:result};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv[2]==='--audit-nbc') {
    if (!process.argv[3]) throw Error('Provide the local NBC capture directory');
    const training=process.argv[4]?await readNyt2022FullRosterStudy(process.argv[4],process.argv[3]):undefined;
    const lean=process.argv[5]?await readLean(process.argv[5]):undefined;
    if (training&&lean?.basis!=='2020-presidential-margin') throw Error('The NBC test requires the 2020 presidential-margin training prior');
    console.log(JSON.stringify(await auditNbcPriorInputs(process.argv[3],training,lean?.values),null,2));
  } else {
    const [, , apManifest, captures, nyt2022Manifest, priorFile, nyt2020Manifest, oldPriorFile]=process.argv;
    if (!apManifest||!captures) throw Error('Usage: probability-ballot-study.mjs <AP archive manifest> <capture directory> [NYT 2022 manifest] [frozen district lean CSV] [NYT 2020 manifest] [2016 district CSV]');
    const ap=await readApFullRosterStudy(apManifest,captures);
    const result={ap2024Within:benchmarkBallotAnalogs(ap)};
    if (nyt2022Manifest) {
      const nyt=await readNyt2022FullRosterStudy(nyt2022Manifest,captures);
      result.nyt2022Within=benchmarkBallotAnalogs(nyt);
      result.ap2024OutOfCycle=benchmarkBallotAnalogs(ap,{externalTraining:nyt});
      if (priorFile) {
        const lean=await readLean(priorFile);
        result.priorUpdate={basis:lean.basis,...benchmarkPriorUpdate(nyt,ap,lean.values)};
        result.priorUpdateBinary=benchmarkPriorUpdate(nyt,ap,lean.values,lean.values,{binaryOnly:true});
        if (nyt2020Manifest&&oldPriorFile) {
          const oldLean=await readLean(oldPriorFile);
          const old=await readNyt2020HouseStudy(nyt2020Manifest,captures);
          result.priorUpdate2020To2022={basis:oldLean.basis+' to '+lean.basis,
            ...benchmarkPriorUpdate(old,nyt,oldLean.values,lean.values)};
          result.priorUpdateBinary2020To2022=benchmarkPriorUpdate(old,nyt,oldLean.values,lean.values,{binaryOnly:true});
        }
      }
    }
    console.log(JSON.stringify(result,null,2));
  }
}
