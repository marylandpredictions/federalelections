import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {parseDelimited} from './csv.mjs';
import {buildPresidentialRows} from './build-presidential-comparisons.mjs';

const positive = value => Number.isSafeInteger(value) && value>0;
const average = values => values.reduce((sum,value)=>sum+value,0)/values.length;
const decode = raw => raw[0]===31 && raw[1]===139 ? gunzipSync(raw,{maxOutputLength:32*1024*1024}) : raw;
const checksum = body => createHash('sha256').update(body).digest('hex');
// Certified controls for races flagged as unofficial or incomplete in the
// checked-in MEDSL file. They are used only when scoring the later cycles.
const certified = {
  '2022-ct-senate':{votes:1259887,source:'https://www.fec.gov/resources/cms-content/documents/federalelections2022.pdf'},
  '2022-md-senate':{votes:2002336,finalD:1316897,finalR:682293,source:'https://elections.maryland.gov/elections/archive/2022/General_Results/gen_detail_results_2022_4_1.html'},
  '2022-mo-senate':{votes:2069130,source:'https://www.sos.mo.gov/CMSImages/ElectionResultsStatistics/2022GeneralElection.pdf'},
  '2024-az-senate':{votes:3348814,finalD:1676335,finalR:1595761,source:'https://azmemory.azlibrary.gov/assets/displaypdf/326457'},
};

// Learn once on the earlier cycle. Model ratios on the log scale so states
// with more voters do not dominate the fit.
export function fitTurnoutWeight(training) {
  let numerator=0, denominator=0;
  for (const {historical,provider,reported,actual} of training) {
    if (![historical,provider,reported,actual].every(positive) || provider<reported || actual<reported)
      throw Error('Invalid training turnout row');
    const anchor=Math.max(historical,reported);
    const signal=Math.log(provider/anchor);
    numerator+=signal*Math.log(actual/anchor);
    denominator+=signal*signal;
  }
  if (training.length<3 || !denominator) throw Error('Insufficient earlier-cycle turnout evidence');
  return Math.max(0,Math.min(1,numerator/denominator));
}

export function evaluateTurnoutWeight(rows,weight) {
  if (!Number.isFinite(weight)||weight<0||weight>1) throw Error('Invalid turnout weight');
  return rows.map(row=>{
    const {historical,provider,reported,actual}=row;
    if (![historical,provider,reported,actual].every(positive) || provider<reported || actual<reported)
      throw Error('Invalid held-out turnout row');
    const anchor=Math.max(historical,reported);
    const blended=anchor*Math.exp(weight*Math.log(provider/anchor));
    return {...row,blended,absoluteLogError:{
      historical:Math.abs(Math.log(anchor/actual)),
      provider:Math.abs(Math.log(provider/actual)),
      blended:Math.abs(Math.log(blended/actual)),
    }};
  });
}

export function captureTurnout(raw,{sha256,at,state,electionDate,includeLate=false}) {
  const body=decode(raw);
  if (checksum(body)!==sha256) throw Error('Capture checksum mismatch');
  const payload=JSON.parse(body);
  const races=(payload.races||payload.data?.races||[]).filter(race=>
    race.election_date===electionDate && /senate/i.test(race.office) &&
    (race.state_id || race.reporting_units?.find(unit=>unit.level==='state')?.state_postal)===state);
  if (races.length!==1) throw Error('Expected one Senate contest in capture');
  const [race]=races;
  const sourceUpdatedAt=race.updated_at || race.last_updated;
  if (!(Date.parse(sourceUpdatedAt)<=Date.parse(at))) throw Error('Capture contains a future update');
  const statewide=race.reporting_units?.find(unit=>unit.level==='state');
  const reported=statewide?.total_votes ?? race.votes;
  const provider=statewide?.total_expected_vote ?? race.tot_exp_vote;
  const progress=statewide?.eevp ?? race.eevp;
  if (!positive(reported)||!positive(provider)||provider<reported||
      !(progress>0&&progress<99 || includeLate && progress>=99 && progress<=100))
    throw Error('No usable incomplete-count turnout estimate at the first capture');
  const votes=(statewide?.candidates || race.candidates || []).map(candidate=>({
    party:statewide ? race.candidate_metadata?.[candidate.nyt_id]?.party?.nyt_id : candidate.party_id,
    votes:statewide ? candidate.votes?.total : candidate.votes,
  }));
  const partyVotes=pattern=>{
    const matches=votes.filter(row=>pattern.test(row.party));
    return matches.length===1 && positive(matches[0].votes) ? matches[0].votes : null;
  };
  const d=partyVotes(/^(dem|democrat)$/i), r=partyVotes(/^(gop|republican)$/i);
  return {at,sourceUpdatedAt,reported,provider,progress,...(d && r && d+r<=reported?{d,r}:{})};
}

