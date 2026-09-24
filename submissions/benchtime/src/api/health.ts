// GET /api/health: the docket on a date as the court knows it (the captured morning on world seed 42 under
// the policy), and, where the picture needs the future, the simulator under the same policy on the
// interactive seeds (drift). Ageing risk, repeated adjournments, matters stuck at one purpose and the process
// desk read only CaseViews (rule 1); drift reads simulated runs.

import type { CaseView, HearingType, PlanContext, ProcessKind, SequentialType } from "../domain/types";
import { SEQUENCE } from "../domain/types";
import {
  DEFAULT_SEEDS,
  HORIZON,
  KIND_LABEL,
  ageYears,
  checkPolicy,
  crossesOn,
  daysBetween,
  getEnv,
  horizonWeeks,
  makePolicy,
  round,
  sentence,
  stateDate,
  typeLabel,
} from "./context";
import { consecutiveNonSubstantive, pOf, processOut, reportOut, statsOf } from "./detail";
import { pairedInterval, tInterval, type Interval } from "./intervals";
import { runSeeds } from "./simulate";
import { stateAt } from "./state";

const THRESHOLDS = [3, 4, 5, 10] as const;
type T = (typeof THRESHOLDS)[number];

function whyNotHeard(v: CaseView, ctx: PlanContext, p: number): { whyCode: string; whyNotHeard: string } {
  const date = ctx.date;
  if (processOut(v, date)) {
    const days = v.process!.issuedOn ? daysBetween(v.process!.issuedOn, date) : null;
    return { whyCode: "process_out", whyNotHeard: `${KIND_LABEL[v.process!.kind]} out${days !== null ? ` ${days} days` : ""}, not yet known returned; handled at the process desk until it is.` };
  }
  if (reportOut(v, date)) return { whyCode: "awaiting_report", whyNotHeard: `Mediation report awaited since ${v.externalPending!.since}; not listed until the court is told it is ready.` };
  const last = v.history[v.history.length - 1];
  if (last?.outcome === "deferred") return { whyCode: "deferred", whyNotHeard: `Put off on ${last.date}${v.nextDate ? `; next date ${v.nextDate}` : ""}.` };
  if (last?.outcome === "not_reached") return { whyCode: "no_room", whyNotHeard: `Listed on ${last.date} but not reached before the day ended${v.nextDate ? `; next date ${v.nextDate}` : ""}.` };
  if (p < 0.15) return { whyCode: "low_readiness", whyNotHeard: `Low chance the next hearing moves the case (${Math.round(p * 100)}%), so it is not preferred for the day's minutes.` };
  if (v.nextDate && v.nextDate > date) return { whyCode: "not_due", whyNotHeard: `Next date ${v.nextDate}; not due before then.` };
  return { whyCode: "not_due", whyNotHeard: v.nextDate ? `Due on ${v.nextDate}; see the day's list.` : "No date given yet." };
}

