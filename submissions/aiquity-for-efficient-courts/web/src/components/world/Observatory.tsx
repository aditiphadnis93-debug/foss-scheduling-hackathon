"use client";

/**
 * /observatory: the town, the court and the people on one clock. One scrubber drives all
 * three; selecting a person, dispute or case in any pane highlights it everywhere.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { Briefcase, ExternalLink, Pause, Play, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { OUTCOME_COLOR, OUTCOME_LABEL, PEOPLE_COLOR, fmtDate, loadWorld, type CourtLine, type World } from "@/lib/world";
import { listAgentScenarios, loadAgents, type AgentsData, type Step, type Agent } from "@/lib/people";
import { caseHref, clockText, fetchRun, isAiDecision, parseWindow, sittingsOf, townEventDays, type TownEventDay } from "@/lib/world-case";
import { WorldClock } from "./clock";
import { DAY } from "./palette";
import { Panel } from "./ui";
import ColorLegend from "./ColorLegend";
import TownChanges, { useTownScenarios } from "./TownChanges";

const TownScene = dynamic(() => import("./TownScene"), { ssr: false, loading: () => <div className="absolute inset-0 animate-pulse bg-[var(--surface-2)]" /> });

/** one matter on the day's list, with the minutes recorded for it */
type Matter = CourtLine;
type RunListing = { case_id: string; start?: string; end?: string; purpose?: string; advocate?: string; exp_min?: number;
  outcome?: { kind?: string; reason?: string | null; minutes?: number; next_date?: string | null } | null };
type RunDay = { date: string; listings?: RunListing[]; sitting_windows?: unknown };

export type Slot = { planStart: number; planEnd: number; start: number; end: number; reached: boolean; slide: number; timed: boolean };
type DayPlan = { slots: Map<string, Slot>; sittings: [number, number][]; open: number; close: number };

/** place a time inside the sittings: a time in a break moves to the next sitting */
function inSitting(t: number, sittings: [number, number][]) {
  for (const [a, b] of sittings) { if (t < a) return a; if (t < b) return t; }
  return t;
}

/**
 * How the day ran, from recorded numbers only: each matter is planned at its window start (or after
 * the matter before it, at its expected minutes) and actually runs for its recorded minutes.
 * The slide is the actual start minus the planned start.
 */
export function runDay(lines: Matter[], sittingsRaw: unknown): DayPlan {
  const sittings = sittingsOf(sittingsRaw);
  const open = sittings[0][0], close = sittings[sittings.length - 1][1];
  const slots = new Map<string, Slot>();
  const order = lines.map((l, i) => ({ l, i, w: parseWindow(l.window) })).sort((x, y) => x.w[0] - y.w[0] || x.i - y.i);
  let planCursor = open, actCursor = open;
  for (const { l, w } of order) {
    const timed = l.minutes != null && l.expMin != null;
    if (!timed) { slots.set(l.caseId, { planStart: w[0], planEnd: w[1], start: w[0], end: w[0], reached: false, slide: 0, timed: false }); continue; }
    const planStart = inSitting(Math.max(w[0], planCursor), sittings);
    const planEnd = planStart + (l.expMin ?? 0);
    planCursor = planEnd;
    const reached = l.outcome !== "not_reached" && (l.minutes ?? 0) > 0;
    const start = inSitting(Math.max(w[0], actCursor), sittings);
    const end = reached ? start + (l.minutes ?? 0) : start;
    if (reached) actCursor = end;
    slots.set(l.caseId, { planStart, planEnd, start, end, reached, slide: reached ? Math.max(0, start - planStart) : 0, timed: true });
  }
  return { slots, sittings, open, close };
}

