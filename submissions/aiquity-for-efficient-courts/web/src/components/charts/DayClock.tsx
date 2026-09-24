"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { Day, Listing, Run } from "@/lib/types";
import { buildDay, emergencyOf, type Row } from "@/lib/courtday";
import { isAgent } from "@/lib/agents";
import { C, OUTCOME_COLOUR, OUTCOME_LABEL } from "@/lib/theme";
import { ageFromWhy, pretty, toHHMM, toMin } from "@/lib/format";
import { phasesOf } from "@/lib/insights";

export type Placed = Listing & {
  item: number;
  callAt: number; // court minutes after day start when the matter is called
  used: number; // minutes the hearing actually took
  winStart: number;
  winEnd: number;
  age: number | null;
};

/** Order the day the way the simulator calls it: by window, higher value first; the clock runs on actual minutes. */
export function placeDay(day: Day, dayStart: string): Placed[] {
  const t0 = toMin(dayStart);
  const sorted = [...day.listings].sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score);
  let clock = 0;
  return sorted.map((l, i) => {
    const used = l.outcome?.minutes ?? 0;
    const p: Placed = {
      ...l,
      item: i + 1,
      callAt: clock,
      used,
      winStart: toMin(l.start) - t0,
      winEnd: toMin(l.end) - t0,
      age: ageFromWhy(l.why),
    };
    clock += used;
    return p;
  });
}

const SPEEDS = [1, 2, 4] as const;

