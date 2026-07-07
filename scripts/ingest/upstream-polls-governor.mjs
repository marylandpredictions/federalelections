import { ingestPollCache } from "./upstream-polls-shared.mjs";

ingestPollCache({
  office: "governor",
  sourcePath: "data/cache/polls/governor-2026.json",
  outputPath: "data/staging/polls/raw/governor-2026.json"
});
