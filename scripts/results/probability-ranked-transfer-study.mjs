import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const validCount=value=>Number.isSafeInteger(value)&&value>=0;
const sum=counts=>counts.reduce((total,count)=>total+count,0);
const margin=([a,b])=>100*(a-b)/(a+b);

export function assessAlaskaTransfer({training,evaluation}) {
  const names=Object.keys(training.transfers).sort();
  const {eliminated,countsBeforeTransfer,countsAfterTransfer}=evaluation;
  const cutoff=Date.parse(evaluation.electionDate);
  const trainedAt=Date.parse(training.availableAt);
  if (!Number.isFinite(trainedAt)||!Number.isFinite(cutoff)||trainedAt>=cutoff||
      names.length!==2||names.includes(eliminated)||training.eliminated!==eliminated||
      Object.keys(countsBeforeTransfer).length!==3||Object.keys(countsAfterTransfer).length!==2) {
    throw Error('Transfer benchmark requires an earlier source and the same named candidates');
  }
  const transfers=names.map(name=>training.transfers[name]);
  const before=names.map(name=>countsBeforeTransfer[name]);
  const actual=names.map(name=>countsAfterTransfer[name]);
  const available=countsBeforeTransfer[eliminated];
  if (![...transfers,...before,...actual,available,training.ballots,training.inactive].every(validCount)||
      !training.ballots||!sum(before)||sum(transfers)+training.inactive!==training.ballots||
      actual.some((count,index)=>count<before[index])||sum(actual)-sum(before)>available) {
    throw Error('Transfer benchmark counts do not reconcile');
  }
  const predicted=before.map((count,index)=>count+available*transfers[index]/training.ballots);
  return {
    status:'retrospective-transfer-sensitivity',
    marginPositiveFor:names[0],
    actualMargin:margin(actual),
    earlierTransferMargin:margin(predicted),
    beforeTransferMargin:margin(before),
    earlierTransferError:Math.abs(margin(predicted)-margin(actual)),
    beforeTransferError:Math.abs(margin(before)-margin(actual))
  };
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const path=new URL('../../data/results/probability-alaska-house-transfer-controls.json',import.meta.url);
  console.log(JSON.stringify(assessAlaskaTransfer(JSON.parse(await readFile(path,'utf8'))),null,2));
}
