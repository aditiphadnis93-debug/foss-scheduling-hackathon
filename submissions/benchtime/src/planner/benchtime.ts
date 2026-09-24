// benchtime: the policy this submission proposes (DESIGN.md, "Policies"). On PUCAR's real causelist a
// failed matter costs the bench about two minutes, so squeezing minutes alone gains little; the waste is
// people travelling to hearings that fail for reasons the court knew the night before, and cases not
// moving. So: process-pending matters go to the desk and nobody is called for them; a "not ready" at the
// day-before check-in releases the slot; the day is chosen by an exact knapsack on the value of moving
// each case; next dates respect the procedural minimum, the day's promised load and the advocate's diary.

import { addDays, daysBetween } from "../data/calendar";
import { requiredRoles } from "../domain/lifecycle";
import type { CaseView, DayPlan, DeskAction, JudgeConfig, Outcome, PlanContext, Policy, Role } from "../domain/types";
import { benchClock, dueCases, fillDays, liveCases, makePlan, round2, windowOf, type Pick } from "./common";
import { clusterByAdvocate, greedyKnapsack, solveKnapsack, type KnapsackItem } from "./knapsack";
import { afterGap, PromiseBook, recommendNextDate } from "./nextdate";
import {
  assess,
  expectedMinutes,
  populationStats,
  predictSubstantive,
  processGroup,
  processPending,
  reportPending,
  type Assessment,
  type PopulationStats,
} from "./predict";

/** What the optimiser did today, for the console (an optional extra on the DayPlan). */
export interface OptimiserReport {
  candidates: number;
  capacity: number;
  exactValue: number;
  greedyValue: number;
  /** (exact - greedy) / exact */
  gap: number;
  lambda: number;
  floorShare: number;
  clusterSwaps: number;
  advocatesBefore: number;
  advocatesAfter: number;
}
export type BenchtimeDayPlan = DayPlan & { optimiser?: OptimiserReport };

const COMPLAINANT_SIDE: Role[] = ["complainant", "complainantAdvocate"];
const ACCUSED_SIDE: Role[] = ["accused", "accusedAdvocate"];
/** re-check an overdue process return at the desk after this many days */
const RECHECK_DAYS = 7;

/** When the court can expect to be told a process is back (the day after the expected return). */
export function expectedReturnKnown(view: CaseView, stats: PopulationStats, date: string): { date: string; overdue: boolean; why: string } {
  const p = view.process!;
  const mean = stats.returnDays[processGroup(p.kind)];
  const expected = p.issuedOn ? addDays(p.issuedOn, Math.round(mean) + 1) : addDays(date, Math.round(mean / 2));
  if (expected > date) return { date: expected, overdue: false, why: `${p.kind.replace(/_/g, " ")} expected back about ${expected}` };
  const late = p.issuedOn ? daysBetween(p.issuedOn, date) : 0;
  return { date: addDays(date, RECHECK_DAYS), overdue: late > 2 * mean, why: `${p.kind.replace(/_/g, " ")} overdue: desk re-check in ${RECHECK_DAYS} days` };
}

/** true when a side the hearing needs said "not ready" the day before */
export function releasedAtCheckin(ctx: PlanContext, c: CaseView): boolean {
  const a = ctx.checkins.get(c.id);
  if (!a) return false;
  const need = requiredRoles(c.nextPurpose);
  const cNeeded = need.some((r) => COMPLAINANT_SIDE.includes(r));
  const aNeeded = need.some((r) => ACCUSED_SIDE.includes(r));
  return (cNeeded && a.complainant === "not_ready") || (aNeeded && a.accused === "not_ready");
}

