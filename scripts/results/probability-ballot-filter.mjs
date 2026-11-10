import {matchBallotCandidate} from './candidate-roster.mjs';

const writeInLabel = /^(?:total[-\s]?write[-\s]?ins?|write[-\s]?ins?)$/i;

// Anonymous provider write-in aggregates are ballot accounting, not a named
// reviewed candidate, unless the local roster explicitly includes them.
export function isAnonymousWriteInAggregate(candidate) {
  return writeInLabel.test(String(candidate?.name || '').trim());
}

export function namedProviderCandidates(candidates, roster) {
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(candidate => {
    if (!candidate?.writeIn && !isAnonymousWriteInAggregate(candidate)) return true;
    try {
      matchBallotCandidate(candidate, roster);
      return true;
    } catch {
      return false;
    }
  });
}
