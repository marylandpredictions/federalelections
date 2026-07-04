import { update270toWinPollingCache } from "./lib/poll-ingest-270towin.mjs";
import { updateRaceToWHPollingCache } from "./lib/poll-ingest-racetowh.mjs";

const sources = [];
sources.push(await update270toWinPollingCache());
sources.push(await updateRaceToWHPollingCache());

console.log(JSON.stringify({
  status: "OK",
  updatedAt: new Date().toISOString(),
  sources: sources.map((source) => ({ rows: source.rows, fetches: source.fetches }))
}, null, 2));
