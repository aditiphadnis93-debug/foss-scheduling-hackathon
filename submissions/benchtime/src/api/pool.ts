// Seeds run in parallel on a small pool of workers (each seed is independent: rule 2 keys every draw on the
// seed, never on what another run did). The machine is shared, so the pool is modest: BENCHTIME_WORKERS
// sets its size (0 runs everything in this process, which is what the tests use).

import { cpus } from "node:os";
import { runSeed, type SeedJob, type SeedResult } from "./runner";

type Pending = { resolve: (r: SeedResult) => void; reject: (e: Error) => void };
interface Slot {
  worker: Worker;
  /** the job id running on this worker, or null when idle */
  current: number | null;
}

/** read when first needed, so a test can set BENCHTIME_WORKERS before any run */
export function poolSize(): number {
  const env = process.env.BENCHTIME_WORKERS;
  if (env !== undefined && env !== "") return Math.max(0, Math.floor(Number(env)) || 0);
  return Math.max(1, Math.min(4, cpus().length - 2));
}

let slots: Slot[] | null = null;
const queue: { id: number; job: SeedJob }[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;

function spawn(slot: Slot): void {
  const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
  worker.onmessage = (e: MessageEvent<{ id: number; result?: SeedResult; error?: string }>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    slot.current = null;
    if (p) {
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result!);
    }
    pump();
  };
  worker.onerror = (e) => {
    // a crashed worker fails the job it was running; a fresh worker takes its place
    const id = slot.current;
    slot.current = null;
    if (id !== null) {
      pending.get(id)?.reject(new Error(e.message || "simulation worker failed"));
      pending.delete(id);
    }
    worker.terminate();
    spawn(slot);
    pump();
  };
  // idle workers must not keep the process alive
  (worker as unknown as { unref?: () => void }).unref?.();
  slot.worker = worker;
}

function start(): Slot[] {
  if (slots) return slots;
  slots = [];
  for (let i = 0, n = poolSize(); i < n; i++) {
    const slot = { current: null } as unknown as Slot;
    spawn(slot);
    slots.push(slot);
  }
  return slots;
}

function pump(): void {
  for (const s of slots ?? []) {
    if (s.current !== null || queue.length === 0) continue;
    const q = queue.shift()!;
    s.current = q.id;
    s.worker.postMessage(q);
  }
}

/** Run every job; results come back in the order of the jobs. */
export async function runJobs(jobs: SeedJob[]): Promise<SeedResult[]> {
  if (poolSize() === 0) {
    const out: SeedResult[] = [];
    for (const j of jobs) {
      out.push(runSeed(j));
      // let the server answer other requests between seeds
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }
  start();
  return Promise.all(
    jobs.map(
      (job) =>
        new Promise<SeedResult>((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          queue.push({ id, job });
          pump();
        }),
    ),
  );
}

export function stopPool(): void {
  for (const s of slots ?? []) s.worker.terminate();
  slots = null;
}
