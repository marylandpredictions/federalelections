import {pathToFileURL} from 'node:url';
import {readApFullRosterStudy,readNyt2020HouseStudy,readNyt2022FullRosterStudy} from './probability-count-study.mjs';
import {auditNbcPriorInputs,fitPrior,marginBaseline,readLean,stateResampledDifference} from './probability-ballot-study.mjs';

const methods=['prior','count','combined'];
const anchoredMethods=['anchored-count','anchored-prior'];
const mixtureMethods=[...methods,...anchoredMethods];
const sum=values=>values.reduce((total,value)=>total+value,0);
const mean=values=>sum(values)/values.length;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const stages=share=>share<.25?'under-25':share<.60?'25-59':share<.90?'60-89':'90-plus';
const excludedMaps=new Set(['AL','GA','LA','NC','NY','OH']);
const dot=(a,b)=>sum(a.map((x,i)=>x*b[i]));

function observed(row,lean) {
  if (!row||!Array.isArray(row.roster)||!Number.isFinite(lean)||Math.abs(lean)>1||
      !count(row.expected)||row.expected===0||!Number.isFinite(row.hour)||row.hour<0||row.hour>=336) return null;
  const d=row.roster.filter(candidate=>candidate.party==='D'),r=row.roster.filter(candidate=>candidate.party==='R');
  if (d.length!==1||r.length!==1) return null;
  const others=row.roster.filter(candidate=>candidate.party!=='D'&&candidate.party!=='R')
    .sort((a,b)=>b.votes-a.votes||a.id.localeCompare(b.id));
  const ranked=[d[0],r[0],...others],votes=ranked.map(candidate=>candidate.votes);
  const ids=ranked.map(candidate=>candidate.id);
  if (ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length||!votes.every(count)||
      !count(sum(votes))||votes[0]===0||votes[1]===0||sum(votes)>1.2*row.expected) return null;
  const total=sum(votes),share=total/row.expected;
  return {id:row.id,state:row.state,office:row.office,hour:row.hour,ranked,ids,votes,total,share,lean,
    expected:row.expected,stage:stages(share),margin:(votes[0]-votes[1])/(votes[0]+votes[1])};
}

function outcome(input) {
  const actual=input.ranked.map(candidate=>candidate.actual);
  if (!actual.every(count)||actual.some((value,i)=>value<input.votes[i])) return null;
  const total=sum(actual),pair=actual[0]+actual[1],max=Math.max(...actual);
  if (!count(total)||total<=input.total||!pair||actual.filter(value=>value===max).length!==1) return null;
  return {total,turnoutRatio:total/input.expected,winner:input.ids[actual.indexOf(max)],
    margin:(actual[0]-actual[1])/total,pairMargin:(actual[0]-actual[1])/pair,
    remainder:actual.map((value,i)=>(value-input.votes[i])/(total-input.total))};
}

function roundedTrainingRow(row,lean) {
  if (row.roster?.length!==2||!Number.isFinite(lean)||Math.abs(lean)>1||
      !Number.isFinite(row.hour)||row.hour<0||row.hour>=336||
      !(row.reportedShare>0&&row.reportedShare<=1)||!count(row.reportedVotes)||!row.reportedVotes) return null;
  const d=row.roster.find(candidate=>candidate.party==='D'),r=row.roster.find(candidate=>candidate.party==='R');
  if (!d||!r||!count(d.actual)||!count(r.actual)||d.actual===r.actual||
      !(d.share>0&&r.share>0&&d.share+r.share<=1.001)) return null;
  const actual=d.actual+r.actual,expected=row.reportedVotes/row.reportedShare;
  if (!count(actual)||actual<=row.reportedVotes) return null;
  // Historical rounded shares inform the regressor directly. We do not
  // reverse rounding to invent precise counts or allocate minority ballots.
  return {id:row.id,state:row.state,office:row.office,hour:row.hour,ids:[d.id,r.id],ranked:[d,r],
    reportedShare:row.reportedShare,total:row.reportedVotes,expected,
    share:row.reportedShare,lean,stage:stages(row.reportedShare),margin:(d.share-r.share)/(d.share+r.share),
    truth:{turnoutRatio:actual/expected,pairMargin:(d.actual-r.actual)/actual,remainder:[],
      winner:d.actual>r.actual?d.id:r.id}};
}

