// One court day as it was planned and as it happened: sitting windows, urgent matters from the reserve,
// the main list, standby matters called in, and a judge emergency. Everything reads days[] and audit[].
import type { Day, Listing, Run } from "./types";
import { ageFromWhy, toHHMM, toMin } from "./format";
import { weekOf } from "./dayprofile";

export type Row = Listing & {
  item: number;
  kind: "urgent" | "list" | "standby";
  callAt: number; // court minutes (sitting time elapsed) when called
  plannedAt: number; // court minutes when it was planned to start
  used: number;
  winStart: number; // wall clock, minutes after midnight
  winEnd: number;
  age: number | null;
};

type Urgent = { case_id: string; type?: string; start_min?: number; minutes?: number; from_reserve?: boolean };
type Emergency = { lost_minutes?: number; sitting_until_min?: number; rolled?: string[] } | null;
type AuditLite = { day: string; case_id: string | null; action: string; rule?: string; why?: string; before?: unknown; after?: unknown; actor?: string };

export function windowsOf(run: Run, day: Day): [number, number][] {
  const own = (day as Day & { sitting_windows?: [string | number, string | number][] }).sitting_windows;
  if (Array.isArray(own) && own.length)
    return own.map(([a, b]) => [typeof a === "number" ? a : toMin(a), typeof b === "number" ? b : toMin(b)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const [y, m, d] = day.date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return weekOf(run).days[dow]?.sittings ?? [[630, 1050]];
}

/** Court minutes (sitting time elapsed) to the wall clock, skipping breaks between sittings. */
export function wallClock(windows: [number, number][]) {
  return (t: number) => {
    let rest = t;
    for (const [a, b] of windows) {
      if (rest <= b - a) return a + rest;
      rest -= b - a;
    }
    const last = windows[windows.length - 1];
    return (last ? last[1] : 1050) + rest;
  };
}

export function emergencyOf(day: Day): Emergency {
  const e = (day as Day & { judge_emergency?: Emergency }).judge_emergency;
  return e && typeof e === "object" ? e : null;
}

export function urgentOf(day: Day): Urgent[] {
  const u = (day as Day & { urgent?: Urgent[] | number }).urgent;
  return Array.isArray(u) ? u : [];
}

export function standbyOf(day: Day): Listing[] {
  const s = (day as Day & { standby?: Listing[] }).standby;
  return Array.isArray(s) ? s.filter((l) => l && l.case_id) : [];
}

export function auditFor(run: Run, day: Day): AuditLite[] {
  const a = (run as Run & { audit?: AuditLite[] }).audit;
  return Array.isArray(a) ? a.filter((x) => x.day === day.date) : [];
}

export function buildDay(run: Run, day: Day): { rows: Row[]; windows: [number, number][]; wall: (t: number) => number } {
  const windows = windowsOf(run, day);
  const wall = wallClock(windows);
  const rows: Row[] = [];
  let clock = 0;
  let item = 0;
  for (const u of urgentOf(day)) {
    const mins = Number(u.minutes ?? 0);
    const at = Number(u.start_min ?? clock);
    rows.push({
      case_id: u.case_id, slot: "urgent", start: toHHMM(wall(at)), end: toHHMM(wall(at + mins)), purpose: u.type ?? "URGENT",
      advocate: "", exp_min: mins, p_ahead: 1, p_sub: 1, score: 0, why: [u.from_reserve ? "urgent: heard from the reserve" : "urgent"],
      outcome: { kind: "substantive", reason: null, minutes: mins, next_date: null, next_purpose: null, decided_by: "court" },
      item: ++item, kind: "urgent", callAt: at, plannedAt: at, used: mins, winStart: wall(at), winEnd: wall(at + mins), age: null,
    });
    clock = Math.max(clock, at + mins);
  }
  const sorted = [...day.listings].sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score);
  let planned = 0;
  for (const l of sorted) {
    const used = l.outcome?.minutes ?? 0;
    rows.push({ ...l, item: ++item, kind: "list", callAt: clock, plannedAt: planned, used, winStart: toMin(l.start), winEnd: toMin(l.end), age: ageFromWhy(l.why) });
    clock += used;
    planned += l.exp_min;
  }
  const calledAt = new Map<string, number>();
  for (const a of auditFor(run, day))
    if (a.action === "standby_called" && a.case_id && a.after && typeof a.after === "object" && "at_min" in (a.after as object))
      calledAt.set(a.case_id, Number((a.after as { at_min: number }).at_min));
  for (const l of standbyOf(day)) {
    const used = l.outcome?.minutes ?? 0;
    const at = calledAt.get(l.case_id) ?? clock;
    rows.push({ ...l, item: ++item, kind: "standby", callAt: at, plannedAt: at, used, winStart: toMin(l.start), winEnd: toMin(l.end), age: ageFromWhy(l.why) });
    clock = Math.max(clock, at + used);
  }
  return { rows, windows, wall };
}

// ---------------------------------------------------------------------------------------------
export type Change = { key: string; tone: "bad" | "good" | "info"; title: string; detail: string; minutes?: number; matters?: number; people?: number };
const PEOPLE = 2;

/** What changed today against the plan, each with its impact. */
export function changesToday(run: Run, day: Day): Change[] {
  const { rows } = buildDay(run, day);
  const list = rows.filter((r) => r.kind === "list");
  const out: Change[] = [];
  const audit = auditFor(run, day);

  for (const u of rows.filter((r) => r.kind === "urgent"))
    out.push({ key: `u-${u.case_id}`, tone: "info", title: `Urgent ${u.purpose.toLowerCase().replace(/_/g, " ")} heard from the reserve`, detail: `${u.case_id} took ${u.used.toFixed(0)} minutes before the list began; every listed matter moved back by that much.`, minutes: u.used, matters: list.length, people: PEOPLE });

  const over = list.filter((r) => r.outcome && r.outcome.kind === "substantive" && r.used - r.exp_min >= 5).sort((a, b) => b.used - b.exp_min - (a.used - a.exp_min));
  for (const r of over.slice(0, 4)) {
    const later = list.filter((x) => x.item > r.item && x.outcome?.kind !== "not_reached").length;
    out.push({ key: `o-${r.case_id}`, tone: "bad", title: `${r.case_id} ran ${Math.round(r.used - r.exp_min)} minutes over`, detail: `Planned ${r.exp_min.toFixed(0)} min, took ${r.used.toFixed(0)}. ${later} later matter${later === 1 ? "" : "s"} slipped by up to ${Math.round(r.used - r.exp_min)} minutes.`, minutes: r.used - r.exp_min, matters: later, people: later * PEOPLE });
  }
  const early = list.filter((r) => r.outcome && r.outcome.kind !== "not_reached" && r.exp_min - r.used >= 3);
  if (early.length) {
    const saved = early.reduce((s, r) => s + (r.exp_min - r.used), 0);
    out.push({ key: "early", tone: "good", title: `${early.length} matter${early.length > 1 ? "s" : ""} finished early or did not go ahead`, detail: `The list moved up by ${Math.round(saved)} minutes; later matters were called sooner than their window.`, minutes: saved, matters: early.length, people: early.length * PEOPLE });
  }

  const em = emergencyOf(day);
  if (em) {
    const rolled = em.rolled ?? [];
    out.push({ key: "em", tone: "bad", title: "Judge unavailable for part of the day", detail: `${Math.round(em.lost_minutes ?? 0)} minutes of sitting lost. ${rolled.length} unheard matter${rolled.length === 1 ? "" : "s"} rolled to the next sitting with priority${rolled.length ? `: ${rolled.slice(0, 4).join(", ")}${rolled.length > 4 ? "…" : ""}` : ""}.`, minutes: em.lost_minutes, matters: rolled.length, people: rolled.length * PEOPLE });
  }

  const nr = list.filter((r) => r.outcome?.kind === "not_reached");
  if (nr.length) {
    const to = [...new Set(nr.map((r) => r.outcome?.next_date).filter(Boolean))] as string[];
    out.push({ key: "nr", tone: "bad", title: `${nr.length} matter${nr.length > 1 ? "s" : ""} not reached`, detail: `The day ran out before ${nr.length > 1 ? "they were" : "it was"} called; rolled to ${to.length ? to.slice(0, 3).join(", ") : "the next sitting"} with higher priority.`, matters: nr.length, people: nr.length * PEOPLE });
  }

  const sb = rows.filter((r) => r.kind === "standby");
  if (sb.length) {
    const moved = sb.filter((r) => r.outcome?.kind === "substantive").length;
    out.push({ key: "sb", tone: "good", title: `${sb.length} standby matter${sb.length > 1 ? "s" : ""} called into free time`, detail: `Advocates already in court were heard in time freed by early finishes; ${moved} moved forward.`, minutes: sb.reduce((s, r) => s + r.used, 0), matters: sb.length, people: sb.length * PEOPLE });
  }

  const pre = day.held_back.filter((h) => /^(prerequisite|checklist)/.test(h.reason));
  if (pre.length)
    out.push({ key: "hb", tone: "info", title: `${pre.length} matter${pre.length > 1 ? "s" : ""} held back before anyone travelled`, detail: "A summons, warrant or filing was still missing; the parties were not asked to come for a hearing that could not go ahead.", matters: pre.length, people: pre.length * PEOPLE });
  if ((day.held_back_capacity ?? 0) > 0)
    out.push({ key: "cap", tone: "info", title: `${day.held_back_capacity} ready matters did not fit today`, detail: "They carry a higher priority into the next sittings.", matters: day.held_back_capacity });

  const resch = audit.filter((a) => a.action === "rescheduled").length;
  if (resch)
    out.push({ key: "rs", tone: "info", title: `${resch} provisional date${resch > 1 ? "s" : ""} moved`, detail: "Matters published for a coming day were moved to make room for older or higher-value matters.", matters: resch, people: resch * PEOPLE });
  return out;
}
