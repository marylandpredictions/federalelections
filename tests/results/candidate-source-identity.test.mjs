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
