import { ingestPollCache } from "./upstream-polls-shared.mjs";

ingestPollCache({
  office: "senate",
  sourcePath: "data/cache/polls/senate-2026.json",
  outputPath: "data/staging/polls/raw/senate-2026.json"
});
