import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseDelimited} from './csv.mjs';

const cycles=[
  {year:2008,source:'https://sos.ga.gov/sites/default/files/2022-01/december_2008_generalelectionrunoff_totals.pdf',
    general:[1757393,1867097],runoff:[909923,1228033],firstRoundTotal:3752485,
    names:['Jim Martin','Saxby Chambliss']},
  {year:2020,source:'https://www.fec.gov/resources/cms-content/documents/federalelections2020.pdf',
    general:[2374519,2462617],runoff:[2269923,2214979],firstRoundTotal:4952175,
    names:['Jon Ossoff','David A. Perdue']},
  {year:2022,source:'https://www.fec.gov/resources/cms-content/documents/federalelections2022.pdf',
    general:[1946117,1908442],runoff:[1820633,1721244],firstRoundTotal:3935924,
    names:['Raphael Warnock','Herschel Walker']},
];
const archive='https://raw.githubusercontent.com/openelections/openelections-data-ga/36b7453793848c02d8f41601d9304a66ad828dd0/';
const files={
  '2008-general':['2008/20081104__ga__general.csv','a27e52dfbaae0c95f4ecbea7090446031ef4c9521ef820ca56b3b955b3ebd930'],
  '2008-runoff':['2008/20081202__ga__general__runoff.csv','9304ac3681ce2e13ae50568b5961c68a4d243e550c9deeea2a67bd0e52751ad4'],
  '2022-general':['2022/20221108__ga__general__precinct.csv','569950156853072db61d0a8e0e9436e0f93499a9438a99084de95da643c3b9f9'],
  '2022-runoff':['2022/20221206__ga__general_runoff__precinct.csv','956f46dbae2bc5bc2728be691e04e99121cec72fccdd4bf2f39eb016c949c129'],
};
const modes=['election_day_votes','advanced_votes','absentee_by_mail_votes','provisional_votes'];
const sum=values=>values.reduce((total,value)=>total+value,0);
const margin=([d,r])=>100*(d-r)/(d+r);
const average=values=>sum(values)/values.length;
const count=value=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;

function transfer(counts,earlier,runoff) {
  return counts.map((value,index)=>value*runoff[index]/earlier[index]);
}

export function scoreGeorgiaRunoffs(records=cycles) {
  return records.slice(1).map((record,index)=>{
    const history=records.slice(0,index+1);
    if (history.some(earlier=>earlier.year>=record.year)) throw Error('Runoff analogs must predate the scored election');
    const analogs=history.map(earlier=>({year:earlier.year,
      ...forecastSummary(transfer(record.general,earlier.general,earlier.runoff))}));
    return {year:record.year,source:record.source,baselineMargin:margin(record.general),
      actual:forecastSummary(record.runoff),analogs,meanAnalogMargin:average(analogs.map(row=>row.margin))};
  });
}

function forecastSummary(votes) {
  return {margin:margin(votes),turnout:sum(votes)};
}

async function counties(directory,year,phase,countyNames) {
  const key=year+'-'+phase,[url,digest]=files[key];
  const data=await readFile(join(directory,'probability-ga-'+key+'.csv'));
  if (createHash('sha256').update(data).digest('hex')!==digest) throw Error('Georgia archive checksum mismatch: '+url);
  const {names,[phase]:certified,firstRoundTotal}=cycles.find(row=>row.year===year);
  const totals=new Map(), seen=new Set();
  let allVotes=0;
  for (const row of parseDelimited(data.toString())) {
    if (row.office!=='U.S. Senate') continue;
    const name=row.candidate.replace(/(?: \(I\))? \((?:Dem|Rep)\)$/,'');
    const label=row.county.trim().toUpperCase(), fips=countyNames.get(label);
    const rowId=JSON.stringify([fips,row.precinct,name]);
    const votes=row.votes===undefined?sum(modes.map(mode=>count(row[mode]))):count(row.votes);
    if (!fips||seen.has(rowId)||!Number.isSafeInteger(votes)) throw Error('Unexpected Georgia source row in '+key);
    seen.add(rowId);
    allVotes+=votes;
    if (!totals.has(fips)) totals.set(fips,[0,0]);
    const position=names.indexOf(name);
    if (position>=0) totals.get(fips)[position]+=votes;
  }
  if (totals.size!==countyNames.size||allVotes!==(phase==='general'?firstRoundTotal:sum(certified))||
      certified.some((votes,i)=>votes!==sum([...totals.values()].map(row=>row[i])))) {
    throw Error('Georgia county votes do not match certified statewide controls: '+key);
  }
  return totals;
}

async function countyTest(directory) {
  const countyFile=JSON.parse(await readFile('data/baselines/pres-2024-counties.json','utf8'));
  const names=new Map(countyFile.rows.filter(row=>row.state==='GA').map(row=>[row.county.toUpperCase(),row.fips]));
  if (names.size!==159||new Set(names.values()).size!==159) throw Error('Invalid Georgia county index');
  const [before,after,holdout,actual]=await Promise.all([
    counties(directory,2008,'general',names),counties(directory,2008,'runoff',names),
    counties(directory,2022,'general',names),counties(directory,2022,'runoff',names)
  ]);
  const predicted=[0,0],errors=[];
  for (const [id,input] of holdout) {
    if (before.get(id).some(value=>!value)) throw Error('Undefined historical county ratio');
    const estimate=transfer(input,before.get(id),after.get(id));
    for (let i=0;i<predicted.length;i++) predicted[i]+=estimate[i];
    errors.push({baseline:Math.abs(margin(input)-margin(actual.get(id))),
      forecast:Math.abs(margin(estimate)-margin(actual.get(id)))});
  }
  return {counties:errors.length,baseline:forecastSummary(cycles[2].general),
    estimate:forecastSummary(predicted),actual:forecastSummary(cycles[2].runoff),
    countyMarginMae:{baseline:average(errors.map(row=>row.baseline)),forecast:average(errors.map(row=>row.forecast))}};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const directory=process.argv[2];
  console.log(JSON.stringify({status:'research-only-runoff',statewide:scoreGeorgiaRunoffs(),
    ...(directory?{countySource:archive,county2008To2022:await countyTest(directory)}:{})},null,2));
}
