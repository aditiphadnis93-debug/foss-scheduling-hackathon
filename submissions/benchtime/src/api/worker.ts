// A simulation worker: runs one seed at a time for the pool (src/api/pool.ts). Each worker loads the court
// once and keeps it, so a batch of seeds costs one roster load per worker.

import { runSeed, type SeedJob } from "./runner";

declare const self: Worker;

self.onmessage = (e: MessageEvent<{ id: number; job: SeedJob }>) => {
  const { id, job } = e.data;
  try {
    self.postMessage({ id, result: runSeed(job) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
