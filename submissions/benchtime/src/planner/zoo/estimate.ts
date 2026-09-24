// What the zoo expects of a listing, from planner-visible data only (rule 1). Four ingredients, each a gene:
// PUCAR's prior alone (the baselines) or the case-level estimate of predict.ts; the prior checked against
// PUCAR's own hearings per case (the index, portfolio and horizon redesigns: JUDGEMENT is "estimated" 100%
// but takes 3.58 hearings a case, about 28%); and a calibration learned from outcomes the court records:
// "fail" scales P(failure) per type (the index and portfolio redesigns), "pscale" scales P(substantive) per
// type (fill-fair and look-ahead), "learned" replaces the type prior by the docket's recorded rate (simple).

import { SEQUENCE, type CaseView, type HearingType, type PlanContext, type RefTables } from "../../domain/types";
import { stageIndex } from "../../domain/lifecycle";
import { CALL_MINUTES, populationStats, predictSubstantive, type PopulationStats } from "../predict";
import type { Calibration, Genome } from "./genome";

const checkedCache = new WeakMap<RefTables, RefTables>();

/** PUCAR's table with each "estimated" P no higher than 1 / mean hearings per case. */
export function checkedRef(ref: RefTables): RefTables {
  const hit = checkedCache.get(ref);
  if (hit) return hit;
  const out = {} as RefTables;
  for (const [t, r] of Object.entries(ref) as [HearingType, RefTables[HearingType]][]) {
    const implied = r.hearingsPerCase.mean > 1 ? 1 / r.hearingsPerCase.mean : 1;
    out[t] = r.pSubstantiveSource === "estimated" ? { ...r, pSubstantive: Math.min(r.pSubstantive, implied) } : r;
  }
  checkedCache.set(ref, out);
  return out;
}

const learnedCache = new WeakMap<readonly CaseView[], Map<RefTables, RefTables>>();

/** The type prior updated by every hearing the docket has recorded (Beta prior worth `strength` hearings). */
export function learnedRef(ctx: PlanContext, base: RefTables, strength = 20): RefTables {
  let byBase = learnedCache.get(ctx.cases);
  const hit = byBase?.get(base);
  if (hit) return hit;
  const n = new Map<HearingType, number>();
  const s = new Map<HearingType, number>();
  for (const c of ctx.cases)
    for (const h of c.history) {
      if (h.outcome !== "substantive" && h.outcome !== "failed") continue;
      n.set(h.type, (n.get(h.type) ?? 0) + 1);
      if (h.outcome === "substantive") s.set(h.type, (s.get(h.type) ?? 0) + 1);
    }
  const out = { ...base } as RefTables;
  for (const t of Object.keys(out) as HearingType[]) {
    const r = base[t];
    out[t] = { ...r, pSubstantive: ((s.get(t) ?? 0) + strength * r.pSubstantive) / ((n.get(t) ?? 0) + strength) };
  }
  if (!byBase) learnedCache.set(ctx.cases, (byBase = new Map()));
  byBase.set(base, out);
  return out;
}

/**
 * The policy's own record of what it predicted for each listing against what the court then recorded.
 * One accumulator per hearing type serves both corrections (failure factor and success scale).
 */
export class OutcomeBook {
  private acc = new Map<HearingType, { predFail: number; fail: number; predOk: number; ok: number }>();
  private pending = new Map<string, { id: string; date: string; type: HearingType; p: number }>();
  private seen = "";

  constructor(
    private mode: Calibration,
    private strength: number,
  ) {}

  note(id: string, date: string, type: HearingType, pRaw: number): void {
    if (this.mode === "fail" || this.mode === "pscale") this.pending.set(`${id}|${date}`, { id, date, type, p: pRaw });
  }

  /** fold in every earlier listing day's outcomes (once per planning day) */
  update(ctx: PlanContext): void {
    if (ctx.date === this.seen || this.pending.size === 0) {
      this.seen = ctx.date;
      return;
    }
    this.seen = ctx.date;
    const byId = new Map<string, CaseView>();
    for (const c of ctx.cases) byId.set(c.id, c);
    for (const [key, e] of this.pending) {
      if (e.date >= ctx.date) continue;
      this.pending.delete(key);
      const v = byId.get(e.id);
      if (!v) continue;
      let h = null;
      for (let i = v.history.length - 1; i >= 0; i--) {
        const x = v.history[i]!;
        if (x.date < e.date) break;
        if (x.date === e.date && x.type === e.type) {
          h = x;
          break;
        }
      }
      if (!h || (h.outcome !== "substantive" && h.outcome !== "failed")) continue;
      const a = this.acc.get(e.type) ?? { predFail: 0, fail: 0, predOk: 0, ok: 0 };
      a.predFail += 1 - e.p;
      a.predOk += e.p;
      if (h.outcome === "failed") a.fail++;
      else a.ok++;
      this.acc.set(e.type, a);
    }
  }

