// Parse only election-authority certification content. No votes/calls are imported.
import {plain,partyCode} from './ballot-review.mjs';
function add(rows,id,candidate){if(!id||!candidate.name||!candidate.party)throw Error('Incomplete official candidate');(rows[id]||=[]).push(candidate);}
export function coloradoBallots(html){
  if(!/2026 General Election Official Candidate List/.test(html)||!/certified to the counties/.test(html))throw Error('Official Colorado general list missing');
  const rows={};
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    if(/<(?:s|del|strike)\b|text-decoration\s*:\s*line-through/i.test(row[1]))continue;
    const c=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
    if(c.length!==5)continue;
    const id=c[1]==='US Senate'?'senate-CO':c[1]==='Governor'?'governor-CO':c[1]==='US House of Representatives'&&/^\d+$/.test(c[2])?'house-CO-'+Number(c[2]):null;
    if(id)add(rows,id,{name:c[0],party:partyCode(c[3]),partyLabel:c[3],writeIn:c[4]==='Y'});
  }
  if(Object.keys(rows).length!==10)throw Error('Colorado federal/governor scope incomplete');
  return rows;
}
export function southDakotaBallots(html){
  if(!/2026 General Election Candidate List/.test(html))throw Error('South Dakota election identity missing');
  const rows={};
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const c=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>plain(x[1]));
    const id=c[0]==='United States Senator'?'senate-SD':c[0]==='United States Representative'?'house-SD-AL':c[0]==='Governor and Lieutenant Governor'?'governor-SD':null;
    if(!id||c[13]!=='Active'||c[14]!=='General'||!c[15]?.startsWith('11/3/2026'))continue;
    add(rows,id,{name:c[1].split(/\s*&\s*/)[0],party:({DEM:'D',REP:'R',IND:'I',LIB:'L'})[c[2]]||c[2],partyLabel:c[2]});
  }
  if(Object.keys(rows).length!==3)throw Error('South Dakota scope incomplete');
  return rows;
}
export function californiaBallots(text){
  if(!/General Election - November 3, 2026/.test(text)||!/Official Certified List of Candidates/.test(text))throw Error('California certification identity missing');
  const rows={};let id=null;
  for(const line of text.split(/\r?\n/)){
    const heading=line.trim();
    if(heading==='Governor')id='governor-CA';
    else if(/^United States Representative District \d+$/.test(heading))id='house-CA-'+Number(heading.match(/\d+$/)[0]);
    else if(/^\s{20,}\S/.test(line)&&/^(Lieutenant Governor|Secretary of State|Controller|Treasurer|Attorney General|Insurance Commissioner|Superintendent|Member|State Senate|State Assembly|Board of Equalization|Justices)/.test(heading))id=null;
    const m=line.match(/^\s{2,}(.+?)\s{4,}(Democratic|Republican|No Party Preference|Libertarian|Green)\s*$/);
    if(id&&m)add(rows,id,{name:m[1].replace(/\*$/,'').trim(),party:m[2]==='No Party Preference'?'NP':partyCode(m[2]),partyLabel:m[2]});
  }
  if(Object.keys(rows).length!==53||Object.values(rows).some(c=>c.length!==2))throw Error('California top-two certification incomplete');
  return rows;
}
