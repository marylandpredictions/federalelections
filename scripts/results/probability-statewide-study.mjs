import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {parseDelimited} from './csv.mjs';
import {readNyt2020StatewidePairs,readStatewidePairStudy} from './probability-count-study.mjs';
import {parseNbcNational} from './nbc-provider.mjs';
import {probabilityRule} from './probability-inputs.mjs';

const mean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
const integer=n=>Number.isSafeInteger(n)&&n>0;
const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor(q*(values.length-1))];
const government=/^https:\/\/(?:[^/]+\.gov|[^/]+\.state\.[a-z]{2}\.us)(?:\/|$)/i;
const officialAliases={
  // Confirmed display names in the linked state's certified results.
  '2024-DE':{d:['Matt Meyer'],r:['Mike Ramone']},
  '2024-NC':{d:['Josh Stein'],r:['Mark Robinson']},
  '2024-WA':{r:['Dave Reichert']},
};
const stage=share=>share<.25?'under-25':share<.60?'25-59':share<.90?'60-89':'90-plus';
const logistic=x=>1/(1+Math.exp(-x));
const logLoss=(logit,truth)=>Math.log1p(Math.exp(truth?-logit:logit));

function governorTranscription(rows) {
  const groups=new Map();
  for (const row of rows) {
    if (!['2016','2018','2020','2022','2024'].includes(row.cycle)||row.stage!=='general'||row.special!=='false'||
        !/^[A-Z]{2}$/.test(row.state_abbrev)||row.state_abbrev==='PR') continue;
    const key=row.cycle+'-'+row.state_abbrev,list=groups.get(key)||[];
    list.push(row);
    groups.set(key,list);
  }
  return [...groups].flatMap(([key,rows])=>{
    if (rows.some(row=>!government.test(row.source)||row.ranked_choice_round||
        row.unopposed==='true'||!row.votes||!Number.isSafeInteger(Number(row.votes))||Number(row.votes)<0)||
        new Set(rows.map(row=>row.race_id)).size!==1) return [];
    const candidates=rows.filter(row=>!(/^(?:overvotes?|undervotes?|void|blank)$/i.test(row.alt_result_text.trim())));
    const pick=party=>candidates.filter(row=>row.ballot_party===party);
    const democrats=pick('DEM'),republicans=pick('REP');
    if (democrats.length!==1||republicans.length!==1) return [];
    const [democrat]=democrats,[republican]=republicans;
    const d=Number(democrat.votes),r=Number(republican.votes);
    const total=candidates.reduce((sum,row)=>sum+Number(row.votes),0);
    if (!integer(d)||!integer(r)||!integer(total)||d===r||Math.max(d,r)<=total-d-r) return [];
    const [year,state]=key.split('-');
    return [{year:Number(year),state,d,r,total,democrat:democrat.candidate_name,republican:republican.candidate_name,
      ...(officialAliases[key]?{aliases:officialAliases[key]}:{}),source:democrat.source}];
  });
}

async function readGovernorControls(transcriptionPath) {
  const [source,reviewed]=await Promise.all([
    readFile(transcriptionPath),
    readFile('data/results/comparisons/governor-last-states.json','utf8'),
  ]);
  if (createHash('sha256').update(source).digest('hex')!=='22ff0589b8ccc4c1c6f6f8c20ea5099d20fa044c696db9392823d59ead1364dc')
    throw Error('Governor transcription checksum mismatch');
  const controls=new Map(governorTranscription(parseDelimited(source.toString('utf8'))).map(row=>[row.year+'-'+row.state,row]));
  for (const row of JSON.parse(reviewed).states) {
    if (!row.valid||!government.test(row.sourceUrl)) continue;
    const ds=row.candidates.filter(candidate=>candidate.party==='D'),rs=row.candidates.filter(candidate=>candidate.party==='R');
    if (ds.length!==1||rs.length!==1||ds[0].votes!==row.demVotes||rs[0].votes!==row.repVotes) continue;
    const name=candidate=>candidate.name.split(/\s+\/\s+|\s+and\s+/i)[0];
    controls.set(row.year+'-'+row.state,{year:row.year,state:row.state,total:row.totalVotes,d:row.demVotes,r:row.repVotes,
      democrat:name(ds[0]),republican:name(rs[0]),source:row.sourceUrl});
  }
  return [...controls.values()];
}

