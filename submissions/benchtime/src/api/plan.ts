// POST /api/plan: tomorrow's list under one policy, every matter in full, the expected load recomputed with
// the planner's own predict helpers (the same numbers for every policy, so lists compare fairly), and, when
// the court pins or drops cases, the plan re-made with those constraints and its cost against the plan the
// policy would have made on its own. Both plans come from a fresh policy on the same captured morning.

import { fromMinutes, toMinutes } from "../data/calendar";
import type { CaseView, DayPlan, DeskAction, HearingType, JudgeConfig, Listing, Outcome, PlanContext } from "../domain/types";
import { expectedMinutes } from "../planner/index";
import {
  CAPACITY,
  HORIZON,
  HttpError,
  SITTING,
  ageYears,
  checkDate,
  checkPolicy,
  cleanConfig,
  effectiveConfig,
  getEnv,
  inHorizon,
  isWorkingDay,
  longDate,
  makePolicy,
  nextWorkingDayAfter,
  nextWorkingDayOnOrAfter,
  round,
  sentence,
  typeLabel,
} from "./context";
import { caseDetail, pOf, processOut, reportOut, statsOf, type CaseDetail } from "./detail";
import { stateAt } from "./state";

// Durations spread around PUCAR's estimate with CV 0.5 (the world's documented default; DESIGN.md)
const DURATION_CV = 0.5;
const Z90 = 1.2816;

export interface Expected {
  listed: number;
  standby: number;
  desk: number;
  deferred: number;
  minutes: number;
  minutesLo: number;
  minutesHi: number;
  reached: number;
  substantive: number;
  substantiveLo: number;
  substantiveHi: number;
  overrunRisk: number;
  utilisation: number;
  minutes4yPlus: number;
  share4yPlus: number;
}

interface Planned {
  listings: (Listing & { pinned: boolean })[];
  desk: DeskAction[];
  deferred: DayPlan["deferred"];
}

// ---------------------------------------------------------------------------------------------
// Normal-approximation helpers

export function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const normalPdf = (z: number) => Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
const pAtMost = (c: number, mu: number, sd: number) => (sd <= 1e-9 ? (mu <= c ? 1 : 0) : normalCdf((c - mu) / sd));

/** Per matter: P(substantive), expected minutes and the variance of its minutes, from the planner's helpers. */
function matterLoad(v: CaseView, ctx: PlanContext, stats: ReturnType<typeof statsOf>) {
  const p = pOf(v, ctx, stats);
  const m = expectedMinutes(v, ctx.ref, p);
  const full = expectedMinutes(v, ctx.ref, 1); // the hearing's minutes if it goes ahead
  const call = expectedMinutes(v, ctx.ref, 0); // the minutes to call and adjourn it
  const second = p * full * full * (1 + DURATION_CV * DURATION_CV) + (1 - p) * call * call;
  return { p, m, variance: Math.max(0, second - m * m) };
}

