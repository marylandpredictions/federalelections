import { ingestPollCache } from "./upstream-polls-shared.mjs";

ingestPollCache({
  office: "house",
  sourcePath: "data/cache/polls/house-2026.json",
  outputPath: "data/staging/polls/raw/house-2026.json"
});
