// Rule 1 adversarial tests, part 2: static latent values, the shape of what a planner is handed, and
// whether a planner can reach the world through the objects it is handed.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadCalendar } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { LEAK } from "../src/world/probe";
import type { PlanContext, Policy, RunResult } from "../src/domain/types";
import { configFor, worldParams } from "../src/eval/arena";
import { POLICIES, POLICY_IDS } from "../src/planner/index";
import { simulate } from "../src/world/simulate";

const START = "2026-10-01";
const ref = loadRefTables();
const cal = loadCalendar();
const records = loadRoster(join(import.meta.dir, "..", "data", "roster_3000_seed42.csv"));
const params = worldParams(ref, records);

function runWith(policy: Policy, policyId: string, end: string, seed = 31, r = ref): RunResult {
  return simulate({ records, rosterId: "x", policy, config: configFor(policyId), ref: r, calendar: cal, worldSeed: seed, start: START, end, params, scorecards: false });
}

describe("static latent values (attendance propensities) are invisible before anyone is called", () => {
  for (const id of POLICY_IDS) {
    test(id, () => {
      const logs: string[][] = [];
      for (const salt of [false, true]) {
        const inner = POLICIES[id]!();
        const log: string[] = [];
        const p: Policy = {
          ...inner,
          initialDates: (ctx) => {
            const m = inner.initialDates(ctx);
            log.push(JSON.stringify([...m.entries()].sort()));
            return m;
          },
          plan: (ctx) => {
            const pl = inner.plan(ctx);
            if (ctx.date === START) log.push(JSON.stringify(pl));
            return pl;
          },
        };
        LEAK.saltKeys = salt ? new Set(["propensity"]) : new Set();
        try {
          runWith(p, id, START);
        } finally {
          LEAK.saltKeys = new Set();
        }
        logs.push(log);
      }
      expect(logs[1]![0]).toBe(logs[0]![0]); // initial dates
      if (!POLICIES[id]!().asksCheckin) expect(logs[1]![1]).toBe(logs[0]![1]); // first-day plan
      else console.log(`${id}: first-day plan identical under different propensities: ${logs[1]![1] === logs[0]![1]} (the check-in may legitimately reveal them)`);
    }, 120000);
  }
});

describe("what the planner is handed", () => {
  let captured: PlanContext | null = null;
  const inner = POLICIES.benchtime!();
  const spy: Policy = {
    ...inner,
    plan: (ctx) => {
      if (ctx.date === "2026-10-16") captured = ctx;
      return inner.plan(ctx);
    },
  };
  runWith(spy, "benchtime", "2026-10-16");
  const ctx = captured as unknown as PlanContext;

  test("CaseView carries exactly the contract's fields", () => {
    const allowed = ["id", "filingNumber", "filingDate", "advocateId", "partyId", "stage", "nextPurpose", "hearingCounts", "hearingsAtPurpose", "lastSummary", "history", "process", "externalPending", "nextDate", "firstScheduledOn", "firstHeardOn", "disposed", "disposedOn"].sort();
    const keys = new Set<string>();
    const pk = new Set<string>();
    const ek = new Set<string>();
    const hk = new Set<string>();
    for (const v of ctx.cases) {
      for (const k of Object.keys(v)) keys.add(k);
      if (v.process) for (const k of Object.keys(v.process)) pk.add(k);
      if (v.externalPending) for (const k of Object.keys(v.externalPending)) ek.add(k);
      for (const h of v.history) for (const k of Object.keys(h)) hk.add(k);
    }
    expect([...keys].sort()).toEqual(allowed);
    expect([...pk].sort()).toEqual(["issuedOn", "kind", "returnedKnownOn", "round"]);
    expect([...ek].sort()).toEqual(["readyKnownOn", "since"]);
    expect([...hk].sort()).toEqual(["attendance", "date", "minutes", "outcome", "reason", "type"]);
    expect(Object.keys(ctx).sort()).toEqual(["calendar", "capacityMinutes", "cases", "checkins", "config", "date", "ref"]);
  });

  test("no view shows a return or report known on or before the day it happened", () => {
    for (const v of ctx.cases) {
      if (v.process?.returnedKnownOn) expect(v.process.returnedKnownOn <= ctx.date).toBe(true);
      if (v.externalPending?.readyKnownOn) expect(v.externalPending.readyKnownOn <= ctx.date).toBe(true);
    }
  });

  test("views and history are frozen", () => {
    const v = ctx.cases.find((x) => x.history.length > 0 && x.process)!;
    expect(Object.isFrozen(ctx.cases)).toBe(true);
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.history)).toBe(true);
    expect(Object.isFrozen(v.history[0])).toBe(true);
    expect(Object.isFrozen(v.process)).toBe(true);
    expect(Object.isFrozen(v.lastSummary)).toBe(true);
  });

  test("the shared objects in PlanContext are frozen (ref, calendar, config, checkins)", () => {
    const throws = (f: () => void) => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    };
    const report = {
      ref: Object.isFrozen(ctx.ref),
      refRow: Object.isFrozen(ctx.ref.JUDGEMENT),
      config: Object.isFrozen(ctx.config),
      configWeights: Object.isFrozen(ctx.config.weights),
      calendar: Object.isFrozen(ctx.calendar),
      calendarSetReadOnly: throws(() => ctx.calendar.workingDays.add("2026-10-04")),
      checkinsReadOnly: throws(() => (ctx.checkins as Map<string, unknown>).set("x", null)),
    };
    console.log("shared objects:", JSON.stringify(report));
    expect(Object.values(report).every(Boolean)).toBe(true);
  });
});

