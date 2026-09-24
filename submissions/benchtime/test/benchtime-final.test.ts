// benchtime_final is the tournament's pick: the frozen genome (src/planner/zoo/final.ts) matches
// out/tournament/winner.json, the registry builds it with the genome's own configuration, and the CLI
// arena path runs it exactly as the tournament's worker ran the genome.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { runArena } from "../src/eval/arena";
import { POLICIES, POLICY_IDS, defaultConfig } from "../src/planner/index";
import { describeGenome, genomeConfig } from "../src/planner/zoo";
import { BENCHTIME_FINAL_GENOME, BENCHTIME_FINAL_SOURCE } from "../src/planner/zoo/final";
import { validate } from "../src/planner/zoo/genome";
import { evaluate, flatten } from "../scripts/tournament-worker";

const WINNER = new URL("../out/tournament/winner.json", import.meta.url).pathname;
const ROSTER = new URL("../data/roster_3000_seed42.csv", import.meta.url).pathname;

describe("benchtime_final", () => {
  test("the frozen genome matches out/tournament/winner.json", () => {
    // the package may ship without out/; the frozen file is then the record
    if (!existsSync(WINNER)) return;
    const w = JSON.parse(readFileSync(WINNER, "utf8")) as { name: string; genome: Parameters<typeof validate>[0] };
    expect(validate(BENCHTIME_FINAL_GENOME)).toEqual(validate(w.genome));
    expect(BENCHTIME_FINAL_SOURCE.name as string).toBe(w.name);
  });

  test("registered with the genome's own configuration; the overnight benchtime stays", () => {
    expect(POLICY_IDS).toContain("benchtime_final");
    expect(POLICY_IDS).toContain("benchtime");
    const p = POLICIES.benchtime_final!();
    expect(p.id).toBe("benchtime_final");
    expect(p.description).toBe(describeGenome(validate(BENCHTIME_FINAL_GENOME)));
    expect(p.asksCheckin).toBe(validate(BENCHTIME_FINAL_GENOME).checkin);
    expect(defaultConfig("benchtime_final")).toEqual(genomeConfig(validate(BENCHTIME_FINAL_GENOME)));
    expect(POLICIES.benchtime!().id).toBe("benchtime");
  });

  test(
    "the CLI arena path runs it exactly as the tournament ran the genome (seed 1)",
    () => {
      const [run] = runArena({ rosters: [{ id: "roster_3000_seed42", path: ROSTER }], policies: ["benchtime_final"], seeds: [1], start: "2026-10-01", end: "2026-12-15" });
      const fromTournament = evaluate({ key: "benchtime_final", seed: 1, genome: BENCHTIME_FINAL_GENOME });
      expect(flatten(run!.scorecards)).toEqual(fromTournament);
    },
    120_000,
  );
});