function historicalSenate(rows) {
  const races=new Map();
  for (const row of rows) {
    if (!['2016','2018','2020'].includes(row.year)||!/^gen$/i.test(row.stage)||!/^false$/i.test(row.unofficial)||
        !/^false$/i.test(row.special)||!/^total$/i.test(row.mode)||
        /^(?:over|under|blank)\s*votes?$/i.test(row.candidate)) continue;
    const key=row.year+'-'+row.state_po,votes=Number(row.candidatevotes),total=Number(row.totalvotes);
    const race=races.get(key)||{year:Number(row.year),state:row.state_po,total,sum:0,office:'senate'};
    if (!row.candidatevotes||!Number.isSafeInteger(votes)||votes<0||race.total!==total) race.bad=true;
    race.sum+=votes;
    races.set(key,race);
  }
  return [...races.values()].filter(row=>!row.bad&&integer(row.total)&&row.sum===row.total);
}

export function fitHistoricalTurnout(earlier,previousPresidential,{before=2022,anchorByYear}={}) {
  const cohorts=new Map(),seen=new Set();
  for (const row of earlier) {
    const {year,state,office,total}=row;
    if (!Number.isInteger(year)||year>=before) throw Error('Turnout fit includes an outcome from the target cycle');
    const anchor=(anchorByYear?.get(year)??previousPresidential).get(state)?.totalVotes;
    if (!integer(anchor)||!integer(total)) continue;
    const key=office+'|'+(year%4===0?'presidential':'midterm'),id=key+'|'+year+'|'+state;
    if (seen.has(id)) throw Error('Duplicate turnout training race');
    seen.add(id);
    const rows=cohorts.get(key)||[];
    rows.push(total/anchor);
    cohorts.set(key,rows);
  }
  return new Map([...cohorts].filter(([,ratios])=>ratios.length>=6).map(([key,ratios])=>[
    key,{n:ratios.length,center:quantile(ratios,.5),upper:quantile(ratios,.9)},
  ]));
}

export function statewideFeatures(row,prior,fit) {
  if (!row) return null;
  const raw=integer(row.d)&&integer(row.r)&&row.d+row.r<=row.total;
  const shares=Number.isFinite(row.dShare)&&Number.isFinite(row.rShare)&&row.dShare>0&&row.rShare>0&&
    row.dShare+row.rShare<=1.001;
  if (!prior||!fit||!integer(prior.totalVotes)||!integer(prior.demVotes)||!integer(prior.repVotes)||
      (!raw&&!shares)||!integer(row.total)||prior.demVotes+prior.repVotes>prior.totalVotes||
      !Number.isFinite(fit.center)||!Number.isFinite(fit.upper)||
      !(fit.center>0&&fit.upper>=fit.center)||!Number.isFinite(row.hour)||row.hour<0||row.hour>=336) return null;
  const anchor=prior.totalVotes*fit.center;
  // Keep uncertainty from the upper tail of earlier turnout. Passing the
  // historical center does not imply the race is finished.
  const remaining=Math.max(prior.totalVotes*fit.upper-row.total,.01*anchor);
  const difference=raw?row.d-row.r:row.total*(row.dShare-row.rShare);
  return {anchor,stage:stage(row.total/anchor),signal:difference/remaining,
    lean:(prior.demVotes-prior.repVotes)/prior.totalVotes,observedMargin:difference/row.total};
}

function firstInStage(rows) {
  const first=new Map();
  for (const row of [...rows].sort((a,b)=>a.hour-b.hour)) {
    const key=row.id+'|'+row.stage;
    if (!first.has(key)) first.set(key,row);
  }
  return [...first.values()];
}

function fitModel(rows,method) {
  let best={loss:Infinity};
  for (const lean of method==='count'?[0]:[0,1,2,4,8,12,16])
    for (const count of method==='prior'?[0]:[0,.25,.5,1,2,4,8,12]) {
      const loss=mean(rows.map(row=>logLoss(lean*row.lean+count*row.signal,row.truth)))+
        .0005*(lean**2+count**2);
      if (loss<best.loss) best={loss,lean,count};
    }
  return best;
}

function studyRows(rows,cycle,priors,turnout) {
  return firstInStage(rows.flatMap(row=>{
    const yearType=cycle%4===0?'presidential':'midterm';
    const feature=statewideFeatures(row,priors.get(row.state),turnout.get(row.office+'|'+yearType));
    if (!feature||!integer(row.finalD)||!integer(row.finalR)||!integer(row.finalTotal)||
        row.d>row.finalD||row.r>row.finalR||row.finalD+row.finalR>row.finalTotal||row.finalD===row.finalR) return [];
    return [{...row,...feature,truth:Number(row.finalD>row.finalR)}];
  }));
}

