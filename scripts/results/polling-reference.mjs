// Descriptive simple averages, NOT VoteHub's proprietary published average or
// a forecast. Match both ballot candidates and exact office/geography first.
import {readFileSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
import {NbcProvider} from './nbc-provider.mjs';
const types={house:'us-representative',senate:'us-senator',governor:'governor'};
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function pollingReference(races,polls,{asOf='2026-11-03'}={}){
 const cutoff=Date.parse(asOf)-30*86400000,rows={};
 for(const race of races){
  const subject=`2026 ${race.state}-${String(race.district).padStart(2,'0')}`;
  const stateName=states[race.state];
  const wanted=race.type==='house'?subject:`2026 ${stateName}`;
  const parties=race.candidates||[],dem=parties.filter(c=>(c.partyCode||c.party)==='D'),rep=parties.filter(c=>(c.partyCode||c.party)==='R');
  // Do not guess a nominee in jungle elections or a crowded same-party race.
  const left=dem.length===1?dem:dem.length===0?parties.filter(c=>(c.partyCode||c.party)==='I'):[];
  if(left.length!==1||rep.length!==1)continue;
  const pair=[left[0],rep[0]],byPollster=new Map();
  for(const p of polls){
   if(p.poll_type!==types[race.type]||p.subject!==wanted||p.internal===true||!['lv','rv'].includes(p.population)||!p.pollster||!p.id||!Array.isArray(p.answers)||!/^\d{4}-\d{2}-\d{2}$/.test(p.end_date)||Date.parse(p.end_date)<cutoff||p.end_date>asOf)continue;
   const answers=pair.map(c=>p.answers.filter(a=>normalize(a.choice)===normalize(c.name)||normalize(a.choice)===normalize(c.providerName)));
   if(answers.some(a=>a.length!==1||typeof a[0].pct!=='number'||!Number.isFinite(a[0].pct)||a[0].pct<0||a[0].pct>100)||answers.reduce((n,a)=>n+a[0].pct,0)>100.2)continue;
   const key=normalize(p.pollster),old=byPollster.get(key);
   if(!old||p.end_date>old.poll.end_date||p.end_date===old.poll.end_date&&p.population==='lv'&&old.poll.population!=='lv')byPollster.set(key,{poll:p,values:answers.map(a=>a[0].pct)});
  }
  const selected=[...byPollster.values()];if(selected.length<2)continue;
  rows[race.id]={candidates:pair.map((c,i)=>({name:c.name,party:c.partyCode||c.party,percent:Number((selected.reduce((n,p)=>n+p.values[i],0)/selected.length).toFixed(1))})),pollCount:selected.length,latestPoll:selected.map(p=>p.poll.end_date).sort().at(-1),pollIds:selected.map(p=>p.poll.id)};
 }
 return {asOf,source:'VoteHub public polling API',sourceUrl:'https://votehub.com/polls/api/',license:'CC BY 4.0',label:'FEA simple polling average',method:'Unweighted mean of the latest eligible poll from each pollster in the past 30 days; LV/RV, excludes internal polls, minimum two pollsters, exact ballot matchup. This is not VoteHub’s published weighted average or a prediction.',races:rows};
}
const states={};
Object.assign(states,{AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const config=JSON.parse(readFileSync('data/results-provider.json','utf8')),catalogue=JSON.parse(readFileSync('data/election-night-races.json','utf8')).races;
  const races=await new NbcProvider({sources:config.sources}).fetchResults(catalogue),polls=[];
  for(const type of Object.values(types)){const r=await fetch(`https://api.votehub.com/polls?poll_type=${type}&subject=2026&from_date=2026-10-04`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`VoteHub HTTP ${r.status}`);const body=await r.text();if(body.length>5000000)throw Error('Oversized polling response');const data=JSON.parse(body);if(!Array.isArray(data))throw Error('Unexpected VoteHub schema');polls.push(...data);}
  const result=pollingReference(races,polls);writeFileSync('data/results/polling-reference.json',JSON.stringify(result,null,2)+'\n');console.log(`Polling reference: ${Object.keys(result.races).length} matched races; ${result.asOf}`);
 }catch(e){console.error(e.message);process.exitCode=1;}
}