/** the day's list with recorded minutes: the town's own list when it carries minutes, else the court run for that date */
function mattersFor(world: World, day: number, run: Map<string, RunDay>): { lines: Matter[]; sittings: unknown } {
  const d = world.days[day];
  if (!d) return { lines: [], sittings: null };
  const rd = run.get(d.date);
  if (d.lines.some((l) => l.minutes != null) || !rd?.listings?.length) return { lines: d.lines, sittings: d.sittings ?? rd?.sitting_windows ?? null };
  const kinds = ["substantive", "adjourned", "not_reached", "not_ready"];
  const lines: Matter[] = rd.listings.map((l) => ({
    caseId: String(l.case_id), disputeIdx: world.disputeOfCase.get(String(l.case_id)) ?? -1, origin: "roster",
    window: l.start && l.end ? `${l.start}-${l.end}` : "", purpose: String(l.purpose ?? ""), advocate: String(l.advocate ?? ""),
    outcome: kinds.includes(String(l.outcome?.kind)) ? (l.outcome!.kind as Matter["outcome"]) : null,
    reason: l.outcome?.reason ?? null, nextDate: l.outcome?.next_date ?? null, stakeholder: null,
    minutes: typeof l.outcome?.minutes === "number" ? l.outcome.minutes : null, expMin: typeof l.exp_min === "number" ? l.exp_min : null,
  }));
  return { lines, sittings: d.sittings ?? rd.sitting_windows ?? null };
}

type Sel = { caseId: string | null };

