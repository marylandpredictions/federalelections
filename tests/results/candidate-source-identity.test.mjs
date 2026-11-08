import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchBallotCandidate} from '../../scripts/results/candidate-roster.mjs';
import {parseNbcCounties} from '../../scripts/results/nbc-counties.mjs';

test('Candidate identity retains verified source names across repeated matching and rejects collisions',()=>{
  const roster=[{id:'d',name:'Canonical Ballot Name',partyCode:'D',providerName:'NBC Source Name',
    aliases:['Reviewed Alias']},{id:'r',name:'Other Ballot Name',partyCode:'R'}];
  const first=matchBallotCandidate({name:'NBC Source Name',partyCode:'D'},roster);
  const second=matchBallotCandidate({name:'NBC Source Name',partyCode:'D'},[first,roster[1]]);
  assert.equal(second.name,roster[0].name);
  assert.deepEqual(second.aliases,roster[0].aliases);
  assert.equal(matchBallotCandidate({name:'Reviewed Alias'},[second]).name,roster[0].name);
  assert.throws(()=>matchBallotCandidate({name:'NBC Source Name',partyCode:'R'},roster),/party mismatch/);
  assert.throws(()=>matchBallotCandidate({name:'NBC Source Name'},[...roster,
    {name:'Different Candidate',providerName:'NBC Source Name'}]),/Ambiguous/);
});

test('Omitted full middle names require unique first/last identity and compatible suffixes',()=>{
 const roster=[{name:'Maria Elvira Salazar',party:'R'},{name:'Melanie Ann Stansbury',party:'D'}];
 assert.equal(matchBallotCandidate({name:'Maria Salazar',partyCode:'R'},roster).name,roster[0].name);
 assert.equal(matchBallotCandidate({name:'Melanie Stansbury',partyCode:'D'},roster).name,roster[1].name);
 assert.throws(()=>matchBallotCandidate({name:'Maria Salazar'},[...roster,{name:'Maria Teresa Salazar'}]),/Ambiguous/);
 assert.throws(()=>matchBallotCandidate({name:'Maria Teresa Salazar'},roster),/Unknown/);
 assert.throws(()=>matchBallotCandidate({name:'Maria Salazar Sr.'},[{name:'Maria Elvira Salazar Jr.'}]),/Unknown/);
 assert.throws(()=>matchBallotCandidate({name:'Mary Salazar'},roster),/Unknown/);
 assert.throws(()=>matchBallotCandidate({name:'Maria Salazar',partyCode:'D'},roster),/party mismatch/);
});

test('Verified nickname aliases match NBC spellings in either direction without inventing surnames',()=>{
  const catalogue=JSON.parse(readFileSync(new URL('../../data/election-night-races.json',import.meta.url),'utf8')).races;
  const cases=[
    ['house-IL-11','Jeffrey Walter','Jeff Walter','R'],
    ['house-KY-1','Drew Williams','John Williams','D'],
    ['house-TX-12','Heli Rodriguez Prilliman','Angela Rodriguez Prilliman','D'],
    ['house-FL-24','Te Brown','Te Brown','R'],
    ['governor-HI','Joshua Green','Josh Green','D'],
  ];
  for(const [id,localName,providerName,party]of cases){
    const race=catalogue.find(row=>row.id===id);
    const local=race.candidates.find(row=>row.name===localName);
    assert.ok(local,id+' missing local name');
    assert.equal(matchBallotCandidate({name:providerName,partyCode:party},race.candidates).name,localName);
    assert.equal(matchBallotCandidate({name:localName,aliases:local.aliases,partyCode:party},
      [{name:providerName,partyCode:party}]).name,providerName);
  }
  assert.throws(()=>matchBallotCandidate({name:'Drew Williams'},[{name:'John Smith',partyCode:'D'}]),/Unknown/);
});

test('NBC county counts accept the verified source spelling retained by the race roster',()=>{
  const data=JSON.parse(readFileSync('tests/fixtures/nbc-counties-2026.json','utf8')).co;
  const candidates=data.races[0].summary.candidates.map((candidate,index)=>({
    name:index===0?'Reviewed ballot spelling':candidate.name,
    ...(index===0?{providerName:candidate.name}:{}),
  }));
  const race={id:'senate-CO',state:'CO',type:'senate',candidates};
  const rows=parseNbcCounties(data,race);
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.candidates.some(c=>c.name==='Reviewed ballot spelling')));
  delete candidates[0].providerName;
  assert.throws(()=>parseNbcCounties(data,race),/No healthy NBC county results/);
});
