const rules=new Set(['plurality','ranked-choice','majority-runoff','legislative-contingency']);

// Classify simulated first-count ballots without inventing later preferences
// or a separate election. The denominator is supplied by the rule-specific
// evidence adapter, because first-choice candidate votes may omit ballots that
// still count toward the threshold or can transfer in a later round.
export function firstCountOutcome(rule,votes,majorityDenominator) {
  const rows=Object.entries(votes??{});
  if (!rules.has(rule)||rows.length<2||rows.some(([id,value])=>!id||!Number.isFinite(value)||value<0))
    throw Error('Invalid first-count outcome inputs');
  const total=rows.reduce((sum,[,value])=>sum+value,0);
  if (!Number.isFinite(total)||total<=0) throw Error('No first-count votes');
  const ranked=rows.sort(([,left],[,right])=>right-left);
  const [leader,lead]=ranked[0];
  if (rule==='plurality') {
    const possible=ranked.filter(([,value])=>value===lead).map(([id])=>id);
    return possible.length===1?{status:'winner',winner:leader}:{status:'tie',possible};
  }
  if (!Number.isFinite(majorityDenominator)||majorityDenominator<total)
    throw Error('Official first-round majority denominator required');
  if (lead>majorityDenominator/2) return {status:'winner',winner:leader};
  if (rule==='ranked-choice') return {status:'transfers-required',possible:ranked.map(([id])=>id)};
  const runoff=rule==='majority-runoff',cutoff=ranked[Math.min(ranked.length,runoff?2:3)-1][1];
  return {status:runoff?'runoff-required':'legislative-choice-required',
    possible:ranked.filter(([,value])=>value>=cutoff).map(([id])=>id)};
}

// This is partial identification of simulated outcomes. Probability mass in
// draws that need a later stage must stay unresolved.
export function firstCountBounds(rule,draws) {
  if (!Array.isArray(draws)||!draws.length) throw Error('Missing first-count simulations');
  const roster=Object.keys(draws[0].votes??{}).sort();
  const lower=new Map(roster.map(id=>[id,0])),upper=new Map(lower);
  let unresolved=0;
  for (const {votes,majorityDenominator} of draws) {
    if (JSON.stringify(Object.keys(votes??{}).sort())!==JSON.stringify(roster))
      throw Error('First-count simulations have different ballots');
    const result=firstCountOutcome(rule,votes,majorityDenominator);
    if (result.status==='winner') {
      lower.set(result.winner,lower.get(result.winner)+1);
      upper.set(result.winner,upper.get(result.winner)+1);
    } else {
      unresolved++;
      for (const id of result.possible) upper.set(id,upper.get(id)+1);
    }
  }
  return {status:'research-bounds',unresolved:unresolved/draws.length,
    candidates:roster.map(id=>({id,lower:lower.get(id)/draws.length,upper:upper.get(id)/draws.length}))};
}
