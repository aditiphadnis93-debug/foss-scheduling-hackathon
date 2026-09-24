// DIAGNOSTIC: process returns reach the court late (returnReportDelayDays). Winner against today's way, seeds 31-40.
// Only the world's reporting delay changes; the planners are unchanged. Results: out/late-reporting.md.
//   bun run scripts/experiments/late-reporting.ts
import { runArena, worldParams } from "../../src/eval/arena";
import { loadRefTables } from "../../src/data/reference";
import { loadRoster } from "../../src/data/roster";

const ROSTER = new URL("../../data/roster_3000_seed42.csv", import.meta.url).pathname;
const SEEDS = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
const POLICIES = ["status_quo_60", "benchtime_final"] as const;
const base = worldParams(loadRefTables(), loadRoster(ROSTER));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

console.log("delay days | policy | useful a day | merits | dates honoured | dates broken | trips per useful | desk a day | never heard");
for (const lag of [0, 3, 7, 21]) {
  const p = JSON.parse(JSON.stringify(base));
  p.latent = { ...p.latent, returnReportDelayDays: lag };
  const runs = runArena({ rosters: [{ id: "roster_3000_seed42", path: ROSTER }], policies: [...POLICIES], seeds: SEEDS, start: "2026-10-01", end: "2026-12-15", paramsOverride: p });
  for (const id of POLICIES) {
    const mine = runs.filter((r) => r.policyId === id);
    const col = (f: (e: Record<string, number>, nh: number) => number) => mean(mine.map((r) => f(r.scorecards.extra as Record<string, number>, r.scorecards.siddarth.neverHeard)));
    console.log(
      lag, id,
      col((e) => e.substantivePerDay ?? 0).toFixed(2),
      col((e) => (e.disposedVerdict ?? 0) + (e.disposedSettlement ?? 0) + (e.disposedCompounded ?? 0)).toFixed(1),
      col((e) => e.promisesHonouredInclDesk ?? 0).toFixed(3),
      col((e) => e.promisesBroken ?? 0).toFixed(0),
      col((e) => e.tripsPerSubstantive ?? 0).toFixed(2),
      col((e) => e.deskPerDay ?? 0).toFixed(2),
      col((_e, nh) => nh).toFixed(0),
    );
  }
}
