"use client";

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { GUARDRAILS, WEEKDAY_LABEL, hhmm, type Week } from "@/lib/dayprofile";

const T0 = 9 * 60 + 30;
const T1 = 18 * 60;
const pos = (m: number) => `${((Math.min(T1, Math.max(T0, m)) - T0) / (T1 - T0)) * 100}%`;
const width = (a: number, b: number) => `${((Math.min(T1, b) - Math.max(T0, a)) / (T1 - T0)) * 100}%`;

/** A judge's week as a compact calendar strip: sittings blue, breaks grey, admin hatched. */
export default function WeekStrip({ week, compact = false, label }: { week: Week; compact?: boolean; label?: string }) {
  const h = compact ? 12 : 18;
  const normPct = Math.min(100, week.vsNormPct);
  return (
    <div>
      {label && <p className="mb-2 text-[13px] font-medium text-text">{label}</p>}
      <div className="flex flex-col gap-1">
        {!compact && (
          <div className="relative ml-10 h-4 text-[11px] text-faint">
            {[10, 12, 14, 16, 18].map((hr) => (
              <span key={hr} className="num absolute -translate-x-1/2" style={{ left: pos(hr * 60) }}>
                {hr}:00
              </span>
            ))}
          </div>
        )}
        {week.days.map((d, i) => {
          const s = [...d.sittings].sort((a, b) => a[0] - b[0]);
          const gaps = s.slice(0, -1).map((x, j) => [x[1], s[j + 1][0]] as [number, number]).filter(([a, b]) => b > a);
          return (
            <div key={d.weekday} className="flex items-center gap-2">
              <span className="w-8 text-[11px] text-muted">{WEEKDAY_LABEL[d.weekday]}</span>
              <div className="relative flex-1 rounded bg-surface-2" style={{ height: h }}>
                {gaps.map(([a, b]) => (
                  <span key={`g${a}`} className="absolute inset-y-0 bg-[var(--c-baseline)] opacity-40" style={{ left: pos(a), width: width(a, b) }} title={`break ${hhmm(a)}-${hhmm(b)}`} />
                ))}
                {d.admin.map(([a, b]) => (
                  <span
                    key={`a${a}`}
                    className="absolute inset-y-0 rounded-sm"
                    style={{ left: pos(a), width: width(a, b), backgroundImage: "repeating-linear-gradient(135deg, var(--text-faint) 0 2px, transparent 2px 6px)" }}
                    title={`administrative work ${hhmm(a)}-${hhmm(b)}`}
                  />
                ))}
                {s.map(([a, b], j) => (
                  <motion.span
                    key={`s${a}`}
                    className="absolute inset-y-0 rounded-sm bg-primary"
                    style={{ left: pos(a), transformOrigin: "left center" }}
                    initial={{ width: 0 }}
                    whileInView={{ width: width(a, b) }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.05 + j * 0.1 }}
                    title={`sitting ${hhmm(a)}-${hhmm(b)}`}
                  />
                ))}
              </div>
              <span className="num w-12 text-right text-[11px] text-muted">{(d.sitting_minutes / 60).toFixed(1)} h</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative h-2 flex-1 rounded-full bg-surface-2">
          <motion.div className="absolute inset-y-0 left-0 rounded-full bg-primary" initial={{ width: 0 }} whileInView={{ width: `${normPct}%` }} viewport={{ once: true }} />
          <span
            className="absolute -top-1 h-4 w-0.5 bg-danger"
            style={{ left: `${(GUARDRAILS.minWeekly / (5 * GUARDRAILS.norm)) * 100}%` }}
            title="Minimum: 3.5 h a day on average"
          />
        </div>
        <span className="num whitespace-nowrap text-[12px] text-muted">
          <span className="text-text">{(week.weekly / 60).toFixed(1)} h</span> a week · {Math.round(week.vsNormPct)}% of a 6-hour norm
        </span>
      </div>
    </div>
  );
}

export function WeekLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm bg-primary" /> hearings
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm bg-[var(--c-baseline)] opacity-40" /> break / lunch
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--text-faint) 0 2px, transparent 2px 6px)" }} /> administrative work
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-0.5 bg-danger" /> 3.5 h a day minimum
      </span>
    </div>
  );
}

export function Guardrails() {
  const items = [
    "An average of at least 3.5 hours of hearings per sitting day",
    "A sitting day is between 2 and 7 hours of hearings",
    "The old-case share of listed minutes (at least 20%)",
    "The daily reserve for urgent and emergency matters",
    "Prerequisite checklists before a matter is listed",
  ];
  return (
    <div className="rounded-lg border border-line bg-bg p-4">
      <p className="text-[13px] text-text">
        You can shape your day. You cannot go below these limits:
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((t) => (
          <li key={t} className="flex items-center gap-2 text-[13px] text-muted">
            <Lock size={13} className="shrink-0 text-old" /> {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
