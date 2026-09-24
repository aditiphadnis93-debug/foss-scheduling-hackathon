// Rule 1 adversarial test: two worlds that are identical up to day D and differ in every latent value that
// only manifests after D (all draws made on later days, every process return and report ready day after D).
// A policy that plans only on what is known before the day must make byte-identical decisions (initial
// dates, day plans, next dates) up to the first day the divergence can be observed.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { addDays, isWorkingDay, loadCalendar, nextWorkingDayAfter } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { LEAK } from "../src/world/probe";
import type { Policy } from "../src/domain/types";
import { configFor, worldParams } from "../src/eval/arena";
import { POLICIES, POLICY_IDS } from "../src/planner/index";
import { simulate } from "../src/world/simulate";

const START = "2026-10-01";
const ref = loadRefTables();
const cal = loadCalendar();
const ROSTER = process.env.LEAK_ROSTER ?? join(import.meta.dir, "..", "data", "roster_3000_seed42.csv");
const records = loadRoster(ROSTER);
const params = worldParams(ref, records);
const SEED = Number(process.env.LEAK_SEED ?? "31");

type Decision = { date: string; what: string };

function run(policyId: string, divergeAfter: string | null, end: string, override?: Record<string, unknown>): Decision[] {
  const inner = POLICIES[policyId]!(override as never);
  const log: Decision[] = [];
  const wrapped: Policy = {
    ...inner,
    id: inner.id,
    asksCheckin: inner.asksCheckin,
    initialDates(ctx) {
      const m = inner.initialDates(ctx);
      log.push({ date: "init", what: JSON.stringify([...m.entries()].sort()) });
      return m;
    },
    plan(ctx) {
      const p = inner.plan(ctx);
      log.push({ date: ctx.date, what: JSON.stringify({ l: p.listings, d: p.desk, f: p.deferred, e: p.expected }) });
      return p;
    },
    nextDate(ctx, c, outcome, date) {
      const nd = inner.nextDate(ctx, c, outcome, date);
      log.push({ date, what: `next ${c.id} ${outcome} ${nd}` });
      return nd;
    },
  };
  LEAK.after = divergeAfter;
  try {
    simulate({
      records,
      rosterId: "leak",
      policy: wrapped,
      config: configFor(policyId, override as never),
      ref,
      calendar: cal,
      worldSeed: SEED,
      start: START,
      end,
      params,
      scorecards: false,
    });
  } finally {
    LEAK.after = null;
  }
  return log;
}

/** first index at which the two decision logs differ, with the date of that decision */
function firstDiff(a: Decision[], b: Decision[]): { i: number; date: string } | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i]?.what !== b[i]?.what || a[i]?.date !== b[i]?.date) return { i, date: a[i]?.date ?? b[i]!.date };
  return null;
}

const nthWorkingDay = (from: string, n: number): string => {
  let d = from;
  for (let k = 0; k < n; k++) d = nextWorkingDayAfter(d, cal);
  return d;
};

// divergence points: the first day, after a week, after a month
const D_LIST = (process.env.LEAK_D ?? "2026-10-05,2026-10-13,2026-11-11").split(",");

describe("rule 1: decisions up to D do not depend on latent values after D", () => {
  for (const id of POLICY_IDS) {
    test(`${id}`, () => {
      const rows: string[] = [];
      for (const D of D_LIST) {
        const firstObservable = nextWorkingDayAfter(D, cal); // first plan made after D
        const end = nthWorkingDay(D, 6);
        const a = run(id, null, end);
        const b = run(id, D, end);
        const diff = firstDiff(a, b);
        // plans and next dates made on or before D must match exactly
        const beforeA = a.filter((x) => x.date === "init" || x.date <= D);
        const beforeB = b.filter((x) => x.date === "init" || x.date <= D);
        expect(beforeB.length).toBe(beforeA.length);
        for (let i = 0; i < beforeA.length; i++) expect({ D, id, i, d: beforeB[i] }).toEqual({ D, id, i, d: beforeA[i] });
        // without a check-in, even the first plan after D can only use what was recorded up to D
        const inner = POLICIES[id]!();
        if (!inner.asksCheckin) {
          const pa = a.find((x) => x.date === firstObservable && x.what.startsWith("{"));
          const pb = b.find((x) => x.date === firstObservable && x.what.startsWith("{"));
          expect({ D, id, plan: pb?.what }).toEqual({ D, id, plan: pa?.what });
        }
        rows.push(`${id.padEnd(15)} D=${D} first differing decision: ${diff ? `${diff.date} (#${diff.i} of ${a.length})` : "none"}`);
      }
      console.log(rows.join("\n"));
    }, 600000);
  }

  test("benchtime without check-in: first plan after D is identical too", () => {
    for (const D of D_LIST) {
      const end = nthWorkingDay(D, 3);
      const a = run("benchtime", null, end, { checkin: false });
      const b = run("benchtime", D, end, { checkin: false });
      const f = nextWorkingDayAfter(D, cal);
      const pa = a.filter((x) => x.date === "init" || x.date <= f && !(x.date === f && !x.what.startsWith("{")));
      const pb = b.filter((x) => x.date === "init" || x.date <= f && !(x.date === f && !x.what.startsWith("{")));
      expect(pb.length).toBe(pa.length);
      for (let i = 0; i < pa.length; i++) expect({ D, i, d: pb[i] }).toEqual({ D, i, d: pa[i] });
      const diff = firstDiff(a, b);
      console.log(`benchtime(no checkin) D=${D} first differing decision: ${diff ? diff.date : "none"}`);
    }
  }, 600000);
});

void isWorkingDay;
void addDays;
