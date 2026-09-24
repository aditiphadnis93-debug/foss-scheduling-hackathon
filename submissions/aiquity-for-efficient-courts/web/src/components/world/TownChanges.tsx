"use client";

/**
 * "When the town changes, the court day changes": the same court under a normal week, a
 * transport strike and a monsoon week. Every number comes from world_scenarios_3000.json.
 */
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { fmtDate } from "@/lib/world";

type ScDay = { date: string; listed?: number; moved?: number; absent?: number; town_kept_away?: number; events?: unknown[]; minutes_used?: number };
type ScEvent = { kind?: string; start?: string; days?: number; absent_share?: number; label?: string };
type Scenario = { scenario?: string; events?: ScEvent[]; metrics?: Record<string, number>; wasted_trips?: number; town_kept_away_total?: number; days?: ScDay[] };
type ScFile = { note?: string; scenarios?: Record<string, Scenario> };

const MUTED = "text-[var(--text-muted,var(--muted,#65758B))]";
const ORDER: [string, string][] = [["normal", "Normal week"], ["transport_strike", "Transport strike"], ["monsoon_week", "Monsoon week"]];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function useTownScenarios() {
  const [data, setData] = useState<ScFile | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/data/world_scenarios_3000.json").then((r) => (r.ok ? r.json() : null)).then((j: ScFile | null) => { if (alive && j?.scenarios) setData(j); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return data;
}

/** the scenario's own event days: from each event's start and length, matched to sitting days */
function eventDays(sc: Scenario, dates: string[]) {
  const set = new Map<string, string>();
  const labels = new Set((sc.events ?? []).map((e) => e.label).filter(Boolean));
  for (const e of sc.events ?? []) {
    if (!e.start) continue;
    const i = dates.findIndex((d) => d >= e.start!);
    for (let k = 0; i >= 0 && k < Math.max(1, num(e.days)) && i + k < dates.length; k++) set.set(dates[i + k], e.label ?? e.kind ?? "event");
  }
  for (const d of sc.days ?? []) for (const x of d.events ?? []) if (typeof x === "string" && labels.has(x) && !set.has(d.date)) set.set(d.date, x);
  return set;
}

const KIND_WORD: Record<string, string> = { transport_strike: "strike", heavy_rain: "heavy rain", monsoon: "monsoon" };

