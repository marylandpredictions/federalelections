import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

function choice(ranks,active,disabled) {
  let skipped=0;
  const seen=new Set();
  for (const rank of ranks) {
    // In the official replay, repeated rankings of an eliminated candidate
    // do not fill a skipped rank. An overvote still ends the ballot.
    if (rank.every(id=>seen.has(id))) {
      if (++skipped===2) return null;
      continue;
    }
    skipped=0;
    const marked=rank.filter(id=>!disabled.has(id));
    if (marked.length>1) return null;
    if (active.has(marked[0])) return marked[0];
    for (const id of rank) seen.add(id);
  }
  return null;
}

export function replayAlaskaRanked(input,{unresolvedWriteIns=[]}={}) {
  const {candidates,patterns}=input;
  const ids=Object.keys(candidates).map(Number);
  const disabled=new Set(ids.filter(id=>candidates[id].disabled));
  const writeIns=new Set(unresolvedWriteIns);
  if (unresolvedWriteIns.some(id=>!candidates[id]?.writeIn)) throw Error('Write-in control does not match this export');
  if (ids.some(id=>candidates[id].writeIn&&!disabled.has(id)&&!writeIns.has(id))) {
    return {status:'write-ins-require-official-resolution'};
  }
  const active=new Set(ids.filter(id=>!disabled.has(id)&&!writeIns.has(id)));
  if (active.size<2||!Array.isArray(patterns)||!patterns.length) throw Error('Invalid Alaska ranked ballot export');
  for (const {ranks,count} of patterns) {
    if (!Array.isArray(ranks)||ranks.length<2||!Number.isSafeInteger(count)||count<=0||
        ranks.some(rank=>!Array.isArray(rank)||new Set(rank).size!==rank.length||rank.some(id=>!ids.includes(id))))
      throw Error('Invalid rank pattern');
  }
  const ballotCount=patterns.reduce((total,pattern)=>total+pattern.count,0);
  if (!Number.isSafeInteger(ballotCount)||ballotCount!==input.ballots) throw Error('Ranked ballot counts do not reconcile');
  const rounds=[];
  while (active.size>=2) {
    const votes=new Map([...active].map(id=>[id,0]));
    for (const pattern of patterns) {
      const id=choice(pattern.ranks,active,disabled);
      if (id!==null) votes.set(id,votes.get(id)+pattern.count);
    }
    const ranked=[...votes].sort(([,a],[,b])=>b-a);
    const continuing=ranked.reduce((total,[,n])=>total+n,0);
    const round={votes:Object.fromEntries(votes),continuing,inactive:ballotCount-continuing};
    rounds.push(round);
    if (!continuing) return {status:'no-continuing-votes',ballots:ballotCount,rounds};
    const [leader,lead]=ranked[0];
    if (rounds.length===1&&lead>continuing/2||active.size===2&&lead>ranked[1][1])
      return {status:'replayed-scanned-ballots',ballots:ballotCount,winner:leader,rounds};
    if (ranked.at(-2)[1]===ranked.at(-1)[1]) return {status:'tie-requires-official-resolution',ballots:ballotCount,rounds};
    round.eliminated=ranked.at(-1)[0];
    active.delete(round.eliminated);
  }
  throw Error('Unable to replay ranked count');
}

export function verifyAlaskaReplay(input,control) {
  if (control.archiveSha256!==input.archiveSha256||control.electionId!==input.electionId||control.contestId!==input.contestId) {
    throw Error('Official control does not match this ballot archive and contest');
  }
  const replay=replayAlaskaRanked(input,{unresolvedWriteIns:control.unresolvedWriteIns});
  if (replay.winner!==control.winner||replay.rounds?.length!==control.rounds.length) {
    throw Error('Ranked outcome does not match the official control');
  }
  for (const [index,actual] of replay.rounds.entries()) {
    const expected=control.rounds[index];
    if (actual.continuing!==expected.continuing||actual.eliminated!==expected.eliminated||
        Object.keys(actual.votes).length!==Object.keys(expected.votes).length||
        Object.entries(expected.votes).some(([id,votes])=>actual.votes[id]!==votes)) {
      throw Error(`Ranked round ${index+1} does not match the official control`);
    }
  }
  return replay;
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]||!process.argv[3]) {
    throw Error('Usage: probability-ranked-replay.mjs <Alaska aggregate rank patterns> <official control>');
  }
  const input=JSON.parse(await readFile(process.argv[2],'utf8'));
  const control=JSON.parse(await readFile(process.argv[3],'utf8'));
  console.log(JSON.stringify(verifyAlaskaReplay(input,control),null,2));
}
