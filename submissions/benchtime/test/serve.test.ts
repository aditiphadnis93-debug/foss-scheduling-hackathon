// The engine's HTTP API against the console's own sample responses (web/fixtures/*.json): every field the
// console reads must be there with the same JSON type. Runs in-process (no workers, no port) on fast
// policies where the endpoint has to simulate, so the suite stays quick.

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.BENCHTIME_WORKERS = "0";

import { runArena } from "../src/eval/arena";
import { summarise } from "../src/eval/report";
import { arenaRows, calibrationFromMarkdown } from "../src/api/evidence";
import { POLICY_IDS } from "../src/planner/index";
import { ROSTER_PATH, ROSTER_ID, getEnv } from "../src/api/context";
import { pairedInterval, tInterval } from "../src/api/intervals";
import { freePlan } from "../src/api/plan";
import { runSeed } from "../src/api/runner";
import { stateAt } from "../src/api/state";
import { route } from "../src/serve";

const FIX = join(import.meta.dir, "../web/fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), "utf8"));

// fields API.md documents as nullable, and maps whose keys depend on the data
const NULLABLE = new Set([
  "callTime", "window", "block", "crossesNext", "process", "externalPending", "nextDate", "lastHeardOn", "issuedOn", "daysOut",
  "returnedKnownOn", "since", "readyKnownOn", "nextWorkingDay", "unconstrained", "delta", "nextDateRecommendation", "reason",
  "attendance", "generatedAt", "ablation", "sensitivity", "robustness", "exactVsGreedy", "fillCurve", "calibration",
  "mean", "lo", "hi", // a measure with nothing to measure is null (JSON has no NaN)
]);
const MAPS = new Set(["reasonCounts"]);

const kind = (x: unknown) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);

/** Paths where `ours` lacks a field of `ref` or has another JSON type (arrays compared on their first element). */
function shapeDiff(ref: unknown, ours: unknown, path = "$"): string[] {
  const key = path.split(".").pop()!.replace(/\[0\]$/, "");
  if (ref === null || ref === undefined) return [];
  if (ours === undefined) return [`${path}: missing`];
  if (ours === null) return NULLABLE.has(key) ? [] : [`${path}: null, expected ${kind(ref)}`];
  if (kind(ref) !== kind(ours)) return [`${path}: ${kind(ours)}, expected ${kind(ref)}`];
  if (Array.isArray(ref)) return ref.length && (ours as unknown[]).length ? shapeDiff(ref[0], (ours as unknown[])[0], `${path}[0]`) : [];
  if (typeof ref === "object" && !MAPS.has(key)) {
    const out: string[] = [];
    for (const k of Object.keys(ref as object)) out.push(...shapeDiff((ref as Record<string, unknown>)[k], (ours as Record<string, unknown>)[k], `${path}.${k}`));
    return out;
  }
  return [];
}