const remainingScale=row=>Math.max(.05,1-row.share);
const features=(row,method)=>{
  if (method==='prior') return [1,row.lean];
  if (method==='count') return [1,row.margin];
  if (method==='anchored-count'||method==='anchored-prior') {
    const scale=remainingScale(row);
    return method==='anchored-count'?[scale,scale*row.margin]:
      [scale,scale*row.margin,scale*(row.lean-row.margin)];
  }
  return [1,row.lean,row.margin];
};
const offset=(row,method)=>method.startsWith('anchored-')?row.margin:0;
const predict=(row,method,coefficients)=>offset(row,method)+dot(features(row,method),coefficients);

// A small ridge regression for the final D-R margin within the pair. This
// learns the weight on the count separately at each reporting stage.
function fit(rows,method) {
  if (rows.length<8) return null;
  const inputs=rows.map(row=>features(row,method));
  const n=inputs[0].length;
  const penalty=method.startsWith('anchored-')?.015*mean(rows.map(row=>remainingScale(row)**2)):.015;
  const matrix=Array.from({length:n},(_,i)=>Array.from({length:n+1},(_,j)=>
    mean(inputs.map((x,k)=>x[i]*(j===n?rows[k].truth.pairMargin-offset(rows[k],method):x[j])))+
    (i===j&&i>0?penalty:0)));
  for (let pivot=0;pivot<n;pivot++) {
    const diagonal=matrix[pivot][pivot];
    if (Math.abs(diagonal)<1e-12) return null;
    matrix[pivot]=matrix[pivot].map(value=>value/diagonal);
    for (let row=0;row<n;row++) if (row!==pivot) {
      const multiple=matrix[row][pivot];
      matrix[row]=matrix[row].map((value,i)=>value-multiple*matrix[pivot][i]);
    }
  }
  return matrix.map(row=>row[n]);
}

function firstByStage(rows) {
  const first=new Map();
  for (const row of [...rows].sort((a,b)=>a.hour-b.hour)) {
    const key=row.id+'|'+row.stage;
    if (!first.has(key)) first.set(key,row);
  }
  return [...first.values()];
}

function buildFold(rows,method) {
  const coefficients=fit(rows,method),residuals=[];
  if (!coefficients) return null;
  for (const state of new Set(rows.map(row=>row.state))) {
    const other=fit(rows.filter(row=>row.state!==state),method);
    if (!other) continue;
    for (const row of rows) if (row.state===state) {
      const error=row.truth.pairMargin-predict(row,method,other);
      residuals.push({...row,error:method.startsWith('anchored-')?error/remainingScale(row):error});
    }
  }
  return {coefficients,residuals};
}

export function allocateJointDraw(observedVotes,outstanding,remainder,pairMargin) {
  const [d,r]=observedVotes;
  const otherAdds=remainder.slice(2).map(fraction=>outstanding*fraction);
  const pairOutstanding=Math.max(0,outstanding-sum(otherAdds));
  const pairFinal=d+r+pairOutstanding;
  // Project into the feasible interval implied by the two observed counts.
  const demAddition=Math.max(0,Math.min(pairOutstanding,pairFinal*(1+pairMargin)/2-d));
  return [d+demAddition,r+(pairOutstanding-demAddition),...observedVotes.slice(2).map((votes,i)=>votes+otherAdds[i])];
}

function jointDraws(input,fold,method) {
  if (!fold) return null;
  const center=predict(input,method,fold.coefficients);
  const scale=method.startsWith('anchored-')?remainingScale(input):1;
  const draws=fold.residuals.filter(row=>row.ids.length===input.ids.length).map(row=>{
    const distance=((row.share-input.share)/.15)**2;
    const weight=Math.exp(-distance/2);
    const outstanding=Math.max(0,input.expected*row.truth.turnoutRatio-input.total);
    const votes=allocateJointDraw(input.votes,outstanding,row.truth.remainder,center+scale*row.error);
    const total=sum(votes);
    return {weight,votes,total,margin:(votes[0]-votes[1])/total};
  }).sort((a,b)=>a.margin-b.margin);
  const weight=sum(draws.map(row=>row.weight)),effective=weight**2/sum(draws.map(row=>row.weight**2));
  if (!(weight>=2&&effective>=8)) return null;
  return {draws,weight,effective};
}

function winners(draw) {
  if (draw.winner!==undefined) return [draw.winner];
  const best=Math.max(...draw.votes);
  return draw.votes.flatMap((votes,index)=>votes===best?[index]:[]);
}