const logit=p=>Math.log(p/(1-p));
const logistic=x=>1/(1+Math.exp(-x));
const observablePair = row => [row.d,row.r,row.historical].every(positive) &&
  row.historicalShare>0 && row.historicalShare<1;
const reconciledPair = row => positive(row.finalD) && positive(row.finalR) &&
  row.finalD>=row.d && row.finalR>=row.r && row.finalD!==row.finalR;

// An exploratory head-to-head D/R screen. Residuals come only from 2020.
// Pairing each share residual with its turnout error preserves their observed
// dependence. These estimates are not probabilities of winning a multiway race.
function fitPairFallbacks(training) {
  const fit=training.map(row=>{
    const d=row.finalD-row.d,r=row.finalR-row.r;
    const prior=logit(row.historicalShare), reported=logit(row.d/(row.d+row.r));
    return {signal:reported-prior,residual:logit(d/(d+r))-prior,
      finalSwing:logit(row.finalD/(row.finalD+row.finalR))-prior,
      turnoutRatio:(row.finalD+row.finalR)/row.historical};
  });
  const bias=average(fit.map(row=>row.residual));
  const denominator=fit.reduce((sum,row)=>sum+row.signal**2,0);
  const weight=denominator?Math.max(0,Math.min(1,fit.reduce((sum,row)=>sum+row.signal*row.residual,0)/denominator)):0;
  return {fit,bias,weight};
}

function predictPairFallbacks(row,{fit,bias,weight}) {
    const prior=logit(row.historicalShare), signal=logit(row.d/(row.d+row.r))-prior;
    const draws={
      'frozen-prior':fit.map(train=>logistic(prior+train.finalSwing)),
      'no-live-swing':fit.map(train=>project(row,train.turnoutRatio,prior+train.residual-bias)),
      'historical-batch-offset':fit.map(train=>project(row,train.turnoutRatio,prior+train.residual)),
      'shrunken-live-margin':fit.map(train=>project(row,train.turnoutRatio,prior+weight*signal+train.residual-weight*train.signal)),
    };
    return Object.fromEntries(Object.entries(draws).map(([name,shares])=>{
      const p=(shares.reduce((wins,share)=>wins+(share>.5?1:share===.5?.5:0),0)+.5)/(shares.length+1);
      return [name,{p,shares}];
    }));
}

function fitPairCombination(training) {
  const folds=training.map((row,index)=>{
    const model=fitPairFallbacks(training.filter((_,i)=>i!==index));
    const predictions=predictPairFallbacks(row,model);
    return {predictions,truth:Number(row.finalD>row.finalR)};
  });
  const names=Object.keys(folds[0].predictions);
  let best;
  for (const [i,left] of names.entries()) {
    for (const right of names.slice(i)) {
      for (const weight of left===right?[1]:[.25,.5,.75]) {
        const brier=average(folds.map(({predictions,truth})=>
          (weight*predictions[left].p+(1-weight)*predictions[right].p-truth)**2));
        if (!best || brier<best.brier-1e-12) best={left,right,weight,brier};
      }
    }
  }
  return best;
}

