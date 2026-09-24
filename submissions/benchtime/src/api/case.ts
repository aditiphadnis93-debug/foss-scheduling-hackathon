// GET /api/case/:id?date=&policy=: one case in full as the court knows it on the date (CaseDetail), its
// hearing counts, the hearings the court has recorded in the simulated horizon so far, and the next date
// the policy would give it.

import { HORIZON, HttpError, checkPolicy, daysBetween, getEnv, makePolicy, stateDate } from "./context";
import { caseDetail } from "./detail";
import { stateAt } from "./state";

export async function caseHandler(id: string, dateParam: string | null, policyParam: string | null) {
  const env = getEnv();
  const policy = checkPolicy(policyParam || undefined);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : env.days[0]!;
  if (!env.byId.has(id)) throw new HttpError(404, "no such case", id);
  const st = await stateAt(policy, undefined, stateDate(date));
  const ctx = st.ctx;
  const v = ctx.cases.find((c) => c.id === id);
  if (!v) throw new HttpError(404, "no such case", id);
  let nextDateRecommendation: { date: string; reason: string } | null = null;
  if (!v.disposed) {
    try {
      const pol = makePolicy(policy);
      const to = pol.nextDate(ctx, v, "failed", ctx.date);
      const gap = ctx.ref[v.nextPurpose].gapDays;
      nextDateRecommendation = {
        date: to,
        reason: `The next date the ${pol.name} rules give if the hearing on ${ctx.date} does not move the case: ${daysBetween(ctx.date, to)} days on (PUCAR's reference gap for ${v.nextPurpose.toLowerCase().replace(/_/g, " ")} is ${gap} days)${to > HORIZON.end ? ", after the horizon" : ""}.`,
      };
    } catch {
      nextDateRecommendation = null;
    }
  }
  return {
    ...caseDetail(v, ctx),
    asOf: ctx.date,
    policy,
    disposed: v.disposed,
    disposedOn: v.disposedOn,
    hearingCounts: { ...v.hearingCounts },
    history: v.history.map((h) => ({
      date: h.date,
      type: h.type,
      outcome: h.outcome,
      reason: h.reason,
      minutes: h.minutes,
      attendance: h.attendance ? { ...h.attendance } : null,
      recordedBy: "court" as const,
    })),
    nextDateRecommendation,
  };
}
