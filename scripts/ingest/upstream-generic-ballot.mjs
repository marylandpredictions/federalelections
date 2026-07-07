import { ingestPollCache } from "./upstream-polls-shared.mjs";

ingestPollCache({
  office: "generic-ballot",
  sourcePath: "data/cache/polls/generic-ballot-2026.json",
  outputPath: "data/staging/polls/raw/generic-ballot-2026.json",
  rowType: "AVERAGE"
});
