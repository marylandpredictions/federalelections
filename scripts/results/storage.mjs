import { join, resolve } from "node:path";
export function resultStorage(
  root = process.cwd(),
  directory = process.env.RESULTS_STORAGE_DIR,
) {
  const durable = directory ? resolve(directory) : null;
  return {
    directory: durable || join(root, ".runtime"),
    state: join(durable || join(root, ".runtime"), "results-state.json"),
    calls: durable
      ? join(durable, "result-calls.json")
      : join(root, "data/result-calls.json"),
    details: durable
      ? join(durable, "race-details")
      : join(root, "data/live-results-races"),
    durable: !!durable,
  };
}
