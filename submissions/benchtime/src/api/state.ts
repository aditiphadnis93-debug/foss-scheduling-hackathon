// The court as it stands on the morning of a date, under one policy on the shared world seed 42: the
// simulator runs from the first day of the horizon, and on the requested morning the PlanContext the policy
// would receive (frozen CaseViews, check-in answers, the calendar) is captured and the run stops. Nothing
// here reads the world: the context is exactly what the planner sees (rule 1). Cached per (policy, config,
// date); a later date under the same rules is a fresh run (the simulator does not resume).

import type { DayPlan, JudgeConfig, PlanContext, Policy } from "../domain/types";
import { simulate } from "../world/simulate";
import { CAPACITY, HORIZON, PLAN_SEED, ROSTER_ID, canonical, effectiveConfig, getEnv, makePolicy } from "./context";

export interface DayState {
  policy: string;
  config: JudgeConfig;
  date: string;
  ctx: PlanContext;
  /** the plan the policy made inside the run (the reference the fresh replans are checked against) */
  plan: DayPlan;
}

class Captured extends Error {
  constructor(public state: { ctx: PlanContext; plan: DayPlan }) {
    super("captured");
  }
}

const cache = new Map<string, Promise<DayState>>();
const MAX_STATES = 24; // each morning holds 3,000 frozen views with their histories

/** The morning of `date` (a working day of the horizon) under the policy and config. */
export function stateAt(policyId: string, partial: Partial<JudgeConfig> | undefined, date: string): Promise<DayState> {
  const config = effectiveConfig(policyId, partial);
  const key = canonical({ p: policyId, c: config, d: date });
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Promise<DayState>((resolve, reject) => {
    // yield first so a burst of requests is not serialised behind one synchronous run
    setTimeout(() => {
      try {
        resolve(capture(policyId, partial, config, date));
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > MAX_STATES) cache.delete(cache.keys().next().value!);
  return p;
}

function capture(policyId: string, partial: Partial<JudgeConfig> | undefined, config: JudgeConfig, date: string): DayState {
  const env = getEnv();
  const inner = makePolicy(policyId, partial);
  const policy: Policy = {
    id: inner.id,
    name: inner.name,
    description: inner.description,
    asksCheckin: inner.asksCheckin,
    initialDates: (ctx) => inner.initialDates(ctx),
    nextDate: (ctx, c, outcome, d) => inner.nextDate(ctx, c, outcome, d),
    plan: (ctx) => {
      const plan = inner.plan(ctx);
      if (ctx.date === date) throw new Captured({ ctx, plan });
      return plan;
    },
  };
  try {
    simulate({
      records: env.records,
      rosterId: ROSTER_ID,
      policy,
      config,
      ref: env.ref,
      calendar: env.calendar,
      worldSeed: PLAN_SEED,
      start: HORIZON.start,
      end: date,
      params: env.params,
      capacityMinutes: CAPACITY,
      scorecards: false,
    });
  } catch (e) {
    if (e instanceof Captured) return { policy: policyId, config, date, ctx: e.state.ctx, plan: e.state.plan };
    throw e;
  }
  throw new Error(`the simulator made no plan for ${date}`);
}