/** The expected load of a plan's main list (standby excluded), with 10th to 90th percentile bands. */
export function expectedOf(plan: Planned, ctx: PlanContext, capacity = CAPACITY) {
  const stats = statsOf(ctx);
  const byId = new Map(ctx.cases.map((c) => [c.id, c]));
  const main = plan.listings.filter((l) => !l.standby).sort((a, b) => a.order - b.order);
  let mu = 0;
  let v2 = 0;
  let reached = 0;
  let subst = 0;
  let substVar = 0;
  let old = 0;
  const cumulative: { order: number; caseId: string; expectedEnd: number; lo: number; hi: number }[] = [];
  const perListing = new Map<string, { p: number; m: number }>();
  for (const l of main) {
    const v = byId.get(l.caseId)!;
    const x = matterLoad(v, ctx, stats);
    perListing.set(l.caseId, { p: x.p, m: x.m });
    // reached when the bench clock before it is still inside the day
    const pr = pAtMost(capacity, mu, Math.sqrt(v2));
    reached += pr;
    const q = pr * x.p;
    subst += q;
    substVar += q * (1 - q);
    mu += x.m;
    v2 += x.variance;
    if (ageYears(v.filingDate, ctx.date) >= 4) old += x.m;
    const sd = Math.sqrt(v2);
    cumulative.push({ order: l.order, caseId: l.caseId, expectedEnd: round(mu, 1), lo: round(Math.max(0, mu - Z90 * sd), 1), hi: round(mu + Z90 * sd, 1) });
  }
  for (const l of plan.listings.filter((x) => x.standby)) {
    const x = matterLoad(byId.get(l.caseId)!, ctx, stats);
    perListing.set(l.caseId, { p: x.p, m: x.m });
  }
  const sd = Math.sqrt(v2);
  // E[min(S, C)] under the normal approximation: minutes past capacity are not bench time used
  const z = sd > 1e-9 ? (capacity - mu) / sd : Infinity;
  const excess = sd > 1e-9 ? sd * normalPdf(z) + (mu - capacity) * (1 - normalCdf(z)) : Math.max(0, mu - capacity);
  const ssd = Math.sqrt(substVar);
  const expected: Expected = {
    listed: main.length,
    standby: plan.listings.length - main.length,
    desk: plan.desk.length,
    deferred: plan.deferred.length,
    minutes: round(mu, 1),
    minutesLo: round(Math.max(0, mu - Z90 * sd), 1),
    minutesHi: round(mu + Z90 * sd, 1),
    reached: round(reached, 1),
    substantive: round(subst, 1),
    substantiveLo: round(Math.max(0, subst - Z90 * ssd), 1),
    substantiveHi: round(subst + Z90 * ssd, 1),
    overrunRisk: main.length ? round(1 - pAtMost(capacity, mu, sd), 3) : 0,
    utilisation: round((mu - excess) / capacity, 3),
    minutes4yPlus: round(old, 1),
    share4yPlus: mu > 0 ? round(old / mu, 3) : 0,
  };
  return { expected, cumulative, perListing };
}

// ---------------------------------------------------------------------------------------------
// Bench clock: 10:00 to 13:30 and 14:00 to 17:30

const DAY_START = toMinutes(SITTING.start);
const LUNCH_START = toMinutes(SITTING.breaks[0]!.start);
const LUNCH_LEN = toMinutes(SITTING.breaks[0]!.end) - LUNCH_START;
const benchOffset = (hhmm: string) => {
  const t = toMinutes(hhmm);
  return Math.max(0, (t >= LUNCH_START + LUNCH_LEN ? t - LUNCH_LEN : Math.min(t, LUNCH_START)) - DAY_START);
};
const clockAt = (offset: number) => {
  let t = DAY_START + Math.max(0, Math.round(offset));
  if (t >= LUNCH_START) t += LUNCH_LEN;
  return fromMinutes(t);
};
const halfHour = (hhmm: string) => {
  const t = toMinutes(hhmm);
  const s = Math.floor(t / 30) * 30;
  return `${fromMinutes(s)}-${fromMinutes(s + 30)}`;
};
const isHalfHourWindow = (w: string | null) => {
  const m = w ? /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(w) : null;
  return !!m && toMinutes(m[2]!) - toMinutes(m[1]!) === 30;
};

// ---------------------------------------------------------------------------------------------
// Pins and drops

const BOOKKEEPING = /^(pucar prior|predicted )/i;
const SELECTION = /^(selected|standby|on standby|pinned)/i;

/** One to three short reasons, the policy's reason for the choice first. */
function whyOf(policyWhy: readonly string[], pinned: boolean): string[] {
  const lines = policyWhy.filter((w) => !BOOKKEEPING.test(w));
  const ordered = [...lines.filter((w) => SELECTION.test(w)), ...lines.filter((w) => !SELECTION.test(w))].map((w) => sentence(w));
  const out = pinned ? ["Pinned by the court", ...ordered.filter((w) => !/^pinned/i.test(w))] : ordered;
  return [...new Set(out)].slice(0, 3);
}

function safeNextDate(ctx: PlanContext, policyId: string, config: Partial<JudgeConfig> | undefined, v: CaseView, outcome: Outcome, pol = makePolicy(policyId, config)): string {
  const { calendar } = getEnv();
  let to: string;
  try {
    to = pol.nextDate(ctx, v, outcome, ctx.date);
  } catch {
    to = nextWorkingDayAfter(ctx.date, calendar);
  }
  if (typeof to !== "string" || to <= ctx.date || !isWorkingDay(to, calendar)) to = nextWorkingDayAfter(ctx.date, calendar);
  return to;
}

const asPlanned = (p: DayPlan): Planned => ({ listings: p.listings.map((l) => ({ ...l, pinned: false })), desk: [...p.desk], deferred: [...p.deferred] });