async function call(path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const req = new Request(`http://engine${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  const r = await route(req);
  return { status: r.status, json: JSON.parse(await r.text()), headers: r.headers };
}

beforeAll(() => {
  getEnv();
});

describe("intervals", () => {
  test("t interval of the mean and paired differences", () => {
    const iv = tInterval([1, 2, 3, 4, 5]);
    expect(iv.mean).toBe(3);
    // sd = 1.5811, se = 0.7071, t(4) = 2.776
    expect(iv.hi - iv.mean).toBeCloseTo(2.776 * Math.sqrt(2.5 / 5), 4);
    expect(tInterval([7, 7, 7])).toEqual({ mean: 7, lo: 7, hi: 7 });
    expect(tInterval([NaN, NaN]).mean).toBeNaN();
    const d = pairedInterval([1, 2, 3], [2, 4, 6]);
    expect(d.mean).toBe(2);
  });
});

describe("GET /api/meta", () => {
  test("has the console's shape and every policy", async () => {
    const { status, json } = await call("/api/meta");
    expect(status).toBe(200);
    expect(shapeDiff(fixture("meta"), json)).toEqual([]);
    expect(json.policies.map((p: { id: string }) => p.id)).toEqual([...POLICY_IDS]);
    expect(json.horizon.start).toBe("2026-10-01");
    expect(json.horizon.end).toBe("2026-12-15");
    expect(json.court.capacityMinutes).toBe(420);
    expect(json.court.cases).toBe(3000);
    // every measure the sample catalogue has is in ours
    const ids = new Set(json.measures.map((m: { id: string }) => m.id));
    for (const m of fixture("meta").measures) expect(ids.has(m.id)).toBe(true);
    expect(json.defaultConfig.ageingFloor).toBeGreaterThanOrEqual(0.15);
  });
});

describe("POST /api/plan", () => {
  test("the first day under benchtime has the console's shape and adds up", async () => {
    const { status, json } = await call("/api/plan", { date: "2026-10-01", policy: "benchtime" });
    expect(status).toBe(200);
    expect(shapeDiff(fixture("plan"), json)).toEqual([]);
    expect(json.workingDay).toBe(true);
    expect(json.unconstrained).toBeNull();
    expect(json.delta).toBeNull();
    // call order 0..n-1, standby last
    json.listings.forEach((l: { order: number }, i: number) => expect(l.order).toBe(i));
    const firstStandby = json.listings.findIndex((l: { standby: boolean }) => l.standby);
    if (firstStandby >= 0) expect(json.listings.slice(firstStandby).every((l: { standby: boolean }) => l.standby)).toBe(true);
    // each matter once
    const ids = [...json.listings, ...json.desk, ...json.deferred].map((x: { caseId: string }) => x.caseId);
    expect(new Set(ids).size).toBe(ids.length);
    // prior plus the effects is the planner's number
    for (const l of json.listings) {
      const pr = l.case.prediction;
      const sum = pr.reasons.reduce((s: number, r: { effect: number }) => s + r.effect, pr.prior);
      expect(Math.abs(sum - pr.pSubstantive)).toBeLessThan(0.0015);
      expect(l.why.length).toBeGreaterThanOrEqual(1);
      expect(l.why.length).toBeLessThanOrEqual(3);
    }
    const e = json.expected;
    expect(e.listed).toBe(json.listings.filter((l: { standby: boolean }) => !l.standby).length);
    expect(e.minutesLo).toBeLessThanOrEqual(e.minutes);
    expect(e.minutesHi).toBeGreaterThanOrEqual(e.minutes);
    expect(e.overrunRisk).toBeGreaterThanOrEqual(0);
    expect(e.overrunRisk).toBeLessThanOrEqual(1);
    expect(json.messages.length).toBe(json.listings.length + json.desk.length + json.deferred.length);
    for (const m of json.messages.filter((x: { kind: string }) => x.kind === "desk")) expect(m.text).toContain("You need not come");
  });

  test("a fresh policy on the captured morning makes the plan the simulator saw", async () => {
    for (const p of ["benchtime", "sehgal", "fifo_capped"]) {
      const st = await stateAt(p, undefined, "2026-10-06");
      const f = freePlan(p, undefined, st.ctx);
      expect({ l: f.listings, d: f.desk, df: f.deferred }).toEqual({ l: st.plan.listings, d: st.plan.desk, df: st.plan.deferred });
    }
  });

  test("pins and drops: the constrained plan, its cost, and what was rejected", async () => {
    const free = (await call("/api/plan", { date: "2026-10-06", policy: "benchtime" })).json;
    const listed = free.listings.filter((l: { standby: boolean }) => !l.standby);
    const pin = free.deferred[0]?.caseId ?? free.desk[0].caseId;
    const drop = listed[1].caseId;
    const { status, json } = await call("/api/plan", { date: "2026-10-06", policy: "benchtime", pin: [pin, "ST/0/0000"], drop: [drop] });
    expect(status).toBe(200);
    expect(shapeDiff(fixture("plan-overrides"), json)).toEqual([]);
    expect(json.overrides.pinned).toEqual([pin]);
    expect(json.overrides.dropped).toEqual([drop]);
    expect(json.overrides.rejected).toEqual([{ caseId: "ST/0/0000", reason: "No such case" }]);
    const p = json.listings.find((l: { caseId: string }) => l.caseId === pin);
    expect(p?.pinned).toBe(true);
    expect(p?.standby).toBe(false);
    const d = json.deferred.find((x: { caseId: string }) => x.caseId === drop);
    expect(d.to > "2026-10-06").toBe(true);
    expect(json.listings.some((l: { caseId: string }) => l.caseId === drop)).toBe(false);
    expect(json.unconstrained).toEqual(free.expected);
    expect(json.delta.substantive).toBeCloseTo(json.expected.substantive - free.expected.substantive, 1);
    expect(json.delta.listed).toBe(json.expected.listed - free.expected.listed);
  });

  test("a day the court does not sit is not an error", async () => {
    const { status, json } = await call("/api/plan", { date: "2026-10-02" });
    expect(status).toBe(200);
    expect(json.workingDay).toBe(false);
    expect(json.nextWorkingDay).toBe("2026-10-05");
    expect(json.listings).toEqual([]);
  });

  test("bad requests are 400 with an error", async () => {
    expect((await call("/api/plan", { date: "tomorrow" })).status).toBe(400);
    expect((await call("/api/plan", { date: "2026-10-05", policy: "nope" })).json.error).toBe("unknown policy");
    expect((await call("/api/plan", { date: "2027-02-01" })).status).toBe(400);
  });
});

describe("GET /api/case/:id", () => {
  test("one case in full, and 404 for an unknown id", async () => {
    const id = fixture("case").id as string;
    const { status, json } = await call(`/api/case/${encodeURIComponent(id)}?date=2026-10-06`);
    expect(status).toBe(200);
    expect(shapeDiff(fixture("case"), json)).toEqual([]);
    expect(json.id).toBe(id);
    const missing = await call("/api/case/XX%2F1%2F2000");
    expect(missing.status).toBe(404);
    expect(missing.json.error).toBe("no such case");
  });
});

describe("POST /api/simulate and /api/compare", () => {
  test("the runner scores a run exactly as the arena does", () => {
    const mine = runSeed({ policy: "status_quo_60", seed: 31, end: "2026-12-15" });
    const [arena] = runArena({ rosters: [{ id: ROSTER_ID, path: ROSTER_PATH }], policies: ["status_quo_60"], seeds: [31], start: "2026-10-01", end: "2026-12-15" });
    expect(mine.scorecards).toEqual(arena!.scorecards);
  });

  test("simulate has the console's shape", async () => {
    const { status, json } = await call("/api/simulate", { policy: "status_quo_60", seeds: [31, 32] });
    expect(status).toBe(200);
    expect(shapeDiff(fixture("simulate"), json)).toEqual([]);
    expect(json.weekly.length).toBe(12);
    expect(json.weekly[0].start).toBe("2026-10-01");
    expect(json.weekly[0].end).toBe("2026-10-04");
    expect(json.sittingDays).toBe(json.weekly.reduce((s: number, w: { sittingDays: number }) => s + w.sittingDays, 0));
    // not random: the same on every seed
    expect(json.summary.backlog.plus4Start.lo).toBe(json.summary.backlog.plus4Start.hi);
  });

  test("compare pairs the seeds: diff is b minus a", async () => {
    const { status, json } = await call("/api/compare", { a: { policy: "status_quo_60" }, b: { policy: "fifo_capped" }, seeds: [31, 32], weeks: 3 });
    expect(status).toBe(200);
    expect(shapeDiff(fixture("compare"), json)).toEqual([]);
    expect(json.weeks).toBe(3);
    const d = json.diff.extra.listedPerDay.mean;
    expect(d).toBeCloseTo(json.b.summary.extra.listedPerDay.mean - json.a.summary.extra.listedPerDay.mean, 4);
  });
});

describe("GET /api/health", () => {
  test("has the console's shape", async () => {
    const { status, json } = await call("/api/health?date=2026-10-06&policy=status_quo_60");
    expect(status).toBe(200);
    expect(shapeDiff(fixture("health"), json)).toEqual([]);
    expect(json.repeatAdjourned.distribution.length).toBe(11);
    expect(json.drift.weeks.length).toBe(12);
    const c = json.ageingRisk.counts;
    expect(json.ageingRisk.byWeek.reduce((s: number, w: Record<string, number>) => s + w["4"]!, 0)).toBe(c["4"]);
  }, 60_000);
});

describe("GET /api/evidence", () => {
  test("serves what exists and marks the rest not yet run", async () => {
    const { status, json } = await call("/api/evidence");
    expect(status).toBe(200);
    expect(shapeDiff({ ...fixture("evidence"), arena: { rows: [] } }, json)).toEqual([]);
    for (const [k, s] of Object.entries(json.sources as Record<string, { status: string }>)) {
      if (s.status === "not yet run") expect(json.notYetRun).toContain(k);
    }
    if (json.calibration) expect(json.calibration.rows.length).toBe(14);
  });
});

describe("evidence adapters", () => {
  test("the arena report becomes one row per policy with paired differences against the baseline", () => {
    const runs = runArena({ rosters: [{ id: ROSTER_ID, path: ROSTER_PATH }], policies: ["status_quo_60", "fifo_capped"], seeds: [31, 32], start: "2026-10-01", end: "2026-12-15" });
    const report = JSON.parse(JSON.stringify(summarise(runs), (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
    const arena = arenaRows(report)!;
    expect(arena.rows.length).toBe(2);
    const row0 = fixture("evidence").arena.rows[0];
    const ours = JSON.parse(JSON.stringify(arena.rows[1], (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
    expect(shapeDiff(row0, ours)).toEqual([]);
    const base = arena.rows[0] as { vsBaseline: { extra: Record<string, { mean: number }> } };
    expect(base.vsBaseline.extra.listedPerDay!.mean).toBe(0);
  });

  test("the calibration fit report parses into per-type rows", () => {
    const md = [
      "# World calibration fit",
      "",
      "Fitted under the calibration status quo on world seeds 1-20.",
      "",
      "## P(substantive | reached)",
      "",
      "| Type | Called hearings | Target | Simulated | Error | Largest share error | Within tolerance |",
      "|---|---:|---:|---:|---:|---:|---|",
      "| WARRANT | 1672 | 13.5% | 13.6% | 0.1% | 0.3% | yes |",
      "",
      "## Failure shares among failed called hearings (target / simulated)",
      "",
      "| Type | admin | resp. absent | pet. absent | sought time | not ready | process | external | both absent | unclear |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      "| WARRANT | 2.0% / 1.9% | 0.3% / 0.3% | 1.0% / 0.8% | 0.3% / 0.4% | 0.7% / 0.8% | 66.9% / 66.8% | 14.7% / 14.8% | 0.7% / 0.7% | 13.3% / 13.5% |",
      "",
      "## Notes",
      "",
      "- JUDGEMENT follows 1 / mean hearings per case (3.58), not the table's 100%.",
    ].join("\n");
    const c = calibrationFromMarkdown(md)!;
    expect(c.rows.length).toBe(1);
    expect(c.rows[0]!.type).toBe("WARRANT");
    expect(c.rows[0]!.simulated.pSubstantive.mean).toBe(0.136);
    expect(c.rows[0]!.simulated.pSubstantive.lo).toBeLessThan(0.136);
    expect(c.rows[0]!.simulated.failureShare.awaiting_process).toBe(0.668);
    expect(c.conflicts.length).toBe(1);
  });
});

describe("HTTP", () => {
  test("CORS is open, preflight answers, unknown routes are JSON 404s", async () => {
    const pre = await route(new Request("http://engine/api/plan", { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    const { status, json, headers } = await call("/api/nothing");
    expect(status).toBe(404);
    expect(json.error).toBe("not found");
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(headers.get("content-type")).toContain("application/json");
  });
});
