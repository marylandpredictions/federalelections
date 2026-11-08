import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {matchBallotCandidate} from './candidate-roster.mjs';
import {parseDelimited} from './csv.mjs';
import {countOnlyEstimate,finalResults,readApFullRosterStudy,readNyt2020HouseStudy,readNyt2022FullRosterStudy} from './probability-count-study.mjs';

const observation={
  source:'https://raw.githubusercontent.com/MEDSL/2018-elections-unoffical/036b751504da62d226b40e721dacee7880fc4a59/raw-returns/California.csv',
  at:'2018-11-08T23:07:47Z',
  sha256:'ac823c6d86c0a13a9d0b89435dbff38f25c6c43683298ff8e39b020a5d0cdc94'
};
const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const votes=value=>/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)?Number(value.replace(/,/g,'')):NaN;
const maxHourGap=24;

export function readCaliforniaCheckpoints(rows,truth) {
  const contests=new Map();
  for (const row of rows) {
    if (row['race name']!=='U.S. House of Representatives') continue;
    const district=/^District ([1-9]\d?)$/.exec(row['district name']);
    if (!district||+district[1]>53) throw Error('Invalid California district in archive');
    const id='CA-G-H-'+district[1];
    if (!contests.has(id)) contests.set(id,[]);
    contests.get(id).push(row);
  }
  const hour=(Date.parse(observation.at)-Date.parse('2018-11-06T23:00:00Z'))/3600000;
  return [...contests].flatMap(([id,rows])=>{
    const final=truth.get(id);
    if (!final||final.ballot.length!==2) return [];
    const districtwide=rows.filter(row=>row.county==='Districtwide');
    if (districtwide.length!==2||new Set(districtwide.map(row=>row.party)).size!==2||
        rows.some(row=>!row.county||!districtwide.some(summary=>summary.candidate===row.candidate&&summary.party===row.party))) return [];
    const check=(party,name,limit)=>{
      const summary=districtwide.find(row=>row.party===party);
      if (!summary) return null;
      const units=rows.filter(row=>row.county!=='Districtwide'&&row.candidate===summary.candidate&&row.party===party);
      if (!units.length||new Set(units.map(row=>row.county)).size!==units.length) return null;
      try { matchBallotCandidate({name:summary.candidate},[{name}]); }
      catch { return null; }
      const total=votes(summary.votes);
      return total>0&&total<=limit&&units.reduce((sum,row)=>sum+votes(row.votes),0)===total?total:null;
    };
    const d=check('DEM',final.democrat,final.d),r=check('REP',final.republican,final.r);
    if (d===null||r===null||d+r>=final.total) return [];
    return [{id,office:'house',hour,margin:(d-r)/(d+r),finalMargin:(final.d-final.r)/final.total}];
  });
}

function evaluate(rows,training) {
  const nearest=new Map();
  const target=training[0].hour;
  for (const row of rows) {
    if (row.state!=='CA'||row.office!=='house'||row.roster?.length!==2||Math.abs(row.hour-target)>maxHourGap) continue;
    const d=row.roster.find(candidate=>candidate.party==='D'),r=row.roster.find(candidate=>candidate.party==='R');
    const dObserved=d?.votes??d?.share,rObserved=r?.votes??r?.share;
    if (!(dObserved>0&&rObserved>0)||d.actual===r.actual) continue;
    const margin=(dObserved-rObserved)/(dObserved+rObserved);
    const distance=Math.abs(row.hour-target);
    if (distance<(nearest.get(row.id)?.distance??Infinity)) nearest.set(row.id,{distance,row,d,r,margin});
  }
  const scored=[];
  for (const {row,d,r,margin} of nearest.values()) {
    const actual=(d.actual-r.actual)/(d.actual+r.actual);
    const prediction=countOnlyEstimate({...row,margin},training.filter(point=>point.id!==row.id),{maxHourGap});
    if (!prediction) continue;
    const won=Number(actual>0);
    scored.push({close:Math.abs(margin)<.1,changedLeader:Math.sign(margin)!==Math.sign(actual),
      brier:(prediction.p-won)**2,unchangedBrier:((margin===0?.5:Number(margin>0))-won)**2,
      marginError:Math.abs(prediction.median-actual),unchangedError:Math.abs(margin-actual),
      coverage:Number(prediction.interval80[0]<=actual&&actual<=prediction.interval80[1])});
  }
  const metrics=group=>group.length?{
    races:group.length,changes:group.filter(row=>row.changedLeader).length,
    ...Object.fromEntries(['brier','unchangedBrier','marginError','unchangedError','coverage'].map(key=>[
      key,average(group.map(row=>row[key])),
    ])),
  }:null;
  return {eligible:nearest.size,overall:metrics(scored),close:metrics(scored.filter(row=>row.close))};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [capture,apManifest,nytManifest,directory,olderManifest]=process.argv.slice(2);
  if (!directory) throw Error('Usage: probability-california-count-study.mjs <2018 California CSV> <AP 2024 manifest> <NYT 2022 manifest> <capture directory> [NYT 2020 manifest]');
  const [raw,certified,ap,nyt,older]=await Promise.all([
    readFile(capture),readFile('data/baselines/source/1976-2024-house.tab','utf8'),
    readApFullRosterStudy(apManifest,directory),readNyt2022FullRosterStudy(nytManifest,directory,{requireExpected:false}),
    olderManifest?readNyt2020HouseStudy(olderManifest,directory):null,
  ]);
  if (createHash('sha256').update(raw).digest('hex')!==observation.sha256) throw Error('California archive checksum mismatch');
  const training=readCaliforniaCheckpoints(parseDelimited(raw.toString()),finalResults(parseDelimited(certified),'house','2018'));
  if (!training.length) throw Error('California archive has no reconciled partial D/R returns');
  console.log(JSON.stringify({status:'research-only',observation,training:training.length,
    ...(older?{heldOut2020RoundedShares:evaluate(older,training)}:{}),
    heldOut2022:evaluate(nyt,training),heldOut2024:evaluate(ap,training)},null,2));
}