export interface Overrides {
  pinned: string[];
  dropped: string[];
  rejected: { caseId: string; reason: string }[];
}

/**
 * The constrained plan: dropped cases and pins the policy did not already list are hidden from it (their
 * promise is set aside), the day's capacity is reduced by the pinned matters' expected minutes, the rest is
 * re-optimised by the policy, then the pins are placed in the call order by hearing length and the times
 * after them move on by their minutes. Dropped matters are deferred to the policy's own next date.
 */
export function constrain(policyId: string, config: Partial<JudgeConfig> | undefined, ctx: PlanContext, free: DayPlan, pin: string[], drop: string[]): { plan: Planned; overrides: Overrides } {
  const byId = new Map(ctx.cases.map((c) => [c.id, c]));
  const eff = effectiveConfig(policyId, config);
  const stats = statsOf(ctx);
  const rejected: Overrides["rejected"] = [];
  const freeMain = new Set(free.listings.filter((l) => !l.standby).map((l) => l.caseId));
  const freeAny = new Set([...free.listings.map((l) => l.caseId), ...free.desk.map((d) => d.caseId)]);
  const freeDeferred = new Map(free.deferred.map((d) => [d.caseId, d.to]));
  const pins: string[] = [];
  const drops: string[] = [];
  for (const id of new Set(pin)) {
    const v = byId.get(id);
    if (!v) rejected.push({ caseId: id, reason: "No such case" });
    else if (v.disposed) rejected.push({ caseId: id, reason: `Already disposed on ${v.disposedOn ?? "an earlier date"}` });
    else if (drop.includes(id)) rejected.push({ caseId: id, reason: "Both pinned and dropped; neither applied" });
    else pins.push(id);
  }
  for (const id of new Set(drop)) {
    const v = byId.get(id);
    if (pin.includes(id)) continue;
    if (!v) rejected.push({ caseId: id, reason: "No such case" });
    else if (v.disposed) rejected.push({ caseId: id, reason: `Already disposed on ${v.disposedOn ?? "an earlier date"}` });
    else if (freeAny.has(id)) drops.push(id);
    else if (freeDeferred.has(id)) rejected.push({ caseId: id, reason: `Not on this day's list: already put off to ${freeDeferred.get(id)}` });
    else rejected.push({ caseId: id, reason: v.nextDate ? `Not on this day's list: next date ${v.nextDate}` : "Not on this day's list" });
  }
  if (pins.length === 0 && drops.length === 0) return { plan: asPlanned(free), overrides: { pinned: [], dropped: [], rejected } };

  const force = new Set(pins.filter((id) => !freeMain.has(id)));
  const hidden = new Set([...drops, ...force]);
  let pinnedMinutes = 0;
  for (const id of force) pinnedMinutes += expectedMinutes(byId.get(id)!, ctx.ref, pOf(byId.get(id)!, ctx, stats));
  const cases = Object.freeze(ctx.cases.map((c) => (hidden.has(c.id) ? Object.freeze({ ...c, nextDate: null }) : c)));
  const ctxC: PlanContext = Object.freeze({ ...ctx, cases, capacityMinutes: Math.max(0, ctx.capacityMinutes - pinnedMinutes / Math.max(0.1, eff.fillTarget)) });
  const pol = makePolicy(policyId, config);
  const made = pol.plan(ctxC);

  // pins still not on the main list (a pin the policy listed alone can fall out once others are forced in)
  const mainC = new Set(made.listings.filter((l) => !l.standby).map((l) => l.caseId));
  const toPlace = pins.filter((id) => !mainC.has(id));
  const placeSet = new Set(toPlace);
  const main = made.listings.filter((l) => !l.standby && !placeSet.has(l.caseId)).sort((a, b) => a.order - b.order);
  const standby = made.listings.filter((l) => l.standby && !placeSet.has(l.caseId)).sort((a, b) => a.order - b.order);
  const timed = main.some((l) => l.callTime !== null) || (main.length === 0 && free.listings.some((l) => l.callTime !== null));
  const dur = (t: HearingType) => ctx.ref[t].durationMin;

  type Row = Listing & { pinned: boolean; orig: number | null };
  const rows: Row[] = main.map((l) => ({ ...l, pinned: pins.includes(l.caseId), why: whyOf(l.why, pins.includes(l.caseId)), orig: l.callTime ? benchOffset(l.callTime) : null }));
  for (const id of toPlace) {
    const v = byId.get(id)!;
    const p = pOf(v, ctx, stats);
    const out = processOut(v, ctx.date);
    const rep = reportOut(v, ctx.date);
    const row: Row = {
      caseId: id,
      type: v.nextPurpose,
      order: 0,
      callTime: null,
      window: null,
      standby: false,
      expectedMinutes: round(expectedMinutes(v, ctx.ref, p), 2),
      pSubstantive: round(p, 3),
      why: [
        "Pinned by the court",
        out ? `${v.process!.kind.replace(/_/g, " ")} not known returned: the hearing may not go ahead` : rep ? "report not known ready: the hearing may not go ahead" : `${Math.round(p * 100)}% chance the hearing moves the case`,
      ].map((w) => sentence(w)),
      pinned: true,
      orig: null,
    };
    const at = rows.findIndex((r) => !r.pinned && dur(r.type) > dur(row.type));
    rows.splice(at < 0 ? rows.length : at, 0, row);
  }
  // times: the policy's own, moved on by the pinned minutes placed before each matter
  if (timed) {
    let shift = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (r.orig !== null && !placeSet.has(r.caseId)) {
        r.callTime = clockAt(r.orig + shift);
        if (isHalfHourWindow(r.window)) r.window = halfHour(r.callTime);
        continue;
      }
      // a placed pin: where the next timed matter would have started, or after the previous one
      const next = rows.slice(i + 1).find((x) => x.orig !== null && !placeSet.has(x.caseId));
      const prev = rows[i - 1];
      const base = next ? next.orig! : prev?.callTime ? benchOffset(prev.callTime) - shift + prev.expectedMinutes : 0;
      r.callTime = clockAt(base + shift);
      r.window = next?.window && !isHalfHourWindow(next.window) ? next.window : prev?.window && !isHalfHourWindow(prev.window) ? prev.window : halfHour(r.callTime);
      shift += r.expectedMinutes;
    }
  }
  const listings: Planned["listings"] = [
    ...rows.map(({ orig: _o, ...l }) => l),
    ...standby.map((l) => ({ ...l, pinned: false })),
  ].map((l, i) => ({ ...l, order: i }));
  const desk = made.desk.filter((d) => !placeSet.has(d.caseId));
  const deferred = made.deferred.filter((d) => !placeSet.has(d.caseId));
  for (const id of drops) {
    deferred.push({ caseId: id, to: safeNextDate(ctxC, policyId, config, byId.get(id)!, "deferred", pol), reason: "Taken off the list by the court" });
  }
  return { plan: { listings, desk, deferred }, overrides: { pinned: pins, dropped: drops, rejected } };
}