export async function healthHandler(dateParam: string | null, policyParam: string | null) {
  const env = getEnv();
  const policy = checkPolicy(policyParam || undefined);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : env.days[0]!;
  const on = stateDate(date);
  const st = await stateAt(policy, undefined, on);
  const ctx = st.ctx;
  const stats = statsOf(ctx);
  const live = ctx.cases.filter((c) => !c.disposed);
  const weeks = horizonWeeks();
  const pCache = new Map<string, number>();
  const pOfV = (v: CaseView) => {
    let p = pCache.get(v.id);
    if (p === undefined) pCache.set(v.id, (p = round(pOf(v, ctx, stats), 3)));
    return p;
  };

  // ageing risk: each case at the highest threshold it crosses between the date and the horizon end
  const crossing: { v: CaseView; t: T; on: string }[] = [];
  for (const v of live) {
    for (const t of [10, 5, 4, 3] as const) {
      const d = crossesOn(v.filingDate, t);
      if (d >= date && d <= HORIZON.end) {
        crossing.push({ v, t, on: d });
        break;
      }
    }
  }
  const counts = Object.fromEntries(THRESHOLDS.map((t) => [String(t), crossing.filter((x) => x.t === t).length])) as Record<"3" | "4" | "5" | "10", number>;
  const byWeek = weeks
    .filter((w) => w.end >= date)
    .map((w) => ({ week: w.week, start: w.start, end: w.end, ...Object.fromEntries(THRESHOLDS.map((t) => [String(t), crossing.filter((x) => x.t === t && x.on >= w.start && x.on <= w.end).length])) }));
  const ageingCases = crossing
    .sort((a, b) => b.t - a.t || (a.on < b.on ? -1 : a.on > b.on ? 1 : a.v.id < b.v.id ? -1 : 1))
    .slice(0, 60)
    .map(({ v, t, on: crosses }) => {
      const p = pOfV(v);
      return {
        caseId: v.id,
        ageYears: round(ageYears(v.filingDate, ctx.date), 2),
        threshold: t,
        crossesOn: crosses,
        stage: v.stage,
        stageLabel: typeLabel(v.stage),
        nextPurpose: v.nextPurpose,
        nextPurposeLabel: typeLabel(v.nextPurpose),
        advocateId: v.advocateId,
        nextDate: v.nextDate,
        ...whyNotHeard(v, ctx, p),
        pSubstantive: p,
      };
    });

  // repeated adjournments: the court's record, then the roster's count at the purpose (reasons unrecorded)
  const cons = live.map((v) => ({ v, c: consecutiveNonSubstantive(v, env.byId.get(v.id)) }));
  const dist = new Map<number, number>();
  for (const { c } of cons) dist.set(Math.min(10, c.count), (dist.get(Math.min(10, c.count)) ?? 0) + 1);
  const repeatCases = cons
    .filter((x) => x.c.count >= 3)
    .sort((a, b) => b.c.count - a.c.count || (a.v.filingDate < b.v.filingDate ? -1 : a.v.filingDate > b.v.filingDate ? 1 : a.v.id < b.v.id ? -1 : 1))
    .slice(0, 40)
    .map(({ v, c }) => {
      const reasons = [...Array.from({ length: c.count - c.recorded.length }, () => "unrecorded"), ...c.recorded];
      const reasonCounts: Record<string, number> = {};
      for (const r of reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
      const lastRec = c.recorded[c.recorded.length - 1];
      return {
        caseId: v.id,
        ageYears: round(ageYears(v.filingDate, ctx.date), 2),
        stage: v.stage,
        stageLabel: typeLabel(v.stage),
        nextPurpose: v.nextPurpose,
        nextPurposeLabel: typeLabel(v.nextPurpose),
        advocateId: v.advocateId,
        consecutive: c.count,
        pucarMedian: ctx.ref[v.nextPurpose].hearingsPerCase.median,
        reasons,
        reasonCounts,
        lastNote: lastRec ? sentence(`Last recorded reason: ${lastRec.replace(/_/g, " ")}`, true) : v.lastSummary.notes[0] ?? "",
        nextDate: v.nextDate,
        pSubstantive: pOfV(v),
      };
    });

  // stuck: hearings at the current purpose against PUCAR's median for the type
  const types = [...new Set(live.map((v) => v.nextPurpose))];
  const byType = types
    .map((t) => {
      const hs = live.filter((v) => v.nextPurpose === t).map((v) => v.hearingsAtPurpose).sort((a, b) => a - b);
      const med = ctx.ref[t].hearingsPerCase.median;
      return {
        type: t,
        label: typeLabel(t),
        cases: hs.length,
        docketMedian: hs.length ? hs[Math.floor(hs.length / 2)]! : 0,
        pucarMedian: med,
        overMedian: hs.filter((h) => h > med).length,
        overTwiceMedian: hs.filter((h) => h > 2 * med).length,
      };
    })
    .sort((a, b) => b.overTwiceMedian - a.overTwiceMedian || b.cases - a.cases);
  const stuckCases = live
    .filter((v) => v.hearingsAtPurpose >= 3 && v.hearingsAtPurpose > 2 * ctx.ref[v.nextPurpose].hearingsPerCase.median)
    .map((v) => ({ v, med: Math.max(1, ctx.ref[v.nextPurpose].hearingsPerCase.median) }))
    .sort((a, b) => b.v.hearingsAtPurpose / b.med - a.v.hearingsAtPurpose / a.med || (a.v.id < b.v.id ? -1 : 1))
    .slice(0, 30)
    .map(({ v, med }) => ({
      caseId: v.id,
      type: v.nextPurpose,
      label: typeLabel(v.nextPurpose),
      hearingsAtPurpose: v.hearingsAtPurpose,
      pucarMedian: ctx.ref[v.nextPurpose].hearingsPerCase.median,
      ratio: round(v.hearingsAtPurpose / med, 1),
      ageYears: round(ageYears(v.filingDate, ctx.date), 2),
      advocateId: v.advocateId,
    }));

  // process desk: every summons, notice or warrant out that the court has not been told is back
  const out = live.filter((v) => processOut(v, ctx.date));
  const daysOut = (v: CaseView) => (v.process!.issuedOn ? Math.max(0, daysBetween(v.process!.issuedOn, ctx.date)) : null);
  const group = (k: ProcessKind) => (k === "summons" ? "summons" : k === "notice" ? "notice" : "warrant");
  const bucket = (d: number) => (d <= 14 ? "0-14" : d <= 30 ? "15-30" : d <= 60 ? "31-60" : "61+");
  // long overdue: more than twice the return time the court's own records show for the kind
  const overdue = (v: CaseView) => (daysOut(v) ?? 0) > 2 * stats.returnDays[group(v.process!.kind)];
  const kinds = [...new Set(out.map((v) => v.process!.kind))];
  const processDesk = {
    total: out.length,
    byKind: kinds
      .map((k) => {
        const xs = out.filter((v) => v.process!.kind === k);
        const ageDays: Record<string, number> = { "0-14": 0, "15-30": 0, "31-60": 0, "61+": 0 };
        for (const v of xs) ageDays[bucket(daysOut(v) ?? 0)]!++;
        return { kind: k, label: KIND_LABEL[k], out: xs.length, ageDays, oldestDays: Math.max(0, ...xs.map((v) => daysOut(v) ?? 0)) };
      })
      .sort((a, b) => b.out - a.out),
    cases: out
      .sort((a, b) => (daysOut(b) ?? 0) - (daysOut(a) ?? 0) || (a.id < b.id ? -1 : 1))
      .slice(0, 40)
      .map((v) => ({
        caseId: v.id,
        kind: v.process!.kind,
        label: KIND_LABEL[v.process!.kind],
        issuedOn: v.process!.issuedOn ?? null,
        daysOut: daysOut(v),
        ageYears: round(ageYears(v.filingDate, ctx.date), 2),
        advocateId: v.advocateId,
        nextDate: v.nextDate,
        action: overdue(v) ? ("reissue" as const) : ("await_return" as const),
      })),
  };

  return {
    date,
    stateDate: on,
    policy,
    horizon: HORIZON,
    pending: live.length,
    ageingRisk: { thresholds: [...THRESHOLDS], counts, byWeek, cases: ageingCases },
    repeatAdjourned: {
      distribution: Array.from({ length: 11 }, (_, k) => ({ consecutive: k, cases: dist.get(k) ?? 0, orMore: k === 10 })),
      cases: repeatCases,
    },
    stuck: { byType, cases: stuckCases },
    drift: await drift(policy),
    processDesk,
  };
}

/** Weekly flows in and out of the 3, 4 and 5 year bands, simulated on the interactive seeds. */
export async function drift(policy: string) {
  const env = getEnv();
  const seeds = [...DEFAULT_SEEDS];
  const results = await runSeeds({ policy, seeds, end: HORIZON.end });
  const weeks = horizonWeeks();
  const bands = ["3", "4", "5"] as const;
  // crossings into a band come from filing dates: the same court on every seed
  const into = weeks.map((w) => {
    const o = { "3": 0, "4": 0, "5": 0 };
    for (const r of env.records) for (const b of bands) {
      const d = crossesOn(r.filingDate, Number(b));
      if (d >= w.start && d <= w.end) o[b]++;
    }
    return o;
  });
  const first = results[0]!;
  const last = (r: (typeof results)[number]) => r.weeks[r.weeks.length - 1]!;
  return {
    policy,
    policyName: makePolicy(policy).name,
    seeds,
    weeks: weeks.map((w, i) => {
      const outs = (b: (typeof bands)[number]) => results.map((r) => r.weeks[i]?.out[b] ?? NaN);
      return {
        ...w,
        into: into[i]!,
        out: Object.fromEntries(bands.map((b) => [b, tInterval(outs(b))])) as Record<"3" | "4" | "5", Interval>,
        net: Object.fromEntries(bands.map((b) => [b, tInterval(outs(b).map((x) => into[i]![b] - x))])) as Record<"3" | "4" | "5", Interval>,
        pending4Plus: tInterval(results.map((r) => r.weeks[i]?.pending4Plus ?? NaN)),
      };
    }),
    byStage: (SEQUENCE as readonly SequentialType[]).map((s) => {
      const start = first.initial.byStage[s];
      return {
        stage: s,
        label: typeLabel(s as HearingType),
        start,
        end: tInterval(results.map((r) => last(r).pendingByStage[s])),
        change: pairedInterval(results.map(() => start), results.map((r) => last(r).pendingByStage[s])),
      };
    }),
  };
}