export function compareSparsePairFallbacks(training,holdout) {
  const fitting=training.filter(row=>observablePair(row) && reconciledPair(row) && row.finalD>row.d && row.finalR>row.r);
  if (fitting.length<3) return {status:'insufficient-training',training:fitting.length};
  const model=fitPairFallbacks(fitting);
  const combination=fitPairCombination(fitting);
  const candidates=holdout.filter(observablePair);
  const forecasts=candidates.filter(reconciledPair).map(row=>{
    const truth=Number(row.finalD>row.finalR);
    const predictions=predictPairFallbacks(row,model);
    const methods=Object.fromEntries(Object.entries(predictions).map(([name,{p,shares}])=>{
      const actualShare=row.finalD/(row.finalD+row.finalR);
      const sorted=[...shares].sort((a,b)=>a-b);
      return [name,{democraticPairProbability:p,brier:(p-truth)**2,
        logLoss:-Math.log(truth?p:1-p),marginError:200*Math.abs(average(shares)-actualShare),
        covered80:Number(sorted[Math.floor((sorted.length-1)*.1)]<=actualShare &&
          actualShare<=sorted[Math.ceil((sorted.length-1)*.9)])}];
    }));
    const p=combination.weight*predictions[combination.left].p+(1-combination.weight)*predictions[combination.right].p;
    methods['training-fold-combination']={democraticPairProbability:p,brier:(p-truth)**2,
      logLoss:-Math.log(truth?p:1-p)};
    // Fixed sensitivity check: gradually transfer weight to the count as
    // the provider's estimated share counted rises. Use no evaluation truth.
    const progress=Number.isFinite(row.progress)&&row.progress>=0&&row.progress<=100?row.progress/100:0;
    const stageWeighted=(1-progress)*predictions['frozen-prior'].p+progress*predictions['no-live-swing'].p;
    methods['reporting-weighted-combination']={democraticPairProbability:stageWeighted,brier:(stageWeighted-truth)**2,
      logLoss:-Math.log(truth?stageWeighted:1-stageWeighted)};
    return {id:row.id,at:row.at,progress:row.progress,democraticPairWinner:Boolean(truth),
      countedLeaderCorrect:row.d===row.r?null:(row.d>row.r)===Boolean(truth),methods};
  });
  const metrics=forecasts.length?Object.fromEntries(Object.keys(forecasts[0].methods).map(method=>
    [method,Object.fromEntries(['brier','logLoss','marginError','covered80'].filter(metric=>
      Number.isFinite(forecasts[0].methods[method][metric])).map(metric=>
      [metric,average(forecasts.map(row=>row.methods[method][metric]))]))])):null;
  return {status:'exploratory-pair-only',training:fitting.length,weight:model.weight,bias:model.bias,combination,
    unresolvedTruth:candidates.filter(row=>!reconciledPair(row)).map(row=>row.id),
    countedLeader:{correct:forecasts.filter(row=>row.countedLeaderCorrect===true).length,
      nonTied:forecasts.filter(row=>row.countedLeaderCorrect!==null).length},
    neutralBaseline:{brier:.25,logLoss:Math.log(2)},forecasts,metrics};
}

function project(row,turnoutRatio,remainingLogit) {
  const counted=row.d+row.r;
  const remaining=Math.max(0,row.historical*turnoutRatio-counted);
  return (row.d+remaining*logistic(remainingLogit))/(counted+remaining);
}

