import { genericName, matchBallotCandidate } from './candidate-roster.mjs';

const party = candidate => candidate.partyCode || candidate.party || '';
const describe = candidate => ({
  id:candidate.id, name:candidate.name, party:party(candidate), votes:candidate.votes,
});
const aggregate = /^(?:total\s+)?write[ -]?ins?$/i;

export function reviewPublicRoster(base, row, config) {
  const issues = [], differences = [], matched = new Map(), ids = new Set();
  const candidates = row?.candidates;
  const calls = row?.calls ?? [];
  const source = row?.providerScope==='national' && row.provider==='NBC' &&
    config.sources?.some(source=>source.format==='nbc-national-v2' && source.url===row.sourceUrl &&
      source.races?.some(mapping=>mapping.feaRaceId===base.id && String(mapping.providerRaceId)===String(row.providerRaceId))) ||
    row?.providerScope==='civic-fallback' && row.provider==='CivicAPI' &&
    config.fallback?.enabled && config.fallback.races?.some(mapping=>mapping.feaRaceId===base.id &&
      String(mapping.civicRaceId)===String(row.providerRaceId) && row.sourceUrl===`https://civicapi.org/api/v2/race/${mapping.civicRaceId}`);
  const trusted = Boolean(source && row.electionDate==='2026-11-03' &&
    Number.isFinite(Date.parse(row.lastUpdated || row.updatedAt)));
  if (!Array.isArray(candidates) || !candidates.length || !Array.isArray(calls))
    return {issues:['Missing candidate or malformed call records'],differences,reviewed:base.candidates.map(describe),reported:[]};
  if (row.id!==base.id || row.type!==base.type || row.state!==base.state)
    issues.push('Public race identity differs from the catalogue');
  if (['national','civic-fallback'].includes(row.providerScope) && !trusted)
    issues.push('Reported roster lacks a verified source mapping or timestamp');
  const published = calls.filter(call=>!call?.retracted);
  const winner = published[0]?.candidate;
  if (published.length>1 || published.some(call=>!call?.candidate ||
    !['projected','winner'].includes(call.status) || !Number.isFinite(Date.parse(call.calledAt)) ||
    candidates.filter(candidate=>candidate?.name===call.candidate).length!==1) ||
    (row.status==='called')!==Boolean(winner)) issues.push('Published call and reported winner do not agree');
  let total = 0, aggregates = 0;
  for (const candidate of candidates) {
    if (!candidate || genericName(candidate.name) || candidate.placeholder || !candidate.id ||
      !party(candidate) || !Number.isSafeInteger(candidate.votes) || candidate.votes<0) {
      issues.push('Invalid public candidate identity or vote count');
      continue;
    }
    total += candidate.votes;
    if (ids.has(String(candidate.id))) issues.push('Duplicate public candidate ID: '+candidate.id);
    ids.add(String(candidate.id));
    const called = winner===candidate.name;
    if (Boolean(candidate.isWinner)!==called || Boolean(candidate.winner)!==called)
      issues.push('Candidate winner flags disagree with published call: '+candidate.name);
    try {
      const identity = matchBallotCandidate({...candidate,partyCode:party(candidate)},base.candidates);
      if (matched.has(identity.name)) issues.push('Duplicate reviewed identity: '+identity.name);
      matched.set(identity.name,candidate);
      if (identity.name!==candidate.name || (candidate.providerName && candidate.providerName!==identity.name))
        differences.push({kind:'verified-alias',reviewed:identity.name,candidate:describe(candidate),called});
    } catch (error) {
      const writeIn = trusted && error.message.startsWith('Unknown provider candidate:') &&
        aggregate.test(candidate.name.trim()) && ['W','WI','WRITE-IN','O'].includes(party(candidate).toUpperCase()) &&
        !called && ++aggregates===1;
      differences.push({kind:writeIn?'provider-write-in-aggregate':'needs-review',reason:error.message,candidate:describe(candidate),called});
      if (!writeIn) issues.push(error.message);
    }
  }
  if (!Number.isSafeInteger(total)) issues.push('Unsafe sum of candidate votes');
  for (const candidate of base.candidates.filter(candidate=>!matched.has(candidate.name))) {
    const allowed = trusted && winner!==candidate.name && !candidate.summaryVisible;
    differences.push({kind:allowed?'not-reported-by-provider':'missing-reviewed-candidate',candidate:describe(candidate),called:winner===candidate.name});
    if (!allowed) issues.push('Missing reviewed candidate: '+candidate.name);
  }
  return {issues,differences,reviewed:base.candidates.map(describe),reported:candidates.filter(Boolean).map(describe),published};
}
