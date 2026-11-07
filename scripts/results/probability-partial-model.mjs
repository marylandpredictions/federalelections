// Statistical kernel for the offline partial-count model. This module does
// not authorize publication or produce an all-candidate probability vector.
import {createHash} from 'node:crypto';

export const partialModelVersion='fea-partial-count-research-1';
const dimension=7;
const sum=values=>values.reduce((a,b)=>a+b,0);
const dot=(a,b)=>sum(a.map((value,i)=>value*b[i]));
const finite=Number.isFinite;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const stage=q=>q<25?0:q<60?1:q<90?2:q<100?3:4;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const matrix=(rows,columns)=>Array.from({length:rows},()=>Array(columns).fill(0));

function cholesky(a){
  const n=a.length,l=matrix(n,n);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let value=a[i][j];
    for(let k=0;k<j;k++)value-=l[i][k]*l[j][k];
    if(i===j){check(value>0&&finite(value),'Posterior precision is not positive definite');l[i][j]=Math.sqrt(value);}
    else l[i][j]=value/l[j][j];
  }
  return l;
}
function solveLower(l,b){
  const x=[];
  for(let i=0;i<l.length;i++)x[i]=(b[i]-sum(x.map((value,j)=>l[i][j]*value)))/l[i][i];
  return x;
}
function solveTranspose(l,b){
  const x=Array(l.length).fill(0);
  for(let i=l.length-1;i>=0;i--){
    let value=b[i];
    for(let j=i+1;j<l.length;j++)value-=l[j][i]*x[j];
    x[i]=value/l[i][i];
  }
  return x;
}
function vector(value,n){return Array.isArray(value)&&value.length===n&&value.every(finite);}
function arrayMatrix(value,rows,columns){return Array.isArray(value)&&value.length===rows&&value.every(row=>vector(row,columns));}

export function partialCountPosterior(priors,reports,calibration,{useCounts=true}={}){
  const c=calibration;
  check(c?.marginBasis===undefined||['two-party','all-votes'].includes(c.marginBasis),'Invalid margin denominator');
  check(c?.priorMode===undefined||['historical','count-only'].includes(c.priorMode),'Invalid margin prior mode');
  const countOnly=c?.priorMode==='count-only';
  const allVotes=c?.marginBasis==='all-votes';
  check(['bias','measurement','turnoutMean','turnoutUnit','turnoutState'].every(key=>vector(c?.[key],5))&&
    arrayMatrix(c.loading,5,5)&&arrayMatrix(c.swingLoading,2,2)&&vector(c.priorTurnout,3)&&
    c.measurement.every(value=>value>=0)&&c.turnoutUnit.every(value=>value>=0)&&
    c.turnoutState.every(value=>value>=0)&&c.priorTurnout.slice(1).every(value=>value>=0)&&
    finite(c.countyVariance)&&c.countyVariance>0,'Invalid partial-count calibration');
  check(Array.isArray(priors)&&priors.length>0&&priors.length<=600&&Array.isArray(reports)&&
    reports.length===priors.length,'Incomplete partial-count geography');
  if(countOnly)priors=priors.map(prior=>({...prior,margin:0}));
  const observed=new Map(reports.map(row=>[row.id,row]));
  check(observed.size===reports.length&&new Set(priors.map(row=>row.id)).size===priors.length,'Duplicate partial-count geography');
  check(priors.every(row=>typeof row.id==='string'&&/^[\w-]{1,100}$/.test(row.id)&&
    finite(row.margin)&&Math.abs(row.margin)<=1),'Invalid partial-count prior');
  const partisanSlope=c.swingLoading[1].some(value=>value!==0);
  check(!countOnly||!partisanSlope,'Count-only hierarchy cannot use a historical-partisanship interaction');
  for(const prior of priors){
    const report=observed.get(prior.id),hasEstimate=report?.total>0&&report.reported>0;
    if(partisanSlope||!hasEstimate)check(count(prior.turnout)&&prior.turnout>0,'Historical turnout is required for this unit');
    else if(prior.turnout!==null&&prior.turnout!==undefined)
      check(count(prior.turnout)&&prior.turnout>0,'Invalid unused historical turnout');
  }
  // Uniform swing does not use historical turnout when the source supplies
  // a positive count and percentage. Requiring it there excluded usable races.
  const totalPrior=partisanSlope?sum(priors.map(row=>row.turnout)):0;
  if(partisanSlope)check(Number.isSafeInteger(totalPrior)&&totalPrior>0,'Invalid aggregate historical turnout');
  const center=partisanSlope?sum(priors.map(row=>row.margin*row.turnout))/totalPrior:0;
  const precision=matrix(dimension,dimension),weighted=Array(dimension).fill(0);
  for(let i=0;i<dimension;i++)precision[i][i]=1;
  const units=[...priors].sort((a,b)=>a.id.localeCompare(b.id)).map(prior=>{
    const report=observed.get(prior.id);
    check(report&&['d','r','total'].every(key=>count(report[key]))&&report.d+report.r<=report.total,'Malformed partial candidate counts');
    const q=report.reported??0;
    check(finite(q)&&q>=0&&q<=100,'Invalid source reporting estimate');
    const index=stage(q),hasVotes=report.d+report.r>0;
    const denominator=allVotes?report.total:report.d+report.r;
    const current=hasVotes?(report.d-report.r)/denominator:0;
    const swing=c.swingLoading[0].map((value,j)=>value+(prior.margin-center)*c.swingLoading[1][j]);
    const design=[...swing,...c.loading[index]];
    const observation=current-c.bias[index]-prior.margin;
    const secondMoment=allVotes&&report.total?(report.d+report.r)/report.total:1;
    const noise=c.measurement[index]+(hasVotes?(secondMoment-current**2)/denominator:0);
    const variance=c.countyVariance+noise,weight=hasVotes&&useCounts?1/variance:0;
    for(let i=0;i<dimension;i++){
      weighted[i]+=weight*design[i]*observation;
      for(let j=0;j<dimension;j++)precision[i][j]+=weight*design[i]*design[j];
    }
    const hasEstimate=q>0&&report.total>0;
    return {...prior,historicalTurnoutUsed:partisanSlope||!hasEstimate,d:report.d,r:report.r,total:report.total,reported:report.reported??null,
      swing,design,observation,fraction:hasVotes&&useCounts?c.countyVariance/variance:0,
      countySd:Math.sqrt(hasVotes&&useCounts?c.countyVariance*noise/variance:c.countyVariance),
      expected:hasEstimate?report.total/(q/100):prior.turnout,
      turnoutMean:hasEstimate?c.turnoutMean[index]:c.priorTurnout[0],
      turnoutStateSd:Math.sqrt(hasEstimate?c.turnoutState[index]:c.priorTurnout[2]),
      turnoutUnitSd:Math.sqrt(hasEstimate?c.turnoutUnit[index]:c.priorTurnout[1])};
  });
  const l=cholesky(precision),mean=solveTranspose(l,solveLower(l,weighted));
  const covariance=matrix(dimension,dimension);
  for(let j=0;j<dimension;j++){
    const basis=Array(dimension).fill(0);basis[j]=1;
    const column=solveTranspose(l,solveLower(l,basis));
    for(let i=0;i<dimension;i++)covariance[i][j]=column[i];
  }
  return {units,mean,covariance,precisionCholesky:l};
}