export default function TownChanges({ data, compact, onClose }: { data: ScFile; compact?: boolean; onClose?: () => void }) {
  const available = ORDER.filter(([k]) => data.scenarios?.[k]);
  const [pick, setPick] = useState(available.find(([k]) => k !== "normal")?.[0] ?? available[0]?.[0] ?? "normal");
  const normal = data.scenarios?.normal;
  const sc = data.scenarios?.[pick];

  const view = useMemo(() => {
    const base = new Map((normal?.days ?? []).map((d) => [d.date, d]));
    const days = (sc?.days ?? []).map((d) => ({ d, n: base.get(d.date) }));
    const dates = days.map((x) => x.d.date);
    const ev = sc ? eventDays(sc, dates) : new Map<string, string>();
    const maxMoved = Math.max(1, ...days.flatMap((x) => [num(x.d.moved), num(x.n?.moved)]));
    const maxAbs = Math.max(1, ...days.flatMap((x) => [num(x.d.absent), num(x.n?.absent)]));
    const evIdx = days.map((x, i) => (ev.has(x.d.date) ? i : -1)).filter((i) => i >= 0);
    const lost = evIdx.reduce((t, i) => t + Math.max(0, num(days[i].n?.moved) - num(days[i].d.moved)), 0);
    // sitting days after the event until the list had caught up with the normal week (cumulative moved)
    let catchUp: number | null = null;
    if (evIdx.length && normal) {
      const last = evIdx[evIdx.length - 1];
      let cs = 0, cn = 0;
      for (let i = 0; i < days.length; i++) {
        cs += num(days[i].d.moved); cn += num(days[i].n?.moved);
        if (i > last && cs >= cn) { catchUp = i - last; break; }
      }
    }
    const first = evIdx[0];
    return { days, ev, maxMoved, maxAbs, evIdx, lost, catchUp, first };
  }, [sc, normal]);

  if (!sc) return null;
  const label = ORDER.find(([k]) => k === pick)?.[1] ?? pick;
  const kind = KIND_WORD[String(sc.events?.[0]?.kind)] ?? (sc.events?.[0]?.kind ?? label).replace(/_/g, " ").toLowerCase();
  const dispN = num(normal?.metrics?.disposed), dispS = num(sc.metrics?.disposed);
  const takeaway = pick === "normal" || !view.evIdx.length
    ? `A normal week: ${num(sc.metrics?.substantive_total)} hearings moved cases forward and ${dispS} cases closed.`
    : `On the ${view.evIdx.length} ${kind} day${view.evIdx.length === 1 ? "" : "s"} the court lost ${view.lost} hearing${view.lost === 1 ? "" : "s"} that would have moved; `
      + (view.catchUp != null ? `the recommended list re-dated them and caught up within ${view.catchUp} sitting day${view.catchUp === 1 ? "" : "s"}, ` : "the list had not fully caught up by the end of the period, ")
      + `so the posting still closed ${dispS} cases vs ${dispN} in a normal week.`;
  const f = view.first != null ? view.days[view.first] : null;
  const H = compact ? 44 : 64;
  const barW = 100 / Math.max(1, view.days.length);

  const chart = (title: string, key: "moved" | "absent", color: string, max: number) => (
    <div className="mt-3">
      <div className={clsx("mb-1 text-[11px]", MUTED)}>{title}</div>
      <div className="relative" style={{ height: H }}>
        {view.days.map((x, i) => {
          const s = num(x.d[key]), n = num(x.n?.[key]);
          return (
            <div key={x.d.date} className="absolute bottom-0 top-0" style={{ left: `${i * barW}%`, width: `${barW}%` }}
              title={`${fmtDate(x.d.date, { day: "numeric", month: "short" })}: ${s} (${label}) vs ${n} (normal)`}>
              {view.ev.has(x.d.date) && <div className="absolute inset-0 bg-[var(--c-adjourned,#F59F0A)]/12" />}
              <div className="absolute bottom-0 left-[12%] right-[12%] rounded-t-[2px] border border-[var(--c-baseline,#9CA3B0)]" style={{ height: `${(n / max) * 100}%` }} />
              <motion.div className="absolute bottom-0 left-[28%] right-[28%] rounded-t-[2px]" style={{ background: color }}
                initial={{ height: 0 }} animate={{ height: `${(s / max) * 100}%` }} transition={{ duration: 0.5, delay: Math.min(i, 30) * 0.01 }} />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={clsx("rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]", compact ? "p-4" : "p-5 shadow-[0_1px_2px_rgba(17,24,39,.06),0_8px_24px_rgba(17,24,39,.06)]")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">When the town changes, the court day changes</div>
          {!compact && <div className={clsx("mt-1 text-xs", MUTED)}>The same court, the same cases. Only the week outside the court changes.</div>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border,var(--line,#E1E7EF))] p-0.5">
            {available.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setPick(k)}
                className={clsx("h-7 rounded-md px-2.5 text-xs", pick === k ? "bg-[var(--primary-subtle,#F0F6FF)] text-[var(--primary-strong,#1E3B8A)]" : MUTED)}>{l}</button>
            ))}
          </div>
          {onClose && <button type="button" onClick={onClose} aria-label="Close" className={clsx("rounded-md p-1 hover:bg-[var(--surface-2)]", MUTED)}><X size={16} /></button>}
        </div>
      </div>
      <p className="mt-3 text-sm">{takeaway}</p>
      {f && pick !== "normal" && (
        <p className={clsx("mt-1 text-xs", MUTED)}>
          {fmtDate(f.d.date, { day: "numeric", month: "short" })}, {view.ev.get(f.d.date)?.toLowerCase()}: {num(f.d.absent)} absent vs {num(f.n?.absent)}, {num(f.d.moved)} moved vs {num(f.n?.moved)}.
        </p>
      )}
      {chart("Matters moved forward", "moved", "var(--c-substantive,#10B77F)", view.maxMoved)}
      {chart("People absent", "absent", "var(--c-adjourned,#F59F0A)", view.maxAbs)}
      <div className={clsx("mt-1 flex justify-between font-mono text-[10px]", MUTED)}>
        <span>{view.days[0] ? fmtDate(view.days[0].d.date) : ""}</span>
        <span>filled: {label.toLowerCase()} · outline: normal week · shaded: {kind} days</span>
        <span>{view.days.length ? fmtDate(view.days[view.days.length - 1].d.date) : ""}</span>
      </div>
      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          {[["Cases closed", dispS, dispN], ["Wasted trips", num(sc.wasted_trips), num(normal?.wasted_trips)], ["Kept away by the town", num(sc.town_kept_away_total), num(normal?.town_kept_away_total)]].map(([k, a, b]) => (
            <div key={String(k)} className="rounded-lg bg-[var(--surface-2)] py-2">
              <div className="font-mono text-base font-semibold">{a}</div>
              <div className={MUTED}>{k}{pick !== "normal" && <> · normal {b}</>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