function statewideFold(rows,office,stage,state) {
  const other=rows.filter(row=>row.office===office&&row.stage===stage&&row.state!==state);
  return other.length>=6&&new Set(other.map(row=>row.truth)).size===2?other:null;
}

export function benchmarkStatewideProxy(training,holdout,anchors,turnout,
  {trainingYear=2022,holdoutYear=2024,holdoutAnchors=anchors}={}) {
  if (!(trainingYear<holdoutYear)) throw Error('Statewide benchmark cycles must move forward');
  const fitting=studyRows(training,trainingYear,anchors,turnout),testing=studyRows(holdout,holdoutYear,holdoutAnchors,turnout);
  const methods=['prior','count','combined'];
  const folds=new Map(),results={};
  for (const office of ['senate','governor']) {
    const rows=testing.filter(row=>row.office===office),trained=fitting.filter(row=>row.office===office);
    const groups=new Map();
    for (const row of rows) {
      const group=groups.get(row.stage)||{opportunities:0,scored:[]};
      group.opportunities++;
      groups.set(row.stage,group);
      const key=office+'|'+row.stage+'|'+row.state;
      if (!folds.has(key)) {
        const other=statewideFold(trained,office,row.stage,row.state);
        folds.set(key,other?
          Object.fromEntries(methods.map(method=>[method,fitModel(other,method)])):null);
      }
      const model=folds.get(key);
      if (!model) continue;
      const errors=Object.fromEntries(methods.map(method=>{
        const {lean,count}=model[method],logit=lean*row.lean+count*row.signal;
        return [method,{brier:(logistic(logit)-row.truth)**2,logLoss:logLoss(logit,row.truth)}];
      }));
      group.scored.push({state:row.state,close:Math.abs(row.observedMargin)<=.10,...errors});
    }
    const metrics=rows=>rows.length?Object.fromEntries(methods.map(method=>[method,
      Object.fromEntries(['brier','logLoss'].map(metric=>[metric,mean(rows.map(row=>row[method][metric]))])),
    ])):null;
    const stateSensitivity=(rows,baseline)=>{
      const states=new Set(rows.map(row=>row.state));
      if (states.size<2) return null;
      const differences=[...states].map(state=>mean(rows.filter(row=>row.state!==state)
        .map(row=>row.combined.brier-row[baseline].brier)));
      return [Math.min(...differences),Math.max(...differences)];
    };
    results[office]={trainingRaces:new Set(trained.map(row=>row.id)).size,heldOutRaces:new Set(rows.map(row=>row.id)).size,
      stages:Object.fromEntries([...groups].map(([stage,{opportunities,scored}])=>[stage,{
        opportunities,scored:scored.length,scores:metrics(scored),
        close:{scored:scored.filter(row=>row.close).length,scores:metrics(scored.filter(row=>row.close))},
        brierDifferenceOmittingOneState:{
          count:stateSensitivity(scored,'count'),prior:stateSensitivity(scored,'prior'),
        },
      }]))};
  }
  return {status:'research-head-to-head-only',trainingYear,holdoutYear,turnout:Object.fromEntries(turnout),results};
}