export function benchtime(own: JudgeConfig): Policy {
  // expected minutes a promised case will take on its date (0 while it will only be seen at the desk)
  const book = new PromiseBook((v, ctx) => {
    const conf = ctx.config ?? own;
    if (conf.processDesk && (processPending(v, v.nextDate!) || reportPending(v, v.nextDate!))) return 0;
    const { p } = predictSubstantive(v, ctx.ref, v.nextDate!, populationStats(ctx.cases));
    return expectedMinutes(v, ctx.ref, p);
  });

  const dayCap = (ctx: PlanContext, conf: JudgeConfig) => conf.fillTarget * ctx.capacityMinutes;

  /** the smart next date; the ablation without it falls back to PUCAR's gap */
  function nextDateFor(ctx: PlanContext, c: CaseView, outcome: Outcome, date: string): { date: string; why: string[] } {
    const conf = ctx.config ?? own;
    const ref = ctx.ref[c.nextPurpose];
    if (!conf.smartNextDate) return { date: afterGap(date, ref.gapDays, ctx.calendar), why: ["PUCAR reference gap"] };
    const stats = populationStats(ctx.cases);
    const ledger = book.get(ctx);
    let earliest: string;
    const why: string[] = [];
    // bench minutes to reserve: assume the matter goes ahead once its blocker clears
    let minutes = expectedMinutes(c, ctx.ref, ref.pSubstantive);
    if (conf.processDesk && processPending(c, date)) {
      const r = expectedReturnKnown(c, stats, date);
      earliest = r.date;
      why.push(r.why);
    } else if (conf.processDesk && reportPending(c, date)) {
      const since = c.externalPending!.since;
      // a report ordered before the horizon has no date: expect it about half a reference gap out
      const expected = since ? addDays(since, ctx.ref.REPORTS.gapDays + 1) : addDays(date, Math.round(ctx.ref.REPORTS.gapDays / 2));
      earliest = expected > date ? expected : addDays(date, 14);
      why.push(expected > date ? `report expected about ${expected}` : "report overdue: desk re-check in 14 days");
    } else {
      const last = c.history[c.history.length - 1];
      const reason = last && last.date === date ? last.reason : null;
      switch (outcome) {
        case "substantive":
          earliest = addDays(date, ref.gapDays);
          why.push(`PUCAR gap for ${c.nextPurpose.toLowerCase().replace(/_/g, " ")}: ${ref.gapDays} days`);
          break;
        case "failed":
        case "vacated":
          // the cause (absence, time sought, papers) is cleared by the next date: a short procedural minimum
          earliest = addDays(date, Math.min(ref.gapDays, 7));
          why.push(`short re-listing after ${outcome === "vacated" ? "release at check-in" : reason ? reason.replace(/_/g, " ") : "a failed hearing"}`);
          break;
        default:
          // not reached, court not sitting, put off: the case was ready, bring it back soon
          earliest = addDays(date, 1);
          minutes = expectedMinutes(c, ctx.ref, predictSubstantive(c, ctx.ref, date, stats).p);
          why.push("the case was ready: next day with room");
      }
    }
    const advice = recommendNextDate(
      { date, earliest, minutes, capacity: dayCap(ctx, conf), advocate: conf.clusterByAdvocate ? c.advocateId : undefined, bundleDays: 3 },
      ctx.calendar,
      ledger,
    );
    book.promise(ctx, c, advice.date, minutes);
    return { date: advice.date, why: [...why, ...advice.why] };
  }

  return {
    id: "benchtime",
    name: "benchtime",
    description:
      "Process desk, day-before check-in, an exact knapsack on the value of moving each case with a fairness floor and advocate clustering, fixed call times with a standby list, and next dates with room.",
    asksCheckin: own.checkin,

    initialDates(ctx) {
      const conf = ctx.config ?? own;
      const stats = populationStats(ctx.cases);
      const live = liveCases(ctx);
      const out = new Map<string, string>();
      const ledger = book.get(ctx);
      const rest: { view: CaseView; minutes: number; density: number }[] = [];
      for (const c of live) {
        if (conf.processDesk && (processPending(c, ctx.date) || reportPending(c, ctx.date))) {
          // no hearing until the blocker is known cleared: first date at the expected return
          const earliest = processPending(c, ctx.date)
            ? expectedReturnKnown(c, stats, ctx.date).date
            : c.externalPending!.since
              ? addDays(c.externalPending!.since, ctx.ref.REPORTS.gapDays + 1)
              : addDays(ctx.date, Math.round(ctx.ref.REPORTS.gapDays / 2));
          const minutes = expectedMinutes(c, ctx.ref, ctx.ref[c.nextPurpose].pSubstantive);
          const a = recommendNextDate(
            { date: addDays(ctx.date, -1), earliest, minutes, capacity: dayCap(ctx, conf), advocate: c.advocateId },
            ctx.calendar,
            ledger,
          );
          ledger.add(a.date, minutes, c.advocateId);
          out.set(c.id, a.date);
          continue;
        }
        const a = assess(c, ctx, stats);
        rest.push({ view: c, minutes: a.minutes, density: a.value / Math.max(0.5, a.minutes) });
      }
      // the rest by value per expected minute, the floor share of each day to 4+ year cases first
      rest.sort((x, y) => y.density - x.density || (x.view.id < y.view.id ? -1 : 1));
      const filled = fillDays(ctx, rest, dayCap(ctx, conf), { floorShare: Math.max(0.15, conf.ageingFloor) });
      for (const [id, d] of filled) out.set(id, d);
      return out;
    },

    plan(ctx): BenchtimeDayPlan {
      const conf = ctx.config ?? own;
      const stats = populationStats(ctx.cases);
      const desk: DeskAction[] = [];
      const deferred: DayPlan["deferred"] = [];
      const candidates: { view: CaseView; a: Assessment }[] = [];

      for (const c of dueCases(ctx)) {
        // (1) the process desk: nobody travels for a hearing that cannot go ahead
        if (conf.processDesk && processPending(c, ctx.date)) {
          const r = expectedReturnKnown(c, stats, ctx.date);
          desk.push({
            caseId: c.id,
            action: r.overdue ? "reissue" : "await_return",
            note: r.overdue
              ? `${c.process!.kind.replace(/_/g, " ")} long overdue: re-issue and re-check at the desk`
              : `${c.process!.kind.replace(/_/g, " ")} not yet returned: taken at the desk, nobody need attend`,
          });
          continue;
        }
        if (conf.processDesk && reportPending(c, ctx.date)) {
          desk.push({ caseId: c.id, action: "await_report", note: "report not yet received: taken at the desk, nobody need attend" });
          continue;
        }
        // (2) check-in: an honest "not ready" from a side the hearing needs releases the slot
        if (conf.checkin && releasedAtCheckin(ctx, c)) {
          const n = nextDateFor(ctx, c, "vacated", ctx.date);
          deferred.push({ caseId: c.id, to: n.date, reason: "released at check-in" });
          continue;
        }
        candidates.push({ view: c, a: assess(c, ctx, stats) });
      }

      // (3) the exact knapsack with the fairness floor, then advocate clustering
      const cap = Math.floor(conf.fillTarget * ctx.capacityMinutes);
      const floorShare = Math.max(0.15, conf.ageingFloor);
      const items: KnapsackItem[] = candidates.map(({ view, a }) => ({
        id: view.id,
        minutes: a.minutes,
        value: a.value,
        old: a.old,
        advocate: view.advocateId,
      }));
      const exact = solveKnapsack(items, cap, { floorShare });
      const greedy = greedyKnapsack(items, cap, { floorShare });
      let chosenIds = exact.chosen;
      let cluster = { swaps: 0, advocatesBefore: 0, advocatesAfter: 0 };
      if (conf.clusterByAdvocate) {
        const cl = clusterByAdvocate(items, exact.chosen, cap, { floorShare, epsilon: 0.02 });
        chosenIds = cl.chosen;
        cluster = cl;
      }
      const chosen = new Set(chosenIds);

      // (6) sequence: short, likely-to-fail matters first so failures clear early; long matters after
      const byId = new Map(candidates.map((x) => [x.view.id, x]));
      const main = chosenIds
        .map((id) => byId.get(id)!)
        .sort(
          (x, y) =>
            ctx.ref[x.view.nextPurpose].durationMin - ctx.ref[y.view.nextPurpose].durationMin ||
            (x.view.advocateId < y.view.advocateId ? -1 : x.view.advocateId > y.view.advocateId ? 1 : 0) ||
            x.a.p - y.a.p ||
            (x.view.id < y.view.id ? -1 : 1),
        );
      const listed: Pick[] = [];
      let clock = 0;
      for (const x of main) {
        const t = benchClock(clock);
        listed.push({
          view: x.view,
          p: x.a.p,
          minutes: x.a.minutes,
          callTime: t,
          window: windowOf(t),
          why: [...x.a.why, x.a.old && exact.lambda > 0 ? "selected under the fairness floor" : "selected by the exact knapsack"],
        });
        clock += x.a.minutes;
      }

      // standby: the best of the rest, sized to the share of the day failures are expected to free
      const rest = candidates
        .filter((x) => !chosen.has(x.view.id))
        .sort((x, y) => y.a.value / Math.max(0.5, y.a.minutes) - x.a.value / Math.max(0.5, x.a.minutes) || (x.view.id < y.view.id ? -1 : 1));
      const standbyCap = conf.standbyShare * ctx.capacityMinutes;
      let sb = 0;
      for (const x of rest) {
        if (sb >= standbyCap) {
          const n = nextDateFor(ctx, x.view, "deferred", ctx.date);
          deferred.push({ caseId: x.view.id, to: n.date, reason: `no room today: ${n.why.join("; ")}` });
          continue;
        }
        sb += x.a.minutes;
        listed.push({ view: x.view, p: x.a.p, minutes: x.a.minutes, standby: true, callTime: null, window: "standby", why: [...x.a.why, "standby: called if time frees up"] });
      }

      const plan: BenchtimeDayPlan = makePlan(ctx, listed, desk, deferred);
      plan.optimiser = {
        candidates: items.length,
        capacity: cap,
        exactValue: round2(exact.value),
        greedyValue: round2(greedy.value),
        gap: exact.value > 0 ? round2((exact.value - greedy.value) / exact.value) : 0,
        lambda: exact.lambda,
        floorShare,
        clusterSwaps: cluster.swaps,
        advocatesBefore: cluster.advocatesBefore,
        advocatesAfter: cluster.advocatesAfter,
      };
      return plan;
    },

    nextDate(ctx, c, outcome, date) {
      return nextDateFor(ctx, c, outcome, date).date;
    },
  };
}