function summarize(input,{draws,weight,effective}) {
  const masses=input.ids.map(()=>0);
  for (const draw of draws) {
    const tied=winners(draw);
    for (const i of tied) masses[i]+=draw.weight/tied.length;
  }
  const q=percentile=>{
    let seen=0;
    return draws.find(row=>(seen+=row.weight)>=percentile*weight).margin;
  };
  return {status:'research-joint',candidates:input.ids.map((id,i)=>({id,probability:masses[i]/weight})),
    projectedMargin:q(.5),interval80:[q(.1),q(.9)],projectedTotal:sum(draws.map(row=>row.total*row.weight))/weight,
    draws:draws.length,effective};
}

// Align odds with the separate winner-calibration fit while retaining the
// simulated vote vectors. Missing support cannot be manufactured by weights.
export function alignWinnerMass(input,distribution,calibrated) {
  const base=summarize(input,distribution).candidates;
  const weights=base.map(({id,probability})=>{
    const target=calibrated.find(row=>row.id===id)?.probability;
    return {probability,target};
  });
  if (weights.some(row=>!Number.isFinite(row.target)||row.target<0||row.target>1)||
      Math.abs(sum(weights.map(row=>row.target))-1)>1e-8) return null;
  const unsupported=sum(weights.map(row=>row.probability===0?row.target:0));
  if (unsupported>1/(distribution.effective+1)) return null;
  const reweighted=distribution.draws.map(draw=>{
    const tied=winners(draw);
    return tied.flatMap(winner=>{
      const {probability,target}=weights[winner];
      return target>0?[{...draw,winner,weight:draw.weight/tied.length*target/probability}]:[];
    });
  });
  const draws=reweighted.flat();
  const weight=sum(draws.map(row=>row.weight));
  if (!(weight>0)) return null;
  const effective=weight**2/sum(reweighted.map(group=>sum(group.map(row=>row.weight))**2));
  return effective>=8?{draws,weight,effective,unsupported}:null;
}

// A rounded historical checkpoint does not fix an exact vote count. Use
// both ends of the integer range implied by its two published shares.
export function roundedPairEndpoints(row) {
  const [d,r]=row.ranked.map(candidate=>candidate.share);
  const n=row.total;
  const lower=share=>Math.ceil(n*(share-.0005)-1e-9);
  const upper=share=>Math.floor(n*(share+.0005)+1e-9);
  const min=Math.max(1,lower(d),n-upper(r));
  const max=Math.min(n-1,upper(d),n-lower(r));
  if (!(min<=max)) return [];
  return [...new Set([min,max])].map(value=>({...row,votes:[value,n-value],margin:(2*value-n)/n}));
}

function fitBlend(rows,components=methods,includeRounded=false) {
  const states=new Set(rows.filter(row=>row.votes||includeRounded).map(row=>row.state));
  if (states.size<3) return null;
  const samples=[];
  for (const state of states) {
    const earlier=rows.filter(row=>row.state!==state);
    const folds=components.map(method=>buildFold(earlier,method));
    for (const row of rows) if (row.state===state&&(row.votes||includeRounded)) {
      const observations=row.votes?[row]:roundedPairEndpoints(row);
      const probabilities=observations.map(observed=>{
        const distributions=components.map((method,i)=>jointDraws(observed,folds[i],method));
        if (distributions.some(input=>!input)) return null;
        return distributions.map(input=>summarize(observed,input).candidates
          .find(candidate=>candidate.id===row.truth.winner).probability);
      });
      if (probabilities.length&&probabilities.every(Boolean)) samples.push(probabilities);
    }
  }
  if (samples.length<8) return null;
  let best;
  function evaluate(weights) {
    const loss=mean(samples.map(endpoints=>
      -Math.log(Math.max(1e-12,Math.min(...endpoints.map(probabilities=>dot(probabilities,weights)))))));
    if (!best||loss<best.loss) best={weights,loss,trainingRaces:samples.length};
  }
  function combinations(weights,left) {
    if (weights.length===components.length-1) {
      evaluate([...weights,left/4]);
      return;
    }
    for (let weight=0;weight<=left;weight++) combinations([...weights,weight/4],left-weight);
  }
  combinations([],4);
  return best;
}

function blendDraws(components,weights) {
  const draws=components.flatMap((component,i)=>weights[i]>0?component.draws.map(row=>({
    ...row,weight:row.weight*weights[i]/component.weight,
  })):[]).sort((a,b)=>a.margin-b.margin);
  return {draws,weight:sum(draws.map(row=>row.weight)),
    effective:1/sum(components.map((component,i)=>weights[i]/Math.sqrt(component.effective)))**2};
}