async function previewNbcStatewide(captureDirectory,training,prior2020,turnout) {
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const [catalogue,config,sourcePrior]=await Promise.all([
    read('data/election-night-races.json'),read('data/results-provider.json'),
    read('data/baselines/source/fec-president-2024-states.json'),
  ]);
  const prior2024=new Map(sourcePrior.states.filter(row=>row.valid).map(row=>[row.state,row]));
  const fitting=studyRows(training,2022,prior2020,turnout);
  const races=[],upstream={};
  for (const office of ['senate','governor']) {
    const source=config.sources.find(row=>row.office===office&&row.format==='nbc-national-v2');
    const bytes=await readFile(join(captureDirectory,'probability-nbc-current-'+office+'.json'));
    const raw=JSON.parse(bytes),at=Date.parse(raw.currentTime),updated=Date.parse(raw.lastModified);
    upstream[office]={url:source.url,at:raw.currentTime,updatedAt:raw.lastModified,
      sha256:createHash('sha256').update(bytes).digest('hex')};
    const invalid=new Map();
    const rows=new Map(parseNbcNational(raw,source,catalogue.races,{onInvalid:row=>invalid.set(row.race,row.reason)})
      .map(row=>[row.id,row]));
    for (const race of catalogue.races.filter(row=>row.type===office)) {
      const live=rows.get(race.id),reasons=[];
      if (!live) reasons.push(invalid.get(race.id)||'No matching NBC result');
      if (probabilityRule(race.id,race.electionDate)!=='plurality') reasons.push('Different winner rule');
      const review=live?.providerRosterReview;
      if (!review||!['added','missing','partyChanges'].every(key=>review[key]?.length===0))
        reasons.push('NBC and FEA ballots differ');
      const d=live?.candidates.filter(candidate=>(candidate.partyCode||candidate.party)==='D')??[];
      const r=live?.candidates.filter(candidate=>(candidate.partyCode||candidate.party)==='R')??[];
      if (live?.candidates.length!==2||d.length!==1||r.length!==1) reasons.push('This study requires two named D/R candidates');
      const hour=(at-Date.parse('2026-11-03T23:00:00Z'))/3600000;
      const point=statewideFeatures({hour,d:d[0]?.votes,r:r[0]?.votes,total:(live?.candidates??[])
        .reduce((sum,candidate)=>sum+candidate.votes,0)},prior2024.get(race.state),turnout.get(office+'|midterm'));
      if (!point) reasons.push('No compatible historical turnout and count');
      if (!(at>=updated&&at-updated<=5*60*1000)) reasons.push('Stale or invalid NBC capture timestamp');
      const stage=point?.stage;
      const supported=office==='senate'?'60-89':'25-59';
      if (stage!==supported) reasons.push('Outside the repeated-improvement reporting stage');
      const fold=statewideFold(fitting,office,stage,race.state);
      if (!fold) reasons.push('Insufficient earlier-cycle comparable races');
      let estimate;
      if (!reasons.length) {
        const model=fitModel(fold,'combined'),p=logistic(model.lean*point.lean+model.count*point.signal);
        estimate={status:'research',source:'NBC national returns',candidates:[
          {name:d[0].name,probability:p},{name:r[0].name,probability:1-p},
        ]};
      }
      races.push({id:race.id,office,stage,reasons,...(estimate?{estimate}:{})});
    }
  }
  return {status:'research-head-to-head-only',upstream,total:races.length,
    researchEstimates:races.filter(row=>row.estimate).length,races};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [, ,apManifest,nytManifest,captures,transcription,nyt2020Manifest]=process.argv;
  if (!apManifest||!nytManifest||!captures||!transcription)
    throw Error('Usage: probability-statewide-study.mjs <AP manifest> <NYT manifest> <capture dir> <governor results CSV> [NYT 2020 manifest]');
  const [controls,senate,pres2016,pres2020,pres2012]=await Promise.all([
    readGovernorControls(transcription),readFile('data/baselines/source/1976-2024-senate-state.tab','utf8'),
    readFile('data/baselines/source/fec-president-2016-states.json','utf8'),
    readFile('data/baselines/source/fec-president-2020-states.json','utf8'),
    readFile('data/results/probability-presidential-turnout-2012.json','utf8'),
  ]);
  const states=data=>new Map(JSON.parse(data).states.filter(row=>row.valid).map(row=>[row.state,row]));
  const earlier=[...historicalSenate(parseDelimited(senate,'\t')),
    ...controls.filter(row=>row.year<2022).map(row=>({...row,office:'governor'}))];
  const prior2016=states(pres2016),prior2020=states(pres2020);
  const prior2012=new Map(Object.entries(JSON.parse(pres2012).states).map(([state,totalVotes])=>[state,{totalVotes}]));
  if (prior2012.size!==51||[...prior2012.values()].reduce((sum,row)=>sum+row.totalVotes,0)!==129085410)
    throw Error('2012 FEC total failed reconciliation');
  const anchorByYear=new Map([[2016,prior2012]]);
  const fit=fitHistoricalTurnout(earlier,prior2016,{anchorByYear});
  const [training,holdout]=await readStatewidePairStudy(apManifest,nytManifest,captures,controls);
  const later=benchmarkStatewideProxy(training,holdout,prior2020,fit);
  if (nyt2020Manifest==='--preview-nbc') {
    console.log(JSON.stringify(await previewNbcStatewide(captures,training,prior2020,fit),null,2));
  } else if (nyt2020Manifest) {
    const early=await readNyt2020StatewidePairs(nyt2020Manifest,captures,controls);
    const fitBefore2020=fitHistoricalTurnout(earlier.filter(row=>row.year<2020),prior2016,{before:2020,anchorByYear});
    const first=benchmarkStatewideProxy(early,training,prior2016,fitBefore2020,
      {trainingYear:2020,holdoutYear:2022,holdoutAnchors:prior2020});
    console.log(JSON.stringify({first,later},null,2));
  } else console.log(JSON.stringify(later,null,2));
}
