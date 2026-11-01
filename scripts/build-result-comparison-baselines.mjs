// Build public-board comparisons only from retained, source-backed returns.
// Legacy forecast baselines stay untouched; forecast margins never become votes.
import {pathToFileURL} from 'node:url';
import {expandComparisons} from './results/expand-comparisons.mjs';
export {expandComparisons};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)expandComparisons();
