// Numerical port check on real historical inputs; never activates a provider.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {simulatePartialCounts} from './probability-partial-model.mjs';
import {partialCalibrationWithPrior} from './probability-partial-adapter.mjs';

const root=process.argv[2]||'.runtime';
const bytes=await readFile('data/results/probability-partial-calibration.json');
const base=JSON.parse(bytes).calibration;
const output={status:'Numerical port check only; not publication authorization',simulations:20000,
 calibrationHash:createHash('sha256').update(bytes).digest('hex'),sources:[],runs:[]};
for(const file of ['probability-aggregate-study.json','probability-aggregate-2024-study.json']){
 const raw=await readFile(join(root,file));
 output.sources.push({file,sha256:createHash('sha256').update(raw).digest('hex')});
 for(const row of JSON.parse(raw).runs){
  const {id,margin,marginSigmaPoints,d,r,total,reported}=row.kernelInput;
  const calibration=partialCalibrationWithPrior(base,[{id,margin,weight:1}],marginSigmaPoints);
  const start=performance.now();
  const result=simulatePartialCounts([{id,margin}],[{id,d,r,total,reported}],calibration,{simulations:20000});
  output.runs.push({id:row.id,source:file,nodeProbability:result.conditionalProbabilityD,
   pythonProbability:row.forecasts.aggregate.probabilityD,pythonSimulations:5000,
   durationMs:performance.now()-start,median:result.medianMarginPoints,interval80:result.interval80});
 }
}
const errors=output.runs.map(r=>Math.abs(r.nodeProbability-r.pythonProbability));
const durations=output.runs.map(r=>r.durationMs).sort((a,b)=>a-b);
output.summary={cases:errors.length,maximumProbabilityDifference:Math.max(...errors),
 rootMeanSquareProbabilityDifference:Math.sqrt(errors.reduce((n,e)=>n+e*e,0)/errors.length),
 medianMs:durations[Math.floor(durations.length/2)],p95Ms:durations[Math.floor(durations.length*.95)]};
await writeFile(join(root,'probability-aggregate-node-replay.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output.summary));