export default function DayClock({
  run,
  day,
  selected,
  onSelect,
  autoPlayKey,
  note,
}: {
  note?: (l: Listing) => string | null;
  run: Run;
  day: Day;
  selected: string | null;
  onSelect: (id: string) => void;
  autoPlayKey: string;
}) {
  const reduce = useReducedMotion();
  const { rows, windows, wall } = useMemo(() => buildDay(run, day), [run, day]);
  const em = emergencyOf(day);
  const endT = Math.max(1, ...rows.map((r) => r.callAt + r.used));
  const D0 = Math.min(windows[0]?.[0] ?? 600, ...rows.map((r) => r.winStart)) - 10;
  const D1 = Math.max(windows[windows.length - 1]?.[1] ?? 990, wall(endT), ...rows.map((r) => r.winEnd)) + 10;
  const x = (m: number) => `${((Math.min(D1, Math.max(D0, m)) - D0) / (D1 - D0)) * 100}%`;
  const wpx = (a: number, b: number) => `max(3px, calc(${x(b)} - ${x(a)}))`;

  // playhead in court minutes -----------------------------------------------------------
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const tRef = useRef(0);
  const baseDuration = 16000;

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    last.current = null;
  }, []);

  useEffect(() => {
    if (!playing) return stop;
    const step = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      const next = Math.min(endT + 0.001, tRef.current + (dt / baseDuration) * endT * speed);
      tRef.current = next;
      setT(next);
      if (next >= endT) {
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return stop;
  }, [playing, speed, endT, stop]);

  useEffect(() => {
    stop();
    const id = requestAnimationFrame(() => {
      tRef.current = reduce ? endT + 0.001 : 0;
      setT(tRef.current);
      setPlaying(!reduce);
    });
    return () => cancelAnimationFrame(id);
  }, [autoPlayKey, reduce, endT, stop]);

  const restart = () => {
    tRef.current = 0;
    setT(0);
    setPlaying(true);
  };

  const lit = (r: Row) => !!r.outcome && t >= r.callAt + 0.0001;
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    if (lit(r) && r.outcome) acc[r.outcome.kind] = (acc[r.outcome.kind] ?? 0) + 1;
    return acc;
  }, {});
  const usedSoFar = rows.reduce((s, r) => s + (lit(r) ? Math.min(r.used, Math.max(0, t - r.callAt)) : 0), 0);
  const current = rows.find((r) => lit(r) && t < r.callAt + r.used);
  const drift = current ? current.callAt - current.plannedAt : 0;

  const groups = useMemo(() => {
    const g: [string, Row[]][] = [];
    const urgent = rows.filter((r) => r.kind === "urgent");
    const list = rows.filter((r) => r.kind === "list");
    const stand = rows.filter((r) => r.kind === "standby");
    if (urgent.length) g.push(["Urgent, from the reserve", urgent]);
    const bySlot = new Map<string, Row[]>();
    for (const r of list) bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
    for (const [slot, rs] of bySlot) g.push([bySlot.size > 1 ? pretty(slot) : "The list", rs]);
    if (stand.length) g.push(["Standby, called into free time", stand]);
    return g;
  }, [rows]);
  const rowH = rows.length > 40 ? 14 : rows.length > 24 ? 18 : 24;
  const ticks: number[] = [];
  for (let m = Math.ceil(D0 / 60) * 60; m <= D1; m += 60) ticks.push(m);
  const breaks = windows.slice(0, -1).map((w, i) => [w[1], windows[i + 1][0]] as [number, number]).filter(([a, b]) => b > a);
  const emFrom = em?.sitting_until_min !== undefined ? wall(Number(em.sitting_until_min)) : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => (t >= endT ? restart() : setPlaying((p) => !p))}
          className="grid h-10 w-10 place-items-center rounded-full bg-primary text-on-primary transition-colors hover:bg-primary-hover"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={17} /> : <Play size={17} className="translate-x-[1px]" />}
        </button>
        <button onClick={restart} className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted hover:text-text" aria-label="Replay">
          <RotateCcw size={16} />
        </button>
        <div className="flex rounded-lg border border-line p-0.5">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={clsx("num rounded-md px-2 py-1 text-[12px]", speed === s ? "bg-surface-2 text-text" : "text-muted")}>
              {s}x
            </button>
          ))}
        </div>
        <div className="ml-1 flex items-baseline gap-2">
          <span className="display num text-[28px] leading-none text-text">{toHHMM(wall(Math.min(t, endT)))}</span>
          <span className="text-[12px] text-muted">
            <span className="num text-text">{Math.round(usedSoFar)}</span> min heard
            {current && Math.abs(drift) >= 1 && (
              <span className={clsx("ml-2", drift > 0 ? "text-adj" : "text-green-strong")}>
                running {Math.abs(Math.round(drift))} min {drift > 0 ? "behind" : "ahead of"} plan
              </span>
            )}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {(["substantive", "adjourned", "not_ready", "not_reached"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OUTCOME_COLOUR[k] }} />
              {OUTCOME_LABEL[k]}
              <span className="num text-text">{counts[k] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative rounded-lg border border-line bg-bg">
        <div className="relative ml-[188px] mr-4 h-8 border-b border-line">
          {ticks.map((m) => (
            <span key={m} className="num absolute top-2 -translate-x-1/2 text-[11px] text-faint" style={{ left: x(m) }}>
              {toHHMM(m)}
            </span>
          ))}
          {breaks.map(([a, b]) => (
            <span key={`bl${a}`} className="absolute top-2 -translate-x-1/2 text-[10px] text-muted" style={{ left: x((a + b) / 2) }}>
              lunch
            </span>
          ))}
        </div>
        <div className="scroll-thin relative max-h-[620px] overflow-y-auto overflow-x-hidden py-2">
          <div className="pointer-events-none absolute bottom-0 left-[188px] right-4 top-0">
            {ticks.map((m) => (
              <span key={m} className="absolute inset-y-0 border-l border-line" style={{ left: x(m) }} />
            ))}
            {breaks.map(([a, b]) => (
              <span key={`b${a}`} className="absolute inset-y-0 bg-surface-2" style={{ left: x(a), width: wpx(a, b) }} />
            ))}
            {emFrom !== null && (
              <span className="absolute inset-y-0" style={{ left: x(emFrom), width: wpx(emFrom, windows[windows.length - 1]?.[1] ?? emFrom), backgroundImage: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--c-danger) 22%, transparent) 0 4px, transparent 4px 10px)" }} />
            )}
            <span className="absolute inset-y-0 z-20 w-px bg-primary" style={{ left: x(wall(Math.min(t, endT))) }} />
          </div>
          {groups.map(([label, grs]) => (
            <div key={label} className="relative">
              <div className="px-4 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div>
              {grs.map((r) => {
                const on = lit(r);
                const col = r.outcome ? OUTCOME_COLOUR[r.outcome.kind] : C.baseline;
                const old = (r.age ?? 0) >= 4;
                const nr = r.outcome?.kind === "not_reached";
                const pA = wall(r.plannedAt);
                const pB = wall(r.plannedAt + r.exp_min);
                const aA = wall(r.callAt);
                const aB = wall(r.callAt + r.used);
                return (
                  <button
                    key={`${r.kind}-${r.case_id}`}
                    onClick={() => r.kind !== "urgent" && onSelect(r.case_id)}
                    className={clsx("group relative flex w-full items-center text-left transition-colors", selected === r.case_id ? "selected-row" : "hover:bg-surface-2")}
                    style={{ height: rowH }}
                    title={note?.(r) ?? undefined}
                  >
                    <span className="flex w-[188px] shrink-0 items-center gap-2 pl-4 pr-2">
                      <span className="num w-5 text-right text-[10px] text-faint">{r.item}</span>
                      <span className={clsx("mono truncate text-[11px]", on ? "text-text" : "text-muted")} style={old ? { color: C.old } : undefined}>
                        {r.case_id}
                      </span>
                      {isAgent(r) && <span className="shrink-0 rounded bg-primary px-1 text-[9px] font-medium leading-[14px] text-on-primary">AI</span>}
                      {rowH >= 18 && <span className="truncate text-[10px] text-faint">{pretty(r.purpose)}</span>}
                    </span>
                    <span className="relative mr-4 h-full flex-1">
                      {/* appointment window */}
                      <span className="absolute top-1/2 -translate-y-1/2 rounded-sm bg-surface-2" style={{ left: x(r.winStart), width: wpx(r.winStart, r.winEnd), height: Math.max(6, rowH - 8) }} />
                      {/* planned: outline */}
                      {!nr && (
                        <span className="absolute top-1/2 -translate-y-1/2 rounded-sm border border-dashed border-faint" style={{ left: x(pA), width: wpx(pA, pB), height: Math.max(6, rowH - 8) }} />
                      )}
                      {/* actual: fill that slides from its planned place to where it really happened */}
                      {nr ? (
                        <motion.span
                          className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[10px]"
                          style={{ left: x(Math.min(D1, aA)), color: C.not_reached }}
                          animate={{ opacity: on ? 1 : 0 }}
                        >
                          <span className="h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px]" style={{ background: C.not_reached }} />
                          {rowH >= 18 && "not reached"}
                        </motion.span>
                      ) : (
                        <motion.span
                          className="absolute top-1/2 -translate-y-1/2 rounded-sm"
                          style={{ width: wpx(aA, aB), height: Math.max(6, rowH - 8), background: col }}
                          initial={false}
                          animate={{ left: on ? x(aA) : x(pA), opacity: on ? 1 : 0 }}
                          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <Phases l={r} />
                        </motion.span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-surface-2" /> appointment window</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm border border-dashed border-faint" /> planned</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm" style={{ background: C.substantive }} /> what happened, coloured by outcome</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-surface-2 ring-1 ring-line" /> lunch</span>
        {emFrom !== null && <span className="flex items-center gap-1.5 text-danger">hatched red: judge unavailable</span>}
        <span className="flex items-center gap-1.5"><span className="mono text-[11px]" style={{ color: C.old }}>case id</span> in coral: pending 4+ years</span>
      </div>
    </div>
  );
}

/** Hearing phases (e.g. call, submissions, order) as segments inside the actual-minutes block. */
function Phases({ l }: { l: Listing }) {
  const ph = phasesOf(l);
  const total = ph.reduce((s, p) => s + p.minutes, 0);
  if (ph.length < 2 || total <= 0) return null;
  return (
    <span className="absolute inset-0 flex overflow-hidden rounded-sm">
      {ph.map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          title={`${p.name}: ${p.minutes.toFixed(1)} min`}
          className="h-full border-r border-bg last:border-r-0"
          style={{ width: `${(p.minutes / total) * 100}%`, background: "var(--bg)", opacity: i % 2 ? 0.28 : 0 }}
        />
      ))}
    </span>
  );
}
