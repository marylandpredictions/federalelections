import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {variables,normalizeDemographics} from './build-county-demographics.mjs';
import {summaryVariableName} from './census-summary.mjs';

const base='https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/';
// ACS 2024 district estimates describe the 119th Congress, not redrawn 2026
// districts. Keep old-boundary context explicit; never average county medians.
export const changedStates = new Set(['AL','CA','FL','LA','NC','OH','TN','TX','UT']);
export async function buildHouseDemographics({cache='.runtime/source-audit'}={}) {
  mkdirSync(cache,{recursive:true});
  const provenance=[];
  async function get(name,path) {
    const file=`${cache}/${name}`,url=base+path;
    let bytes;
    if(existsSync(file))bytes=readFileSync(file);
    else {
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error(`Census source failed: ${response.status}`);
      bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length>25000000)throw Error('Unexpectedly large Census one-year table');
      writeFileSync(file,bytes);
    }
    provenance.push({url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    return bytes.toString('utf8').replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/).map(line=>line.split('|'));
  }
  const geos=await get('geos1.txt','documentation/Geos20241YR.txt'),h=geos.shift();
  const rows=new Map(geos.filter(c=>c[h.indexOf('SUMLEVEL')]==='500'&&c[h.indexOf('COMPONENT')]==='00').map(c=>[
    c[h.indexOf('GEO_ID')],{NAME:c[h.indexOf('NAME')],state:c[h.indexOf('STATE')],'congressional district':c[h.indexOf('CDCURR')],abbr:c[h.indexOf('STUSAB')]},
  ]));
  if(rows.size!==437)throw Error(`Expected 437 Census district rows including DC/PR, got ${rows.size}`);
  const tables=[...new Set(variables.filter(v=>v!=='NAME').map(v=>v.split('_')[0]))];
  for(const table of tables) {
    const data=await get(`${table.toLowerCase()}-1.dat`,`data/1YRData/acsdt1y2024-${table.toLowerCase()}.dat`),header=data.shift();
    const cols=header.map((n,i)=>({key:summaryVariableName(n),i})).filter(c=>variables.includes(c.key));
    const wanted=variables.filter(v=>v.startsWith(table+'_'));
    if(cols.length!==wanted.length)throw Error(`Missing district variables in ${table}`);
    for(const cells of data) {const row=rows.get(cells[0]);if(row)for(const col of cols)row[col.key]=cells[col.i];}
  }
  const header=[...variables,'state','congressional district'];
  const normalized=normalizeDemographics([header,...[...rows.values()].map(r=>header.map(k=>r[k]))]);
  const districtGeography={},districts={};
  for(const row of rows.values()) {
    if(['DC','PR'].includes(row.abbr))continue;
    const district=row['congressional district']==='00'?'AL':row['congressional district'];
    const id=`${row.abbr}-${district}`,data=normalized[row.state+row['congressional district']];
    if(!data?.population)throw Error(`Missing district population: ${id}`);
    const geometryFile=`data/maps/congress/119/${id}.json`;
    const hash=createHash('sha256').update(readFileSync(geometryFile)).digest('hex');
    const current=!changedStates.has(row.abbr);
    const geometryId=current?`cd119:${id}:${hash.slice(0,16)}`:null;
    districtGeography[id]={geometryId,congress:119,geometryFile,sha256:hash,currentComparable:current,status:current?'unchanged-119-boundaries':'2026-boundary-review-required'};
    districts[id]={...data,district:id,geometryId,congress:119,boundaryStatus:current?'current-comparable':'historical-boundaries',source:'U.S. Census Bureau, 2024 ACS 1-year estimates',vintage:2024};
  }
  if(Object.keys(districts).length!==435)throw Error('Incomplete House demographics; old output preserved');
  const output={status:'available',vintage:2024,product:'ACS 1-year',congress:119,sourceUrl:'https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.119th_Congress.html',sourceFiles:provenance,variables,districts};
  const bytes=JSON.stringify(output),hash=createHash('sha256').update(bytes).digest('hex').slice(0,12),file=`data/results/district-demographics.${hash}.json.gz`;
  writeFileSync(file,gzipSync(bytes,{level:9}));
  writeFileSync('data/results/district-demographics.min.json',bytes+'\n');
  if(!existsSync('data/results/district-geography.json')||JSON.parse(readFileSync('data/results/district-geography.json','utf8')).congress!==120)writeFileSync('data/results/district-geography.json',JSON.stringify({schemaVersion:1,congress:119,method:'Exact hashes of the displayed Census county-within-CD119 geography. Changed-state districts are not certified as 2026 matches.',changeReviewSource:'https://www.the-downballot.com/p/the-downballot-releases-presidential',reviewRequiredStates:[...changedStates],districts:districtGeography},null,2)+'\n');
  const manifest=JSON.parse(readFileSync('data/results/demographics.json','utf8'));manifest.districtFile=file;
  writeFileSync('data/results/demographics.json',JSON.stringify(manifest)+'\n');
  console.log(`House demographics: 435 profiles; ${Object.values(districts).filter(r=>r.boundaryStatus==='current-comparable').length} current-comparable, ${Object.values(districts).filter(r=>r.boundaryStatus==='historical-boundaries').length} explicitly historical-boundary profiles.`);
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)buildHouseDemographics().catch(e=>{console.error(e.message);process.exitCode=1;});
