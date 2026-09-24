// What benchtime expects of a listing, from planner-visible data only (rule 1): P(substantive), expected
// bench minutes, and the value of hearing the case today. The prior is PUCAR's own table for the hearing
// type; each failure reason's share of that table is then scaled by what the court's records say about
// this case (process known back or not, who has been turning up, last-chance orders, repeated
// adjournments). Every adjustment leaves a sentence in why[] so the listing can explain itself.

import { ageYears, daysBetween } from "../data/calendar";
import { requiredRoles, stageIndex } from "../domain/lifecycle";
import {
  FAILURE_REASONS,
  type CaseView,
  type FailureReason,
  type JudgeConfig,
  type PlanContext,
  type ProcessKind,
  type RefTables,
  type Role,
} from "../domain/types";

/** minutes a called-but-failed hearing takes (DESIGN.md assumption, same as the world's default) */
export const CALL_MINUTES = 2;
/** minutes a desk matter takes (no bench time; recorded for the console) */
export const DESK_MINUTES = 0.5;

const ROLES: Role[] = ["complainant", "complainantAdvocate", "accused", "accusedAdvocate"];
const ROLE_LABEL: Record<Role, string> = {
  complainant: "complainant",
  complainantAdvocate: "complainant's advocate",
  accused: "accused",
  accusedAdvocate: "accused's advocate",
};
const COMPLAINANT_SIDE: Role[] = ["complainant", "complainantAdvocate"];
const ACCUSED_SIDE: Role[] = ["accused", "accusedAdvocate"];

export type ProcessGroup = "summons" | "notice" | "warrant";
export const processGroup = (k: ProcessKind): ProcessGroup =>
  k === "summons" ? "summons" : k === "notice" ? "notice" : "warrant";

/** prior days from issue to return by kind (PUCAR's gap after an appearance / warrant hearing is 21 days) */
const RETURN_PRIOR: Record<ProcessGroup, number> = { summons: 21, notice: 21, warrant: 30 };
const RETURN_PRIOR_WEIGHT = 5;

/** What the court's records say about the whole docket: attendance rates and process return times. */
export interface PopulationStats {
  roleRate: Record<Role, number>;
  /** the filing advocate's attendance pooled over all their cases */
  advocate: Map<string, { present: number; total: number }>;
  /** learned mean days from issue to return being known, per kind */
  returnDays: Record<ProcessGroup, number>;
}

const statsCache = new WeakMap<readonly CaseView[], PopulationStats>();

export function populationStats(cases: readonly CaseView[]): PopulationStats {
  const hit = statsCache.get(cases);
  if (hit) return hit;
  const present: Record<Role, number> = { complainant: 0, complainantAdvocate: 0, accused: 0, accusedAdvocate: 0 };
  const total: Record<Role, number> = { complainant: 0, complainantAdvocate: 0, accused: 0, accusedAdvocate: 0 };
  const advocate = new Map<string, { present: number; total: number }>();
  const ret: Record<ProcessGroup, { sum: number; n: number }> = {
    summons: { sum: 0, n: 0 },
    notice: { sum: 0, n: 0 },
    warrant: { sum: 0, n: 0 },
  };
  for (const c of cases) {
    for (const [role, seen] of roleObservations(c)) {
      total[role] += seen.total;
      present[role] += seen.present;
      if (role === "complainantAdvocate" && c.advocateId) {
        const a = advocate.get(c.advocateId) ?? { present: 0, total: 0 };
        a.present += seen.present;
        a.total += seen.total;
        advocate.set(c.advocateId, a);
      }
    }
    if (c.process?.returnedKnownOn && c.process.issuedOn) {
      const d = daysBetween(c.process.issuedOn, c.process.returnedKnownOn);
      if (d >= 0) {
        const g = ret[processGroup(c.process.kind)];
        g.sum += d;
        g.n++;
      }
    }
  }
  const roleRate = {} as Record<Role, number>;
  // a weak 70% prior keeps an empty docket (or a role never recorded) from producing 0 or 1
  for (const r of ROLES) roleRate[r] = (present[r] + 0.7 * 4) / (total[r] + 4);
  const returnDays = {} as Record<ProcessGroup, number>;
  for (const g of ["summons", "notice", "warrant"] as ProcessGroup[])
    returnDays[g] = (ret[g].sum + RETURN_PRIOR[g] * RETURN_PRIOR_WEIGHT) / (ret[g].n + RETURN_PRIOR_WEIGHT);
  const s = { roleRate, advocate, returnDays };
  statsCache.set(cases, s);
  return s;
}