export default function Observatory() {
  const [world, setWorld] = useState<World | null>(null);
  const [agents, setAgents] = useState<AgentsData | null>(null);
  const [clock] = useState(() => new WorldClock(1));
  const [day, setDay] = useState(0);
  const [minute, setMinute] = useState(540);
  const [run, setRun] = useState<Map<string, RunDay>>(new Map());
  const spanRef = useRef<[number, number]>([600, 990]);
  const [events, setEvents] = useState<Map<string, TownEventDay>>(new Map());
  const [oneWorld, setOneWorld] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sel, setSel] = useState<Sel>({ caseId: null });
  const townScenarios = useTownScenarios();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const headRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadWorld().then((w) => { if (alive) setWorld(w); }).catch(() => {});
    fetchRun<{ days?: RunDay[]; meta?: Record<string, unknown> }>().then((j) => {
      if (!alive || !j?.days) return;
      setRun(new Map(j.days.map((d) => [d.date, d])));
      setEvents(townEventDays(j.meta));
      setOneWorld(!!(j.meta as { combined?: unknown } | undefined)?.combined);
    }).catch(() => {});
    // the agent run that covers the most of the town's days
    listAgentScenarios().then(async (list) => {
      const runs = await Promise.all(list.filter((s) => s.id !== "demo").map((s) => loadAgents(s.id).catch(() => null)));
      const ok = runs.filter((r): r is AgentsData => !!r && !r.mock);
      const best = ok.find((r) => r.scenario === "100_combined") ?? ok.sort((a, b) => b.days.length - a.days.length)[0] ?? (await loadAgents("demo").catch(() => null));
      if (alive) setAgents(best);
    });
    let gl = false;
    try { const c = document.createElement("canvas"); gl = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { gl = false; }
    queueMicrotask(() => { if (alive) setWebgl(gl); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!world) return;
    clock.setDays(world.days.length);
    clock.setSecondsPerDay(9);
    clock.setSpeed(1);
    clock.setFocus({ kind: "overview" });
    clock.seek(0.02);
  }, [world, clock]);

  useEffect(() => {
    if (!world) return;
    let raf = 0, last = performance.now(), lastDay = -1, lastMin = -999;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (clock.advance(dt)) setPlaying(false);
      if (clock.day !== lastDay) { lastDay = clock.day; setDay(lastDay); }
      const [o, c] = spanRef.current;
      const m = Math.round(Math.max(o - 60, Math.min(c + 30, o + ((clock.phase - 0.1) / 0.8) * (c - o))) / 5) * 5;
      if (m !== lastMin) { lastMin = m; setMinute(m); }
      if (headRef.current) headRef.current.style.left = `${(clock.t / world.days.length) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, clock]);

  const selectCase = useCallback((caseId: string | null) => {
    setSel({ caseId });
    const d = caseId && world ? world.disputeOfCase.get(caseId) ?? -1 : -1;
    clock.select(d, -1);
    if (d >= 0) clock.setFocus({ kind: "dispute", idx: d, dist: 40 });
  }, [world, clock]);

  const onPickPerson = useCallback((i: number) => {
    if (!world) return;
    const ds = world.disputesOf[i] ?? [];
    const k = ds.find((x) => world.disputes[x].caseId) ?? ds[0] ?? -1;
    const caseId = k >= 0 ? world.disputes[k].caseId : null;
    setSel({ caseId });
    clock.select(k, i);
    clock.setFocus(k >= 0 ? { kind: "dispute", idx: k, dist: 40 } : { kind: "person", idx: i, dist: 24 });
  }, [world, clock]);

  const seek = useCallback((d: number, frac = 0.02) => {
    if (!world) return;
    clock.seek(Math.max(0, Math.min(world.days.length - 1, d)) + frac);
    setDay(clock.day);
  }, [world, clock]);

  const date = world?.days[day]?.date ?? "";
  const strike = events.get(date) ?? null;
  const agentDay = useMemo(() => {
    if (!agents || !date) return [] as { agent: Agent; step: Step }[];
    const i = agents.days.indexOf(date);
    if (i < 0) return [];
    return (agents.byDay[i] ?? []).flatMap((h) => h.parties).sort((a, b) => parseWindow(a.step.window)[0] - parseWindow(b.step.window)[0]);
  }, [agents, date]);

  const matters = useMemo(() => (world ? mattersFor(world, day, run) : { lines: [] as Matter[], sittings: null }), [world, day, run]);
  const dayPlan = useMemo(() => runDay(matters.lines, matters.sittings), [matters]);
  useEffect(() => { spanRef.current = [dayPlan.open, dayPlan.close]; }, [dayPlan]);

  if (!world) return <div className="flex h-[60vh] items-center justify-center text-sm text-[var(--text-muted,var(--muted,#65758B))]">Loading the observatory</div>;
  const dm = world.days[day];

  return (
    <div className="pb-10 text-[var(--text)]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">Observatory</span>
            {oneWorld && <span className="rounded-full bg-[var(--primary-subtle,#F0F6FF)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--primary-strong,#1E3B8A)]">One world: town + AI agents + court</span>}
            {strike && <span className="rounded-full bg-[var(--c-adjourned,#F59F0A)]/15 px-2.5 py-0.5 text-[11px] font-medium text-[var(--c-adjourned,#F59F0A)]">{strike.label} today</span>}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">The town, the court and the people, together</h1>
          <p className="mt-1 text-sm text-[var(--text-muted,var(--muted,#65758B))]">One clock drives all three. Pick anyone or any case to follow it across every view.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const v = !clock.playing; clock.setPlaying(v); setPlaying(v); }} aria-label={playing ? "Pause" : "Play"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary,#2463EB)] text-white hover:bg-[var(--primary-hover,#3C83F6)]">
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <div className="flex rounded-lg border border-[var(--border,var(--line,#E1E7EF))] p-0.5">
            {[1, 4, 16].map((s) => (
              <button key={s} type="button" onClick={() => { clock.setSpeed(s); setSpeed(s); }}
                className={clsx("h-8 rounded-md px-2.5 font-mono text-xs", speed === s ? "bg-[var(--primary-subtle,#F0F6FF)] text-[var(--primary-strong,#1E3B8A)]" : "text-[var(--text-muted,var(--muted,#65758B))]")}>{s}x</button>
            ))}
          </div>
          <div className="min-w-[150px] text-right">
            <div className="text-lg font-semibold">{fmtDate(date, { weekday: "short", day: "numeric", month: "short" })}</div>
            <div className="font-mono text-xs text-[var(--text-muted,var(--muted,#65758B))]">court clock {minute < dayPlan.open ? `before ${clockText(dayPlan.open)}` : minute > dayPlan.close ? `court has risen (${clockText(dayPlan.close)})` : clockText(minute)}</div>
          </div>
        </div>
      </header>

      <ColorLegend row storageKey="observatory.key.open" className="mb-3" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* town */}
        <Panel flat className="relative h-[440px] overflow-hidden">
          {webgl ? (
            <TownScene world={world} clock={clock} day={day} palette={DAY} labels={labelRefs} showLabels={false}
              onPickPerson={onPickPerson} onPickDispute={(k) => selectCase(world.disputes[k]?.caseId ?? null)}
              onUserCamera={() => clock.setFocus(null)} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted,var(--muted,#65758B))]">3D needs WebGL</div>
          )}
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]/90 px-3 py-2 text-xs">
            <div className="font-semibold">The town</div>
            <div className="text-[var(--text-muted,var(--muted,#65758B))]">{dm.quarrels.length} quarrels · {dm.filings.length} filings · {dm.resolutions.length} resolved today</div>
            {strike && <div className="mt-1 font-medium text-[var(--c-adjourned,#F59F0A)]">{strike.label}: {strike.extraAbsent > 0 ? `${strike.extraAbsent} people stuck at home, ` : "people stuck at home, "}no way to reach the court</div>}
          </div>
        </Panel>

        {/* court */}
        <CourtLanes lines={matters.lines} plan={dayPlan} minute={minute} selected={sel.caseId} onSelect={selectCase} strike={strike} />
      </div>

      <PeopleTicker rows={agentDay} plan={dayPlan.slots} strike={strike} minute={minute} selected={sel.caseId} onSelect={selectCase} hasAgents={!!agents} />

      <Strip world={world} agents={agents} selected={sel.caseId} onSeek={seek} headRef={headRef} />
      {townScenarios && <div className="mt-4"><TownChanges data={townScenarios} compact /></div>}
    </div>
  );
}

function CourtLanes({ lines, plan: day, minute, selected, onSelect, strike }: { lines: Matter[]; plan: DayPlan; minute: number; selected: string | null; onSelect: (c: string | null) => void; strike: TownEventDay | null }) {
  const plan = day.slots;
  const span = Math.max(1, day.close - day.open);
  const pct = (m: number) => `${((Math.max(day.open, Math.min(day.close, m)) - day.open) / span) * 100}%`;
  const len = (m: number) => `${(Math.max(0, m) / span) * 100}%`;
  const ticks: [number, string][] = [];
  for (let t = Math.ceil(day.open / 60) * 60; t <= day.close; t += 60) if (t - day.open >= 25 && day.close - t >= 25) ticks.push([t, clockText(t)]);
  if (!ticks.some(([t]) => t === day.open)) ticks.unshift([day.open, clockText(day.open)]);
  if (!ticks.some(([t]) => t === day.close)) ticks.push([day.close, clockText(day.close)]);
  const breaks = day.sittings.slice(1).map(([a], i) => [day.sittings[i][1], a] as [number, number]);
  const running = [...plan.values()].find((p) => p.reached && minute >= p.start && minute < p.end);
  const late = running ? Math.round(running.slide) : 0;
  const dayOver = minute >= day.close;
  const untimed = lines.filter((l) => !plan.get(l.caseId)?.timed).length;
  return (
    <Panel flat className="flex h-[440px] flex-col overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-[var(--border,var(--line,#E1E7EF))] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">The court</div>
          <div className="text-xs text-[var(--text-muted,var(--muted,#65758B))]">
            {lines.length} matters. Outline = planned (expected minutes); fill = recorded minutes.{untimed > 0 && ` ${untimed} without recorded minutes show their window only.`}
            {strike && <span className="ml-1 font-medium text-[var(--c-adjourned,#F59F0A)]">{strike.label}: {lines.filter((l) => /absen/i.test(l.reason ?? "")).length} matters lost to absence.</span>}
            {running && <span className={late > 5 ? "ml-1 font-medium text-[var(--c-adjourned,#F59F0A)]" : "ml-1"}>{late > 5 ? `Running ${late} min behind.` : "On time."}</span>}
          </div>
        </div>
        <div className="flex gap-2 text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">
          {(Object.keys(OUTCOME_LABEL) as (keyof typeof OUTCOME_LABEL)[]).map((k) => (
            <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: OUTCOME_COLOR[k] }} />{OUTCOME_LABEL[k]}</span>
          ))}
        </div>
      </div>
      <div className="relative ml-[118px] mr-4 mt-2 h-4 text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">
        {ticks.map(([t, l]) => <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap font-mono" style={{ left: pct(t) }}>{l}</span>)}
      </div>
      <div className="relative flex-1 overflow-y-auto px-4 pb-3">
        {breaks.map(([a, b]) => (
          <div key={a} className="pointer-events-none absolute bottom-0 top-0 z-0 ml-[102px] bg-[var(--surface-2)]"
            style={{ left: `calc(16px + (100% - 134px) * ${(a - day.open) / span})`, width: `calc((100% - 134px) * ${(b - a) / span})` }} title={`break ${clockText(a)}-${clockText(b)}`} />
        ))}
        <div className="pointer-events-none absolute bottom-0 top-0 z-10 ml-[102px] w-px bg-[var(--primary,#2463EB)]"
          style={{ left: `calc(16px + (100% - 134px) * ${Math.max(0, Math.min(1, (minute - day.open) / span))})`, opacity: minute < day.open || dayOver ? 0 : 1 }} />
        {lines.map((l, i) => {
          const p = plan.get(l.caseId);
          if (!p) return null;
          const col = l.outcome ? OUTCOME_COLOR[l.outcome] : "var(--c-baseline,#9CA3B0)";
          const started = p.reached && minute >= p.start;
          const done = p.reached && minute >= p.end;
          const frac = !started ? 0 : done ? 1 : (minute - p.start) / Math.max(1, p.end - p.start);
          const missed = p.timed && !p.reached && (dayOver || minute >= p.planEnd + 30);
          const untimedDone = !p.timed && minute >= p.planEnd;
          const isSel = selected === l.caseId;
          const lostToStrike = !!strike && /absen/i.test(l.reason ?? "");
          return (
            <button key={`${l.caseId}-${i}`} type="button" onClick={() => onSelect(isSel ? null : l.caseId)} title={lostToStrike ? `${l.reason} (${strike!.label})` : l.reason ?? undefined}
              className={clsx("flex w-full items-center gap-2 rounded-md py-[3px] text-left", isSel ? "bg-[var(--primary-subtle,#F0F6FF)]" : lostToStrike ? "bg-[var(--c-adjourned,#F59F0A)]/10 shadow-[inset_2px_0_0_var(--c-adjourned,#F59F0A)]" : "hover:bg-[var(--surface-2)]")}>
              <span className={clsx("w-[100px] shrink-0 truncate font-mono text-[10.5px]", isSel ? "text-[var(--primary-strong,#1E3B8A)]" : "text-[var(--text-muted,var(--muted,#65758B))]")}>{l.caseId}</span>
              <span className="relative h-3.5 flex-1">
                {/* the time it was given */}
                <span className="absolute inset-y-0 rounded-sm border border-dashed transition-colors duration-300"
                  style={{ left: pct(p.planStart), width: len(Math.max(2, p.planEnd - p.planStart)), borderColor: missed ? OUTCOME_COLOR.not_reached : untimedDone ? col : "var(--border,var(--line,#E1E7EF))",
                    background: missed ? `color-mix(in srgb, ${OUTCOME_COLOR.not_reached} 14%, transparent)` : untimedDone ? `color-mix(in srgb, ${col} 18%, transparent)` : "transparent" }} />
                {/* when it actually ran */}
                {p.reached && started && (
                  <span className="absolute inset-y-[2px] rounded-sm transition-[width] duration-150"
                    style={{ left: pct(p.start), width: len(Math.max(0.8, (p.end - p.start) * frac)), background: done ? col : "var(--primary,#2463EB)" }} />
                )}
                {p.reached && started && p.slide > 5 && (
                  <span className="absolute -top-[1px] whitespace-nowrap font-mono text-[9px] text-[var(--c-adjourned,#F59F0A)]" style={{ left: `calc(${pct(p.end)} + 4px)` }}>+{Math.round(p.slide)} min</span>
                )}
              </span>
            </button>
          );
        })}
        {!lines.length && <div className="py-6 text-sm text-[var(--text-muted,var(--muted,#65758B))]">No cause list for this day.</div>}
      </div>
      {selected && (
        <div className="flex items-center justify-between border-t border-[var(--border,var(--line,#E1E7EF))] px-4 py-2 text-xs">
          <span>Following <span className="font-mono">{selected}</span></span>
          <Link href={caseHref(selected)} className="inline-flex items-center gap-1 text-[var(--primary,#2463EB)] hover:underline">Open case file <ExternalLink size={12} /></Link>
        </div>
      )}
    </Panel>
  );
}

function statusOf(step: Step, minute: number, slot?: Slot, strike?: TownEventDay | null) {
  if (strike && !step.appear) return { label: `could not reach court: ${strike.label.toLowerCase()}`, tone: PEOPLE_COLOR.dispute };
  const [a, b] = slot && slot.reached ? [slot.start, slot.end] : parseWindow(step.window);
  if (!step.appear) return { label: minute < a ? "stayed home" : "absent", tone: PEOPLE_COLOR.dispute };
  if (minute < a - 45) return { label: "travelling", tone: PEOPLE_COLOR.court };
  if (minute < a) return { label: "waiting outside", tone: "var(--text-muted,var(--muted,#65758B))" };
  if (minute < b) return { label: "in the courtroom", tone: PEOPLE_COLOR.court };
  return { label: OUTCOME_LABEL[step.outcome].toLowerCase(), tone: OUTCOME_COLOR[step.outcome] };
}

function PeopleTicker({ rows, plan, strike, minute, selected, onSelect, hasAgents }: { rows: { agent: Agent; step: Step }[]; plan: Map<string, Slot>; strike: TownEventDay | null; minute: number; selected: string | null; onSelect: (c: string | null) => void; hasAgents: boolean }) {
  const travelling = rows.filter((r) => statusOf(r.step, minute, plan.get(r.step.caseId), strike).label === "travelling").length;
  const inside = rows.filter((r) => statusOf(r.step, minute, plan.get(r.step.caseId), strike).label === "in the courtroom").length;
  const absent = rows.filter((r) => !r.step.appear).length;
  return (
    <Panel flat className="mt-4 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border,var(--line,#E1E7EF))] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">The people</div>
          <div className="text-xs text-[var(--text-muted,var(--muted,#65758B))]">Every advocate and litigant listed today, where they are now, and what they decided</div>
        </div>
        <div className="flex gap-3 font-mono text-xs text-[var(--text-muted,var(--muted,#65758B))]">
          <span>{travelling} travelling</span><span>{inside} in court</span><span>{absent} stayed away</span>
        </div>
      </div>
      <div className="grid max-h-[300px] gap-x-4 overflow-y-auto px-4 py-2 md:grid-cols-2">
        {rows.map(({ agent, step }, i) => {
          const st = statusOf(step, minute, plan.get(step.caseId), strike);
          const decided = minute >= parseWindow(step.window)[0] || !step.appear;
          const isSel = selected === step.caseId;
          return (
            <motion.button key={`${agent.id}-${step.caseId}-${i}`} type="button" layout="position" onClick={() => onSelect(isSel ? null : step.caseId)}
              className={clsx("flex items-start gap-2 rounded-md px-2 py-1.5 text-left", isSel ? "bg-[var(--primary-subtle,#F0F6FF)]" : "hover:bg-[var(--surface-2)]")}>
              <span className="mt-0.5 text-[var(--text-muted,var(--muted,#65758B))]">{agent.role === "advocate" ? <Briefcase size={12} /> : <User size={12} />}</span>
              <span className="w-[92px] shrink-0 truncate font-mono text-[11px]">{agent.name}</span>
              <span className={clsx("shrink-0 text-[11px] font-medium", st.label.startsWith("could not") ? "w-auto max-w-[220px] truncate" : "w-[104px]")} style={{ color: st.tone }} title={st.label}>{st.label}</span>
              <span className="min-w-0 truncate text-[11px] text-[var(--text-muted,var(--muted,#65758B))]" title={decided ? step.rationale : undefined}>
                {decided && isAiDecision(step.source) && <span className="mr-1 rounded bg-[var(--primary-subtle,#F0F6FF)] px-1 py-px text-[9.5px] font-semibold text-[var(--primary-strong,#1E3B8A)]">AI</span>}
                {decided ? step.rationale : `${step.caseId} at ${step.window}`}
              </span>
            </motion.button>
          );
        })}
        {!rows.length && <div className="py-4 text-sm text-[var(--text-muted,var(--muted,#65758B))]">{hasAgents ? "No agent listings recorded for this day." : "Loading agents"}</div>}
      </div>
    </Panel>
  );
}

function Strip({ world, agents, selected, onSeek, headRef }: { world: World; agents: AgentsData | null; selected: string | null; onSeek: (d: number) => void; headRef: React.RefObject<HTMLDivElement | null> }) {
  const n = world.days.length;
  const rows = useMemo(() => world.days.map((d) => {
    const agentIdx = agents ? agents.days.indexOf(d.date) : -1;
    const parties = agentIdx >= 0 ? agents!.byDay[agentIdx].flatMap((h) => h.parties) : [];
    return {
      town: d.quarrels.length + d.filings.length + d.resolutions.length, filings: d.filings.length, res: d.resolutions.length,
      lines: d.lines.length, sub: d.lines.filter((l) => l.outcome === "substantive").length,
      people: parties.length, came: parties.filter((p) => p.step.appear).length,
      mark: selected ? d.lines.some((l) => l.caseId === selected) : false,
    };
  }), [world, agents, selected]);
  const mt = Math.max(1, ...rows.map((r) => r.town)), ml = Math.max(1, ...rows.map((r) => r.lines)), mp = Math.max(1, ...rows.map((r) => r.people));
  const trackRef = useRef<HTMLDivElement>(null);
  const at = (x: number) => { const r = trackRef.current?.getBoundingClientRect(); if (r) onSeek(Math.floor(((x - r.left) / r.width) * n)); };
  const lane = (label: string, render: (r: (typeof rows)[number]) => React.ReactNode) => (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">{label}</span>
      <div className="flex h-8 flex-1 items-end gap-px">{rows.map((r, i) => <div key={i} className="relative flex h-full flex-1 flex-col justify-end">{render(r)}</div>)}</div>
    </div>
  );
  return (
    <Panel flat className="mt-4 px-4 py-3">
      <div className="mb-2 flex justify-between text-xs">
        <span className="font-semibold">Everything, day by day</span>
        <span className="text-[var(--text-muted,var(--muted,#65758B))]">{selected ? <>dots mark the days <span className="font-mono">{selected}</span> was listed</> : "click a day to jump"}</span>
      </div>
      <div ref={trackRef} className="relative cursor-pointer space-y-1.5" onPointerDown={(e) => at(e.clientX)} onPointerMove={(e) => { if (e.buttons === 1) at(e.clientX); }}>
        {lane("Town", (r) => (
          <>
            <div className="rounded-t-[2px] bg-[var(--c-adjourned,#F59F0A)]/60" style={{ height: `${((r.town - r.filings - r.res) / mt) * 100}%` }} />
            <div className="bg-[var(--primary,#2463EB)]" style={{ height: `${(r.filings / mt) * 100}%` }} />
            <div className="bg-[var(--c-substantive,#10B77F)]" style={{ height: `${(r.res / mt) * 100}%` }} />
          </>
        ))}
        {lane("Court", (r) => (
          <>
            {r.mark && <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--primary,#2463EB)]" />}
            <div className="rounded-t-[2px] bg-[var(--c-baseline,#9CA3B0)]/60" style={{ height: `${((r.lines - r.sub) / ml) * 100}%` }} />
            <div className="bg-[var(--c-substantive,#10B77F)]" style={{ height: `${(r.sub / ml) * 100}%` }} />
          </>
        ))}
        {lane("People", (r) => (
          <>
            <div className="rounded-t-[2px] bg-[var(--c-adjourned,#F59F0A)]/60" style={{ height: `${((r.people - r.came) / mp) * 100}%` }} />
            <div className="bg-[var(--primary,#2463EB)]/70" style={{ height: `${(r.came / mp) * 100}%` }} />
          </>
        ))}
        <div className="pointer-events-none absolute bottom-0 top-0 ml-[92px] w-[calc(100%-92px)]">
          <div ref={headRef} className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-[var(--text)]" />
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-[92px] font-mono text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">
        <span>{fmtDate(world.days[0].date)}</span>
        <span>town: quarrels, filings (blue), resolved (green) · court: moved forward (green) · people: turned up (blue), stayed away</span>
        <span>{fmtDate(world.days[n - 1].date)}</span>
      </div>
    </Panel>
  );
}

