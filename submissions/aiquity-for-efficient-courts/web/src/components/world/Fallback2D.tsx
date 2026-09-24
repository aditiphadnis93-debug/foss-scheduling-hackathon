"use client";

/** Flat map of the same town for browsers without WebGL. Same data, same colours. */
import { useMemo } from "react";
import { OUTCOME_COLOR, STATE_COLOR, type World } from "@/lib/world";

export default function Fallback2D({ world, day, selected, onPickPerson }: {
  world: World; day: number; selected: number; onPickPerson: (i: number) => void;
}) {
  const dm = world.days[day];
  const Y = (y: number) => 1000 - y;
  const atCourt = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of dm?.hearings ?? []) for (const p of h.travellers) m.set(p, OUTCOME_COLOR[h.outcome]);
    return m;
  }, [dm]);
  const sel = world.disputes[selected];
  return (
    <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of the town">
      <defs>
        <radialGradient id="fb-court" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--primary,#2463EB)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--primary,#2463EB)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {world.hoods.map((h) => (
        <g key={h.name}>
          <line x1={world.court.x} y1={Y(world.court.y)} x2={h.x} y2={Y(h.y)} stroke="var(--border,var(--line,#E1E7EF))" strokeWidth={10} />
          <circle cx={h.x} cy={Y(h.y)} r={h.radius * 0.62} fill="var(--surface)" stroke="var(--border,var(--line,#E1E7EF))" strokeOpacity={0.4} />
          <text x={h.x} y={Y(h.y) - h.radius * 0.62 - 8} textAnchor="middle" fontSize={13} fill="var(--text-muted,var(--muted,#65758B))" letterSpacing={3}>{h.name.toUpperCase()}</text>
        </g>
      ))}
      <circle cx={world.court.x} cy={Y(world.court.y)} r={90} fill="url(#fb-court)" />
      <rect x={world.court.x - 22} y={Y(world.court.y) - 16} width={44} height={32} rx={4} fill="var(--surface-2)" />
      <circle cx={world.court.x} cy={Y(world.court.y) - 18} r={12} fill="var(--primary,#2463EB)" />
      {world.disputes.map((d, k) => {
        if (d.startDay > day || (d.endDay != null && d.endDay <= day) || d.a === d.b) return null;
        const a = world.people[d.a], b = world.people[d.b];
        const mx = (a.x + b.x) / 2, my = (Y(a.y) + Y(b.y)) / 2 - 30;
        return <path key={k} d={`M${a.x},${Y(a.y)} Q${mx},${my} ${b.x},${Y(b.y)}`} fill="none" stroke={k === selected ? "var(--primary,#2463EB)" : d.filedDay != null && d.filedDay <= day ? "var(--primary,#2463EB)" : "var(--c-adjourned,#F59F0A)"} strokeOpacity={k === selected ? 1 : 0.35} strokeWidth={k === selected ? 3 : 1} />;
      })}
      {world.people.map((p, i) => {
        const c = atCourt.get(i);
        const cx = c ? world.court.x + Math.cos(i) * 40 : p.x;
        const cy = c ? Y(world.court.y) + Math.sin(i) * 40 : Y(p.y);
        const isSel = sel && (sel.a === i || sel.b === i);
        return (
          <circle key={p.id} cx={cx} cy={cy} r={isSel ? 7 : 3.5} fill={c ?? STATE_COLOR[dm?.states[i] ?? 0]} stroke={isSel ? "var(--primary,#2463EB)" : "none"} strokeWidth={2}
            onClick={() => onPickPerson(i)} className="cursor-pointer" />
        );
      })}
    </svg>
  );
}