function normalGenerator(key){
  let seed=Number.parseInt(key.slice(0,8),16);
  const uniform=()=>{
    seed=(seed+0x6D2B79F5)|0;
    let n=Math.imul(seed^(seed>>>15),seed|1);
    n^=n+Math.imul(n^(n>>>7),n|61);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
  return ()=>Math.sqrt(-2*Math.log(1-uniform()))*Math.cos(2*Math.PI*uniform());
}
const quantile=(values,q)=>values[Math.floor(q*(values.length-1))];

export function simulatePartialCounts(priors,reports,calibration,{simulations=20000,useCounts=true}={}){
  check(Number.isInteger(simulations)&&simulations>=100&&simulations<=200000,'Invalid simulation count');
  const posterior=partialCountPosterior(priors,reports,calibration,{useCounts});
  for(const unit of posterior.units){
    unit.conditionalCenter=unit.margin+unit.fraction*unit.observation;
    unit.conditionalDesign=unit.design.map((value,i)=>(i<2?unit.swing[i]:0)-unit.fraction*value);
  }
  const evidence=posterior.units.map(({id,margin,turnout,historicalTurnoutUsed,d,r,total,reported})=>({id,margin,
    turnout:historicalTurnoutUsed?turnout:null,d,r,total,reported}));
  // The seed deliberately excludes the ablation switch, so methods receive
  // paired random numbers. The output identity still binds that switch.
  const seed=createHash('sha256').update(JSON.stringify([partialModelVersion,evidence,calibration])).digest('hex');
  const inputHash=createHash('sha256').update(JSON.stringify([seed,simulations,useCounts])).digest('hex');
  const normal=normalGenerator(seed),margins=[],totals=[];
  let wins=0;
  for(let iteration=0;iteration<simulations;iteration++){
    const random=Array.from({length:dimension},normal);
    const shift=solveTranspose(posterior.precisionCholesky,random);
    const z=posterior.mean.map((value,i)=>value+shift[i]);
    const stateTurnout=normal();
    let finalD=0,finalR=0,finalTotal=0;
    for(const unit of posterior.units){
      const a=unit.conditionalDesign;
      const conditional=unit.conditionalCenter+a[0]*z[0]+a[1]*z[1]+a[2]*z[2]+
        a[3]*z[3]+a[4]*z[4]+a[5]*z[5]+a[6]*z[6]+unit.countySd*normal();
      const projected=unit.expected*Math.exp(unit.turnoutMean+
        unit.turnoutStateSd*stateTurnout+unit.turnoutUnitSd*normal());
      check(finite(projected),'Non-finite simulated turnout');
      const outstanding=Math.max(0,projected-unit.total);
      const otherShare=unit.total?(unit.total-unit.d-unit.r)/unit.total:0;
      const pair=outstanding*(1-otherShare);
      const finalDenominator=calibration.marginBasis==='all-votes'?unit.total+outstanding:unit.d+unit.r+pair;
      const desired=(conditional*finalDenominator-(unit.d-unit.r)+pair)/2;
      const extraD=Math.max(0,Math.min(pair,desired));
      finalD+=unit.d+extraD;finalR+=unit.r+pair-extraD;finalTotal+=unit.total+outstanding;
    }
    check(finalTotal>0&&finite(finalTotal),'Invalid simulated final count');
    wins+=finalD>finalR?1:finalD===finalR?.5:0;
    margins.push(100*(finalD-finalR)/finalTotal);totals.push(finalTotal);
  }
  margins.sort((a,b)=>a-b);totals.sort((a,b)=>a-b);
  return {status:'research-only',modelVersion:partialModelVersion,inputHash,
    target:'D/R comparison conditional on one of those two sides winning',simulations,
    conditionalProbabilityD:(wins+.5)/(simulations+1),medianMarginPoints:quantile(margins,.5),
    interval80: [quantile(margins,.1),quantile(margins,.9)],
    reportedVotes:sum(posterior.units.map(unit=>unit.total)),medianFinalVotes:quantile(totals,.5)};
}