function losses(forecast,truth) {
  const [low,high]=forecast.interval80;
  const p=forecast.candidates.find(candidate=>candidate.id===truth.winner).probability;
  return {brier:sum(forecast.candidates.map(candidate=>(candidate.probability-Number(candidate.id===truth.winner))**2)),
    logLoss:-Math.log(Math.max(p,1e-12)),marginError:Math.abs(forecast.projectedMargin-truth.margin),
    covered80:Number(low<=truth.margin&&truth.margin<=high),
    intervalScore:high-low+10*Math.max(0,low-truth.margin,truth.margin-high)};
}

function studyRows(rows,prior,{asTraining=false,binaryOnly=false}={}) {
  return firstByStage(rows.flatMap(row=>{
    if (row.office!=='house'||excludedMaps.has(row.state)) return [];
    if (binaryOnly&&row.roster?.length!==2) return [];
    if (asTraining&&row.reportedShare!==undefined) {
      const point=roundedTrainingRow(row,prior.get(row.id)/10);
      return point?[point]:[];
    }
    const input=observed(row,prior.get(row.id)/10),truth=input&&outcome(input);
    return input&&truth?[{...input,truth}]:[];
  }));
}

export function benchmarkJoint(training,holdout,trainingPrior,holdoutPrior=trainingPrior,{binaryOnly=false,blend=false,align=false}={}) {
  const fitting=studyRows(training,trainingPrior,{asTraining:true,binaryOnly});
  const scoring=studyRows(holdout,holdoutPrior,{binaryOnly});
  const folds=new Map(),stages=new Map();
  for (const row of scoring) {
    const group=stages.get(row.stage)||{opportunities:0,paired:[]};
    group.opportunities++;
    stages.set(row.stage,group);
    const key=row.stage+'|'+row.state;
    if (!folds.has(key)) {
      const earlier=fitting.filter(point=>point.stage===row.stage&&point.state!==row.state);
      folds.set(key,{models:methods.map(method=>buildFold(earlier,method)),
        anchored:anchoredMethods.map(method=>buildFold(earlier,method)),
        expandedBlend:fitBlend(earlier,mixtureMethods,true),
        blend:blend?fitBlend(earlier):null,
        calibrator:align?fitPrior(earlier.map(point=>({...point,lean:point.lean*10}))).get(row.stage)?.combined:null});
    }
    const fold=folds.get(key);
    const draws=methods.map((method,i)=>jointDraws(row,fold.models[i],method));
    if (draws.some(point=>!point)) continue;
    const predictions=draws.map(draw=>summarize(row,draw));
    const mixed=fold.blend?losses(summarize(row,blendDraws(draws,fold.blend.weights)),row.truth):null;
    const calibrated=fold.calibrator?marginBaseline({...row,lean:row.lean*10},...fold.calibrator):null;
    const aligned=calibrated?alignWinnerMass(row,draws[2],calibrated):null;
    const anchored=anchoredMethods.map((method,index)=>jointDraws(row,fold.anchored[index],method));
    const expanded=fold.expandedBlend&&anchored.every(Boolean)?
      losses(summarize(row,blendDraws([...draws,...anchored],fold.expandedBlend.weights)),row.truth):null;
    group.paired.push({state:row.state,close:Math.abs(row.margin)<=.10,multi:row.ids.length>2,
      methods:Object.fromEntries(methods.map((method,i)=>[method,losses(predictions[i],row.truth)])),
      ...(expanded?{expanded,expandedWeights:fold.expandedBlend.weights}:{}),
      ...(anchored.every(Boolean)?{anchored:Object.fromEntries(anchored.map((draw,index)=>[
        index?'prior':'count',losses(summarize(row,draw),row.truth)
      ]))}:{}),
      ...(mixed?{mixed,weights:fold.blend.weights}:{}),
      ...(aligned?{aligned:losses(summarize(row,aligned),row.truth),unsupported:aligned.unsupported}:{}),});
  }
  const averageLoss=rows=>Object.fromEntries(Object.keys(rows[0]).map(metric=>[
    metric,mean(rows.map(row=>row[metric])),
  ]));
  const metrics=rows=>rows.length?Object.fromEntries(methods.map(method=>[
    method,averageLoss(rows.map(row=>row.methods[method])),
  ])):null;
  return {status:'research-joint',trainingRaces:new Set(fitting.map(row=>row.id)).size,
    heldOutRaces:new Set(scoring.map(row=>row.id)).size,
    stages:Object.fromEntries([...stages].map(([key,{opportunities,paired}])=>{
      const mixed=paired.filter(row=>row.mixed);
      const aligned=paired.filter(row=>row.aligned);
      const anchored=paired.filter(row=>row.anchored);
      const expanded=paired.filter(row=>row.expanded);
      return [key,{opportunities,scored:paired.length,scores:metrics(paired),
        closeScores:metrics(paired.filter(row=>row.close)),multiCandidateScores:metrics(paired.filter(row=>row.multi)),
        ...(anchored.length?{anchored:{races:anchored.length,
          scores:Object.fromEntries(['count','prior'].map(method=>[method,averageLoss(anchored.map(row=>row.anchored[method]))])),
          pairedBaselines:metrics(anchored),
          closeScores:anchored.some(row=>row.close)?Object.fromEntries(['count','prior'].map(method=>[
            method,averageLoss(anchored.filter(row=>row.close).map(row=>row.anchored[method]))
          ])):null}}:{}),
        ...(expanded.length?{expandedBlend:{races:expanded.length,scores:averageLoss(expanded.map(row=>row.expanded)),
          pairedBaselines:metrics(expanded),
          brierDifference95:Object.fromEntries(['prior','count'].map(method=>[
            method,stateResampledDifference(expanded.map(row=>({state:row.state,combined:row.expanded,
              [method]:row.methods[method]})),method)
          ])),
          meanWeights:Object.fromEntries(mixtureMethods.map((method,i)=>[method,mean(expanded.map(row=>row.expandedWeights[i]))]))}}:{}),
        ...(mixed.length?{blended:{races:mixed.length,scores:averageLoss(mixed.map(row=>row.mixed)),
          pairedBaselines:metrics(mixed),meanWeights:methods.map((_,i)=>mean(mixed.map(row=>row.weights[i])))}}:{}),
        ...(align?{winnerAligned:{races:aligned.length,scores:aligned.length?averageLoss(aligned.map(row=>row.aligned)):null,
          pairedBaselines:metrics(aligned),maxUnsupported:aligned.length?Math.max(...aligned.map(row=>row.unsupported)):null}}:{}),
      }];
    }))};
}