/** Present/total per role from the last summary and every hearing the court has recorded for the case. */
function roleObservations(c: CaseView): [Role, { present: number; total: number }][] {
  const out: [Role, { present: number; total: number }][] = [];
  for (const r of ROLES) {
    let present = 0;
    let total = 0;
    const last = c.lastSummary.attendance[r];
    if (last !== null && last !== undefined) {
      total++;
      if (last) present++;
    }
    for (const h of c.history) {
      if (!h.attendance) continue;
      total++;
      if (h.attendance[r]) present++;
    }
    out.push([r, { present, total }]);
  }
  return out;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const label = (t: string): string => t.toLowerCase().replace(/_/g, " ");
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** true when the case has process out that the court has not been told is back */
export function processPending(view: CaseView, date: string): boolean {
  return !!view.process && (view.process.returnedKnownOn === null || view.process.returnedKnownOn > date);
}
/** true when a mediation (or other) report is awaited and the court has not been told it is ready */
export function reportPending(view: CaseView, date: string): boolean {
  return !!view.externalPending && (view.externalPending.readyKnownOn === null || view.externalPending.readyKnownOn > date);
}

/**
 * P(substantive) for the case's next purpose on `date`: PUCAR's prior for the type, with each failure
 * reason's share scaled by case evidence. `stats` pools the docket's records; without it, flat priors.
 */
export function predictSubstantive(
  view: CaseView,
  ref: RefTables,
  date: string,
  stats?: PopulationStats,
): { p: number; why: string[] } {
  const type = view.nextPurpose;
  const r = ref[type];
  const why: string[] = [`PUCAR prior ${pct(r.pSubstantive)} substantive for ${label(type)}`];
  const q = 1 - r.pSubstantive;
  const mult = {} as Record<FailureReason, number>;
  for (const k of FAILURE_REASONS) mult[k] = 1;

  // process and reports: a record the court holds either rules the failure out or makes it near certain
  const procPending = processPending(view, date);
  if (view.process && !procPending) {
    mult.awaiting_process = 0;
    why.push(`${view.process.kind.replace(/_/g, " ")} known returned`);
  } else if (!view.process) {
    mult.awaiting_process = 0.25; // nothing on record; a small allowance for process the summary missed
  }
  const repPending = reportPending(view, date);
  if (view.externalPending && !repPending) {
    mult.external_dependency = 0;
    why.push("report known ready");
  } else if (!view.externalPending) {
    mult.external_dependency = 0.25;
  }

  // attendance: Beta-Binomial per required role (prior = docket rate, strength 4), advocates pooled
  const roleRate = stats?.roleRate ?? { complainant: 0.7, complainantAdvocate: 0.7, accused: 0.7, accusedAdvocate: 0.7 };
  const required = requiredRoles(type);
  const obs = new Map(roleObservations(view));
  const est = (role: Role): number => {
    const o = obs.get(role)!;
    let present = o.present;
    let total = o.total;
    if (role === "complainantAdvocate" && stats) {
      // the advocate's record on their other matters counts half
      const a = stats.advocate.get(view.advocateId);
      if (a) {
        present += 0.5 * (a.present - o.present);
        total += 0.5 * (a.total - o.total);
      }
    }
    const k = 4;
    return (present + roleRate[role] * k) / (total + k);
  };
  const sideMult = (side: Role[]): number => {
    const need = required.filter((x) => side.includes(x));
    if (need.length === 0) return 0.3; // this side's absence rarely stops a hearing of this type
    let a = 1;
    let base = 1;
    for (const role of need) {
      const e = est(role);
      a *= e;
      base *= roleRate[role];
      const o = obs.get(role)!;
      if (o.total > 0 && Math.abs(e - roleRate[role]) > 0.1)
        why.push(`${ROLE_LABEL[role]} present at ${o.present} of ${o.total} recorded hearings`);
    }
    return clamp((1 - a) / Math.max(0.05, 1 - base), 0.2, 3);
  };
  mult.petitioner_absent = sideMult(COMPLAINANT_SIDE);
  mult.respondent_absent = sideMult(ACCUSED_SIDE);
  mult.both_absent = Math.sqrt(mult.petitioner_absent * mult.respondent_absent);

  // preparedness: a last-chance order raises it; repeated adjournments at this purpose lower it
  if (view.lastSummary.lastChance) {
    mult.not_ready *= 0.6;
    mult.sought_time *= 0.6;
    why.push("last chance order at the last hearing");
  }
  let unready = 0;
  for (const h of view.history)
    if (h.type === type && h.outcome === "failed" && (h.reason === "not_ready" || h.reason === "sought_time")) unready++;
  if (unready > 0) {
    const m = Math.min(2, 1 + 0.3 * unready);
    mult.not_ready *= m;
    mult.sought_time *= m;
    why.push(`${unready} recorded adjournment${unready > 1 ? "s" : ""} for time or unreadiness at this purpose`);
  }
  const median = r.hearingsPerCase.median;
  if (view.hearingsAtPurpose > 2 * median && median > 0) {
    mult.not_ready *= 1.2;
    mult.sought_time *= 1.2;
    why.push(`stuck: ${view.hearingsAtPurpose} hearings at this purpose, PUCAR median ${median}`);
  }

  let fail = 0;
  for (const k of FAILURE_REASONS) fail += q * (r.failureShare[k] ?? 0) * mult[k];
  let p = clamp(1 - fail, 0.02, 0.98);
  if (procPending) {
    p *= 0.1;
    why.push(`${view.process!.kind.replace(/_/g, " ")} out, not known returned`);
  }
  if (repPending) {
    p *= 0.1;
    why.push("report awaited, not known ready");
  }
  why.push(`predicted ${pct(p)} substantive`);
  return { p, why };
}

/** Expected bench minutes: the full hearing if it goes ahead, the call time if it fails. */
export function expectedMinutes(view: CaseView, ref: RefTables, p: number, callMinutes = CALL_MINUTES): number {
  return p * ref[view.nextPurpose].durationMin + (1 - p) * callMinutes;
}

/** How close a substantive hearing takes the case to disposal: 1 when it disposes the case. */
export function closeness(view: CaseView): number {
  if (view.nextPurpose === "JUDGEMENT" || view.lastSummary.judgmentPronounced) return 1;
  const idx = Math.max(0, stageIndex(view.stage));
  const seq = 1 / (11 - idx);
  if (view.nextPurpose === "REPORTS") return Math.max(0.5 * seq, 0.3); // a mediation report can settle the case
  if (stageIndex(view.nextPurpose) < 0) return 0.5 * seq; // an interruption returns to the same stage
  return seq;
}

function normWeights(w: JudgeConfig["weights"]): JudgeConfig["weights"] {
  const s = w.throughput + w.substantiveness + w.fairness + w.predictability + w.trips;
  const k = s > 0 ? 5 / s : 1;
  return {
    throughput: w.throughput * k,
    substantiveness: w.substantiveness * k,
    fairness: w.fairness * k,
    predictability: w.predictability * k,
    trips: w.trips * k,
  };
}

export interface Assessment {
  p: number;
  minutes: number;
  value: number;
  old: boolean;
  ageYears: number;
  why: string[];
}

/**
 * Value of hearing the case today: progress toward disposal x P(substantive) x age, stuck and last-chance
 * weights, plus a bonus for keeping a promise already made, minus the expected wasted trips. The weights
 * come from the judge's config. Kept strictly positive so spare time is always used.
 */
export function caseValue(view: CaseView, ctx: PlanContext, pred?: { p: number; why: string[] }): { value: number; why: string[] } {
  const { p } = pred ?? predictSubstantive(view, ctx.ref, ctx.date, populationStats(ctx.cases));
  const w = normWeights(ctx.config.weights);
  const why: string[] = [];
  const close = closeness(view);
  const gain = w.substantiveness + 3 * w.throughput * close;
  if (close === 1) why.push("a substantive hearing disposes of the case");
  const age = ageYears(view.filingDate, ctx.date);
  const ageW = 1 + (w.fairness * Math.min(age, 10)) / 5;
  if (age >= 4) why.push(`${age.toFixed(1)} years old`);
  const median = ctx.ref[view.nextPurpose].hearingsPerCase.median;
  const over = Math.max(0, view.hearingsAtPurpose - median) / Math.max(1, median);
  const stuckW = 1 + 0.5 * Math.min(1, over);
  const lcW = view.lastSummary.lastChance ? 1.25 : 1;
  let value = p * gain * ageW * stuckW * lcW;
  // promises: a case due today, and more so one already put off, is owed its hearing
  let broken = 0;
  for (const h of view.history) if (h.outcome === "deferred" || h.outcome === "not_reached") broken++;
  if (view.nextDate !== null && view.nextDate <= ctx.date) value += 0.3 * w.predictability;
  if (broken > 0) {
    value += Math.min(1, 0.2 * broken) * w.predictability;
    why.push(`put off ${broken} time${broken > 1 ? "s" : ""} before`);
  }
  // expected wasted trips: the people summoned for a hearing that then fails
  value -= 0.15 * w.trips * (1 - p);
  return { value: Math.max(0.01 * ageW, value), why };
}

/** Everything the planner needs about one case in one pass. */
export function assess(view: CaseView, ctx: PlanContext, stats = populationStats(ctx.cases)): Assessment {
  const pred = predictSubstantive(view, ctx.ref, ctx.date, stats);
  const { value, why } = caseValue(view, ctx, pred);
  const age = ageYears(view.filingDate, ctx.date);
  return {
    p: pred.p,
    minutes: expectedMinutes(view, ctx.ref, pred.p),
    value,
    old: age >= 4,
    ageYears: age,
    why: [...pred.why, ...why],
  };
}