// ---------------------------------------------------------------------------------------------
// The response

function blocksFor(eff: JudgeConfig) {
  if (eff.blocks.length === 0) return [{ id: "day", label: "Whole day", start: SITTING.start, end: SITTING.end, types: "all" as const }];
  return eff.blocks.map((b) => ({ id: b.id, label: `${sentence(b.id.replace(/[_-]+/g, " "))} (${b.start} to ${b.end})`, start: b.start, end: b.end, types: b.types }));
}
const benchMinutes = (start: string, end: string) => Math.max(0, benchOffset(end) - benchOffset(start));

function messageFor(kind: "listed" | "standby" | "desk" | "deferred", c: CaseDetail, date: string, extra: { callTime?: string | null; window?: string | null; order?: number; action?: string; to?: string; reason?: string; checkin?: boolean }): string {
  const what = typeLabel(c.nextPurpose).toLowerCase();
  const note = c.lastSummary.notes[0];
  const lastOrder = note ? ` Last order: ${note.length > 160 ? `${note.slice(0, 157).trimEnd()}...` : note}${/[.!?]$/.test(note) ? "" : "."}` : "";
  switch (kind) {
    case "listed": {
      const when = extra.callTime
        ? ` at about ${extra.callTime}${extra.window && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(extra.window) ? ` (between ${extra.window.replace("-", " and ")})` : ""}`
        : `, item ${(extra.order ?? 0) + 1} on the list`;
      const ask = extra.checkin ? " If you cannot proceed, reply NOT READY by 9 am: the slot goes to another matter and you get the earliest next date." : "";
      return `${c.id} is listed on ${longDate(date)}${when} for ${what}.${lastOrder}${ask}`;
    }
    case "standby":
      return `${c.id} is on the standby list on ${longDate(date)} for ${what}. It is called only if a listed matter fails or finishes early; come prepared, and expect to wait.${lastOrder}`;
    case "desk": {
      const why =
        extra.action === "await_report"
          ? "the mediation report has not been received"
          : extra.action === "reissue"
            ? `the ${(c.process?.kind ?? "process").replace(/_/g, " ")} is long overdue and will be re-issued`
            : `the ${(c.process?.kind ?? "process").replace(/_/g, " ")} is not yet known returned`;
      return `${c.id} (${what}): ${why}, so the matter will be taken at the process desk on ${longDate(date)} without a hearing. You need not come.`;
    }
    case "deferred":
      return `${c.id} will not be taken up on ${longDate(date)}. The next date is ${longDate(extra.to!)}. Reason: ${(extra.reason ?? "").replace(/[.]$/, "").toLowerCase()}.`;
  }
}