async function previewJoint(captures,training,prior) {
  const audit=await auditNbcPriorInputs(captures,undefined,undefined,{includeStudyInputs:true});
  const fitting=studyRows(training,prior,{asTraining:true}),folds=new Map();
  const races=audit.races.map(({studyInput,...row})=>{
    if (!studyInput) return row;
    const input=observed(studyInput,studyInput.lean);
    if (!input) return {...row,reason:'No usable turnout and candidate returns'};
    const key=input.stage+'|'+input.state;
    if (!folds.has(key)) folds.set(key,buildFold(fitting.filter(point=>
      point.stage===input.stage&&point.state!==input.state),'combined'));
    const draws=jointDraws(input,folds.get(key),'combined');
    return draws?{...row,estimate:summarize(input,draws)}:{...row,reason:'Too few comparable historical ballots'};
  });
  return {status:'research-joint',total:audit.total,priorHash:audit.priorHash,upstream:audit.upstream,
    researchEstimates:races.filter(row=>row.estimate).length,races};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [, ,apManifest,nytManifest,captures,priorFile,oldManifest,oldPriorFile]=process.argv;
  if (!apManifest||!nytManifest||!captures||!priorFile)
    throw Error('Usage: probability-joint-study.mjs <AP manifest> <NYT manifest> <capture dir> <district prior CSV> [NYT 2020 manifest] [2016 district prior CSV]');
  const [nyt,prior]=await Promise.all([readNyt2022FullRosterStudy(nytManifest,captures),readLean(priorFile)]);
  if (oldManifest==='--preview-nbc') {
    if (prior.basis!=='2020-presidential-margin') throw Error('The NBC rehearsal requires the historical presidential-margin prior');
    console.log(JSON.stringify(await previewJoint(captures,nyt,prior.values),null,2));
  } else {
    const ap=await readApFullRosterStudy(apManifest,captures);
    const report={basis:prior.basis,later:benchmarkJoint(nyt,ap,prior.values,prior.values,{blend:true}),
      laterBinary:benchmarkJoint(nyt,ap,prior.values,prior.values,{binaryOnly:true,blend:true,align:true})};
    if (oldManifest&&oldPriorFile) {
      const [old,oldPrior]=await Promise.all([
        readNyt2020HouseStudy(oldManifest,captures),readLean(oldPriorFile),
      ]);
      report.firstBinary=benchmarkJoint(old,nyt,oldPrior.values,prior.values,{binaryOnly:true,align:true});
    }
    console.log(JSON.stringify(report,null,2));
  }
}