describe("a planner cannot reach the world through PlanContext", () => {
  test("mutating ctx.ref does not change what the world does", () => {
    const honest = runWith(POLICIES.status_quo_60!(), "status_quo_60", "2026-10-09", 31, loadRefTables());
    const inner = POLICIES.status_quo_60!();
    const r2 = loadRefTables();
    const tamper: Policy = {
      ...inner,
      plan: (ctx) => {
        // a planner writes into the tables it was shown (the copy is frozen, so the write throws)
        try {
          (ctx.ref.EVIDENCE_COMPLAINANT as { durationMin: number }).durationMin = 1;
          (ctx.ref.ARGUMENTS as { durationMin: number }).durationMin = 1;
        } catch {}
        return inner.plan(ctx);
      },
    };
    const tampered = runWith(tamper, "status_quo_60", "2026-10-09", 31, r2);
    const minutes = (r: RunResult) => r.days.reduce((s, d) => s + d.minutesUsed, 0);
    const reached = (r: RunResult) => r.days.reduce((s, d) => s + d.reached, 0);
    console.log(`honest minutes ${minutes(honest).toFixed(0)} reached ${reached(honest)}; tampered minutes ${minutes(tampered).toFixed(0)} reached ${reached(tampered)}`);
    expect(minutes(tampered)).toBeCloseTo(minutes(honest), 3);
  });

  test("mutating ctx.checkins does not change how the world scores the day", () => {
    const inner = POLICIES.benchtime!({ checkin: true });
    const count = (tamperCheckins: boolean) => {
      const p: Policy = {
        ...inner,
        plan: (ctx) => {
          const pl = inner.plan(ctx);
          if (tamperCheckins)
            try {
              for (const id of ctx.checkins.keys()) (ctx.checkins as Map<string, { complainant: string; accused: string }>).set(id, { complainant: "not_ready", accused: "not_ready" });
            } catch {}
          return pl;
        },
      };
      const r = runWith(p, "benchtime", "2026-10-16");
      return { vacated: r.hearings.filter((h) => h.outcome === "vacated").length, deferred: r.hearings.filter((h) => h.outcome === "deferred").length };
    };
    const a = count(false);
    const b = count(true);
    console.log(`checkins honest ${JSON.stringify(a)}; after the planner rewrote ctx.checkins ${JSON.stringify(b)}`);
    expect(b).toEqual(a);
  });

  test("a deferral self-labelled 'released at check-in' is scored as vacated only when a side said not ready", () => {
    const inner = POLICIES.fifo_capped!();
    const p: Policy = {
      ...inner,
      plan: (ctx) => {
        const pl = inner.plan(ctx);
        return { ...pl, deferred: pl.deferred.map((d) => ({ ...d, reason: "released at check-in" })) };
      },
    };
    const honest = runWith(inner, "fifo_capped", "2026-10-16");
    const labelled = runWith(p, "fifo_capped", "2026-10-16");
    const vac = (r: RunResult) => r.hearings.filter((h) => h.outcome === "vacated").length;
    const brk = (r: RunResult) => r.hearings.filter((h) => h.outcome === "deferred").length;
    console.log(`fifo_capped honest vacated ${vac(honest)} deferred ${brk(honest)}; self-labelled vacated ${vac(labelled)} deferred ${brk(labelled)} (asksCheckin=${inner.asksCheckin})`);
    expect(vac(labelled)).toBe(vac(honest));
  });
});