const emptyExpected = (): Expected => ({
  listed: 0, standby: 0, desk: 0, deferred: 0, minutes: 0, minutesLo: 0, minutesHi: 0, reached: 0, substantive: 0,
  substantiveLo: 0, substantiveHi: 0, overrunRisk: 0, utilisation: 0, minutes4yPlus: 0, share4yPlus: 0,
});

function strList(x: unknown, what: string): string[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.some((s) => typeof s !== "string")) throw new HttpError(400, `${what} must be a list of case ids`);
  return (x as string[]).map((s) => s.trim()).filter(Boolean);
}

/** A fresh policy's plan on the captured morning (policies keep ledgers; a fresh one starts from the views). */
export function freePlan(policyId: string, config: Partial<JudgeConfig> | undefined, ctx: PlanContext): DayPlan {
  return makePolicy(policyId, config).plan(ctx);
}

export async function planHandler(body: Record<string, unknown>) {
  const date = checkDate(body.date);
  const policy = checkPolicy(body.policy);
  const config = cleanConfig(body.config);
  const eff = effectiveConfig(policy, config);
  const pin = strList(body.pin, "pin");
  const drop = strList(body.drop, "drop");
  const env = getEnv();
  const pol0 = makePolicy(policy, config);
  if (!inHorizon(date)) throw new HttpError(400, "date outside the horizon", `plans are made for ${HORIZON.start} to ${HORIZON.end}`);
  const head = { date, policy, policyName: pol0.name, config: eff };
  if (!isWorkingDay(date, env.calendar)) {
    const next = nextWorkingDayOnOrAfter(date, env.calendar);
    return {
      ...head,
      workingDay: false,
      nextWorkingDay: next <= HORIZON.end ? next : null,
      capacityMinutes: CAPACITY,
      sitting: SITTING,
      listings: [],
      desk: [],
      deferred: [],
      expected: emptyExpected(),
      load: { capacityMinutes: CAPACITY, blocks: [], byType: [], cumulative: [] },
      unconstrained: null,
      delta: null,
      overrides: { pinned: [], dropped: [], rejected: [...pin, ...drop].map((caseId) => ({ caseId, reason: "The court does not sit on this day" })) },
      messages: [],
    };
  }

  const st = await stateAt(policy, config, date);
  const ctx = st.ctx;
  const stats = statsOf(ctx);
  const free = freePlan(policy, config, ctx);
  const constrained = pin.length || drop.length ? constrain(policy, config, ctx, free, pin, drop) : null;
  const plan: Planned = constrained ? constrained.plan : { ...asPlanned(free), listings: free.listings.map((l) => ({ ...l, pinned: false, why: whyOf(l.why, false) })) };
  const load = expectedOf(plan, ctx);
  const freeLoad = constrained ? expectedOf(asPlanned(free), ctx).expected : null;

  const byId = new Map(ctx.cases.map((c) => [c.id, c]));
  const details = new Map<string, CaseDetail>();
  const detail = (id: string) => {
    let d = details.get(id);
    if (!d) details.set(id, (d = caseDetail(byId.get(id)!, ctx, stats)));
    return d;
  };
  const blocks = blocksFor(eff);
  const blockOf = (l: Listing): string | null => {
    if (blocks.length === 1 && blocks[0]!.id === "day") return "day";
    if (l.callTime) {
      const t = toMinutes(l.callTime);
      const b = blocks.find((x) => t >= toMinutes(x.start) && t < toMinutes(x.end));
      if (b) return b.id;
    }
    return blocks.find((x) => x.types === "all" || x.types.includes(l.type))?.id ?? null;
  };
  const listings = plan.listings
    .slice()
    .sort((a, b) => Number(a.standby) - Number(b.standby) || a.order - b.order)
    .map((l, i) => {
      const est = load.perListing.get(l.caseId);
      return {
        caseId: l.caseId,
        type: l.type,
        order: i,
        callTime: l.standby ? null : l.callTime,
        window: l.standby ? "standby" : l.window,
        standby: l.standby,
        expectedMinutes: round(est?.m ?? l.expectedMinutes, 1),
        pSubstantive: round(est?.p ?? l.pSubstantive, 3),
        why: l.why.length ? l.why : [l.standby ? "On standby: called if a listed matter fails or finishes early" : "Due today"],
        pinned: l.pinned,
        block: blockOf(l),
        case: detail(l.caseId),
      };
    });
  const mainListings = listings.filter((l) => !l.standby);
  const desk = plan.desk.map((d) => {
    const v = byId.get(d.caseId)!;
    return {
      caseId: d.caseId,
      action: d.action,
      kind: d.action === "await_report" || !v.process ? ("mediation_report" as const) : v.process.kind,
      note: sentence(d.note, true),
      case: detail(d.caseId),
    };
  });
  const deferred = plan.deferred.map((d) => ({ caseId: d.caseId, to: d.to, reason: sentence(d.reason), case: detail(d.caseId) }));

  const byTypeMap = new Map<HearingType, { listed: number; expectedMinutes: number }>();
  for (const l of mainListings) {
    const e = byTypeMap.get(l.type) ?? { listed: 0, expectedMinutes: 0 };
    e.listed++;
    e.expectedMinutes += l.expectedMinutes;
    byTypeMap.set(l.type, e);
  }
  const loadOut = {
    capacityMinutes: CAPACITY,
    blocks: blocks.map((b) => {
      const mine = mainListings.filter((l) => l.block === b.id);
      return {
        id: b.id,
        label: b.label,
        start: b.start,
        end: b.end,
        capacityMinutes: b.id === "day" ? CAPACITY : benchMinutes(b.start, b.end),
        expectedMinutes: round(mine.reduce((s, l) => s + l.expectedMinutes, 0), 1),
        listed: mine.length,
      };
    }),
    byType: [...byTypeMap.entries()]
      .map(([type, e]) => ({ type, label: typeLabel(type), listed: e.listed, expectedMinutes: round(e.expectedMinutes, 1) }))
      .sort((a, b) => b.expectedMinutes - a.expectedMinutes),
    cumulative: load.cumulative.map((c, i) => ({ ...c, order: i })),
  };

  const e = load.expected;
  const delta = freeLoad
    ? {
        listed: e.listed - freeLoad.listed,
        substantive: round(e.substantive - freeLoad.substantive, 1),
        minutes: round(e.minutes - freeLoad.minutes, 1),
        utilisation: round(e.utilisation - freeLoad.utilisation, 3),
        overrunRisk: round(e.overrunRisk - freeLoad.overrunRisk, 3),
        minutes4yPlus: round(e.minutes4yPlus - freeLoad.minutes4yPlus, 1),
      }
    : null;

  const checkin = pol0.asksCheckin;
  const messages = [
    ...listings.map((l) => ({
      caseId: l.caseId,
      to: l.case.advocateId,
      channel: "sms" as const,
      kind: l.standby ? ("standby" as const) : ("listed" as const),
      text: messageFor(l.standby ? "standby" : "listed", l.case, date, { callTime: l.callTime, window: l.window, order: l.order, checkin }),
    })),
    ...desk.map((d) => ({ caseId: d.caseId, to: d.case.advocateId, channel: "sms" as const, kind: "desk" as const, text: messageFor("desk", d.case, date, { action: d.action }) })),
    ...deferred.map((d) => ({ caseId: d.caseId, to: d.case.advocateId, channel: "sms" as const, kind: "deferred" as const, text: messageFor("deferred", d.case, date, { to: d.to, reason: d.reason }) })),
  ];

  return {
    ...head,
    workingDay: true,
    capacityMinutes: CAPACITY,
    sitting: SITTING,
    listings,
    desk,
    deferred,
    expected: e,
    load: loadOut,
    unconstrained: freeLoad,
    delta,
    overrides: constrained ? constrained.overrides : { pinned: [], dropped: [], rejected: [] },
    messages,
  };
}