async function study(manifestPath,captureDirectory) {
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const sourceRoot='data/baselines/source';
  const [president,senate,fec]=await Promise.all([
    readFile(join(sourceRoot,'countypres_2000-2024.csv'),'utf8'),
    readFile(join(sourceRoot,'1976-2024-senate-state.tab'),'utf8'),
    readFile(join(sourceRoot,'fec-president-2020-states.json'),'utf8'),
  ]);
  const historical2016=new Map(buildPresidentialRows(parseDelimited(president),2016).states
    .filter(row=>row.valid).map(row=>[row.state,row]));
  const historical2020=new Map(JSON.parse(fec).states.filter(row=>row.valid).map(row=>[row.state,row]));
  const truth=new Map(), finalPairs=new Map();
  for (const row of parseDelimited(senate,'\t')) if (['2018','2020','2022','2024'].includes(row.year) &&
    /^gen$/i.test(row.stage) && /^false$/i.test(row.special) && /^false$/i.test(row.unofficial) &&
    /^total$/i.test(row.mode) && !/^(?:OVER|UNDER|BLANK)\s*VOTES?$/i.test(row.candidate)) {
    const id=row.year+'-'+row.state_po.toLowerCase()+'-senate', votes=Number(row.candidatevotes);
    if (Number.isSafeInteger(votes)&&votes>=0) {
      truth.set(id,(truth.get(id)||0)+votes);
      const pair=finalPairs.get(id)||{finalD:0,finalR:0};
      if (row.party_simplified==='DEMOCRAT') pair.finalD+=votes;
      if (row.party_simplified==='REPUBLICAN') pair.finalR+=votes;
      finalPairs.set(id,pair);
    }
  }
  const training=[],holdout=[],midtermStress=[],midtermSecond=[],redirectedHoldout=[],lateHoldout=[],skipped=[];
  // This archive stores some 2022 Senate captures in a separate group.
  // They are independent of our 2020 fit, regardless of the archive's split.
  const additionalMidterm={arizona:'az',nevada:'nv',ohio:'oh',pennsylvania:'pa',wisconsin:'wi'};
  const entries=new Map(Object.entries(manifest.holdout));
  for (const [state,code] of Object.entries(additionalMidterm)) {
    const id='2022-'+code+'-senate';
    const entry=manifest['2022']?.[state+'-us-senate'];
    if (entry && !entries.has(id)) entries.set(id,entry);
  }
  const inputs=[...entries].map(([id,entry])=>({id,entry,second:false}));
  for (const state of ['az','nv','oh','pa']) {
    const id='2022-'+state+'-senate';
    const entry=entries.get(id);
    if (entry) inputs.push({id,entry,second:true});
  }
  for (const {id,entry,second} of inputs) {
    if (!/^(2020|2022|2024)-[a-z]{2}-senate$/.test(id)) continue;
    const year=id.slice(0,4),state=id.slice(5,7).toUpperCase();
    const electionDate={2020:'2020-11-03',2022:'2022-11-08',2024:'2024-11-05'}[year];
    try {
      const raw=decode(await readFile(join(captureDirectory,id+(second?'.next':'')+'.body')));
      const digest=checksum(raw);
      const captureIndex=entry.captures.findIndex(([,sha256])=>sha256===digest);
      if (captureIndex<0) throw Error('Capture checksum mismatch');
      if (second ? captureIndex!==1 : captureIndex>0 && year!=='2024')
        throw Error('Unexpected capture date for this evaluation group');
      const [stamp,sha256]=entry.captures[captureIndex];
      const at=stamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3T$4:$5:$6Z');
      const capture=captureTurnout(raw,{sha256,at,state,electionDate,includeLate:year==='2024'});
      const pres=(year==='2020'?historical2016:historical2020).get(state);
      const historical=year==='2022'?truth.get('2018-'+id.slice(5)):pres?.totalVotes;
      const actual=certified[id]?.votes ?? truth.get(id);
      if (!positive(historical)) throw Error('Missing historical same-cycle turnout anchor');
      if (!positive(actual)||actual<capture.reported) throw Error('Missing or incompatible final turnout');
      const record={id,...capture,sha256,historical,actual,
        truthSource:certified[id]?.source || 'data/baselines/source/1976-2024-senate-state.tab'};
      const pair=certified[id] || finalPairs.get(id);
      if (pres && positive(pair?.finalD) && positive(pair?.finalR)) Object.assign(record,{finalD:pair.finalD,finalR:pair.finalR},
        {historicalShare:pres.demVotes/(pres.demVotes+pres.repVotes)});
      if (second) {
        midtermSecond.push(record);
      } else if (capture.progress>=99) {
        lateHoldout.push({...record,captureIndex});
      } else if (captureIndex>0) {
        skipped.push({id,reason:'First capture unavailable; archive returned a verified later capture'});
        redirectedHoldout.push(record);
      } else (year==='2020'?training:year==='2022'?midtermStress:holdout).push(record);
    } catch (error) { skipped.push({id,...(second?{capture:'second'}:{}),reason:error.code==='ENOENT'?'Capture not retrieved':error.message}); }
  }
  const weight=fitTurnoutWeight(training);
  const evaluate=inputs=>{
    const rows=evaluateTurnoutWeight(inputs,weight);
    const scores=rows.length ? Object.fromEntries(['historical','provider','blended'].map(method=>
      [method,average(rows.map(row=>row.absoluteLogError[method]))])) : null;
    return {rows,scores};
  };
  return {status:'exploratory-only',weight,training,holdout:evaluate(holdout),
    midtermStress:evaluate(midtermStress),midtermSecond:evaluate(midtermSecond),
    redirectedHoldout:evaluate(redirectedHoldout),lateHoldout:evaluate(lateHoldout),
    headToHead:{holdout:compareSparsePairFallbacks(training,holdout),
      midtermStress:compareSparsePairFallbacks(training,midtermStress),
      midtermSecond:compareSparsePairFallbacks(training,midtermSecond),
      redirectedHoldout:compareSparsePairFallbacks(training,redirectedHoldout),
      lateHoldout:compareSparsePairFallbacks(training,lateHoldout)},skipped};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]||!process.argv[3]) throw Error('Usage: node scripts/results/probability-turnout-study.mjs <archive-manifest.json> <capture-directory>');
  console.log(JSON.stringify(await study(process.argv[2],process.argv[3]),null,2));
}
