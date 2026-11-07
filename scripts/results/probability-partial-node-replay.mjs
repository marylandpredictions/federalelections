// Offline port-equivalence and timing check. This never writes a live release.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {simulatePartialCounts} from './probability-partial-model.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: probability-partial-node-replay.mjs <private replay inputs> <report>');
const raw=await readFile(input),data=JSON.parse(raw);
if(data.status!=='private-research-replay'||!data.cases?.length)throw Error('No private replay inputs');
const runs=[];
for(const row of data.cases){
  const forecasts={};
  for(const [method,useCounts] of [['baseline',false],['partial',true]]){
    const started=performance.now();
    // Deliberately pass no final outcomes or scoring fields to the kernel.
    const actual=simulatePartialCounts(row.priors,row.reports,data.calibration,{simulations:20000,useCounts});
    forecasts[method]={...actual,durationMs:performance.now()-started,
      pythonProbabilityDifference:actual.conditionalProbabilityD-row.python[method].probabilityD,
      pythonMarginDifference:actual.medianMarginPoints-row.python[method].median};
  }
  runs.push({id:row.id,state:row.state,stage:row.stage,scoringOnly:row.scoringOnly,forecasts});
}
const values=runs.flatMap(row=>Object.values(row.forecasts)),durations=values.map(v=>v.durationMs).sort((a,b)=>a-b);
const report={status:'research-kernel-port-check',variant:data.variant,inputSha256:createHash('sha256').update(raw).digest('hex'),
  kernelSha256:createHash('sha256').update(await readFile(new URL('./probability-partial-model.mjs',import.meta.url))).digest('hex'),
  cases:runs.length,simulations:20000,maxProbabilityDifference:Math.max(...values.map(v=>Math.abs(v.pythonProbabilityDifference))),
  medianDurationMs:durations[Math.floor(durations.length/2)],p95DurationMs:durations[Math.floor(.95*durations.length)],runs};
await writeFile(output,JSON.stringify(report));
console.log(JSON.stringify({...report,runs:undefined}));