  /** the calibrated P from a raw model P */
  adjust(type: HearingType, p: number): number {
    const a = this.acc.get(type);
    if (!a) return p;
    const k = this.strength;
    if (this.mode === "fail") {
      const f = Math.min(4, Math.max(0.25, (a.fail + k) / (a.predFail + k)));
      return Math.min(0.98, Math.max(0.02, 1 - (1 - p) * f));
    }
    if (this.mode === "pscale") {
      const f = Math.min(3, Math.max(0.3, (a.ok + k) / (a.predOk + k)));
      return Math.min(0.98, Math.max(0.02, p * f));
    }
    return p;
  }
}

/** Everything the zoo needs about one case on one date. */
export interface Estimate {
  p: number;
  /** P before the outcome calibration (what the book scores) */
  pRaw: number;
  minutes: number;
  why: string[];
}

/** The estimator a genome describes. One per policy instance (it owns the outcome book). */
export class Estimator {
  readonly book: OutcomeBook;
  constructor(private g: Genome) {
    this.book = new OutcomeBook(g.calibration, g.calibration === "fail" ? 16 : 16);
  }

  /** the type table the estimate starts from */
  ref(ctx: PlanContext): RefTables {
    const base = this.g.priorCheck ? checkedRef(ctx.ref) : ctx.ref;
    return this.g.calibration === "learned" ? learnedRef(ctx, base) : base;
  }

  stats(ctx: PlanContext): PopulationStats {
    return populationStats(ctx.cases);
  }

  estimate(v: CaseView, ctx: PlanContext, date = ctx.date): Estimate {
    const ref = this.ref(ctx);
    let pRaw: number;
    let why: string[];
    if (this.g.caseEstimate) {
      const pr = predictSubstantive(v, ref, date, this.stats(ctx));
      pRaw = pr.p;
      why = pr.why;
    } else {
      pRaw = ref[v.nextPurpose].pSubstantive;
      why = [`PUCAR prior ${Math.round(pRaw * 100)}% substantive`];
    }
    const p = this.book.adjust(v.nextPurpose, pRaw);
    if (Math.abs(p - pRaw) > 0.05) why = [...why, `recalibrated on the court's record to ${Math.round(p * 100)}%`];
    const dur = ctx.ref[v.nextPurpose].durationMin;
    return { p, pRaw, minutes: p * dur + (1 - p) * CALL_MINUTES, why };
  }

  /** minutes a case is expected to take once its blocker clears (no case evidence of the blocker) */
  clearedMinutes(v: CaseView, ctx: PlanContext): number {
    const p = this.book.adjust(v.nextPurpose, this.ref(ctx)[v.nextPurpose].pSubstantive);
    return p * ctx.ref[v.nextPurpose].durationMin + (1 - p) * CALL_MINUTES;
  }
}

const OPTIONAL = new Set<HearingType>(["DELAY_CONDONATION_HEARING", "WARRANT"]);

/**
 * How far a substantive hearing takes the case toward disposal: the share of its remaining road (PUCAR's
 * mean hearings per case over the stages still ahead) this hearing's stage accounts for (the index redesign).
 */
export function progress(view: CaseView, ref: RefTables): number {
  if (view.lastSummary.judgmentPronounced || view.nextPurpose === "JUDGEMENT") return 1;
  const H = (t: HearingType): number => Math.max(1, ref[t].hearingsPerCase.mean);
  const si = Math.max(0, stageIndex(view.stage));
  let road = 0;
  for (let i = si; i < SEQUENCE.length; i++) {
    const s = SEQUENCE[i]!;
    road += (i > si && OPTIONAL.has(s) ? 0.5 : 1) * H(s);
  }
  if (stageIndex(view.nextPurpose) < 0) {
    const cur = H(view.nextPurpose);
    return cur / (cur + road);
  }
  return H(view.stage) / road;
}
