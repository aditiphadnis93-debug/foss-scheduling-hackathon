"use client";

import { Plus, Trash2 } from "lucide-react";
import { hhmm, toMinutes, type Win } from "@/lib/dayprofile";

export type DayEdit = { sittings: Win[]; admin: Win[] };

function Rows({
  label,
  wins,
  onChange,
  tone,
}: {
  label: string;
  wins: Win[];
  onChange: (w: Win[]) => void;
  tone: "sit" | "admin";
}) {
  const set = (i: number, j: 0 | 1, v: string) => onChange(wins.map((w, k) => (k === i ? ((j === 0 ? [toMinutes(v), w[1]] : [w[0], toMinutes(v)]) as Win) : w)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[12px] text-muted">
          <span
            className="h-2.5 w-4 rounded-sm"
            style={tone === "sit" ? { background: "var(--primary)" } : { backgroundImage: "repeating-linear-gradient(135deg, var(--text-faint) 0 2px, transparent 2px 6px)" }}
          />
          {label}
        </span>
        <button
          onClick={() => {
            const last = wins[wins.length - 1];
            const start = last ? Math.min(last[1] + 30, 17 * 60) : tone === "sit" ? 10 * 60 + 30 : 14 * 60;
            onChange([...wins, [start, Math.min(start + 90, 18 * 60)]]);
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-primary hover:bg-primary-subtle"
        >
          <Plus size={12} /> add
        </button>
      </div>
      {wins.map(([a, b], i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="time" value={hhmm(a)} step={900} onChange={(e) => e.target.value && set(i, 0, e.target.value)} className="num rounded-md border border-line bg-bg px-2 py-1 text-[13px]" aria-label={`${label} ${i + 1} start`} />
          <span className="text-faint">to</span>
          <input type="time" value={hhmm(b)} step={900} onChange={(e) => e.target.value && set(i, 1, e.target.value)} className="num rounded-md border border-line bg-bg px-2 py-1 text-[13px]" aria-label={`${label} ${i + 1} end`} />
          <button onClick={() => onChange(wins.filter((_, k) => k !== i))} className="rounded-md p-1 text-faint hover:text-danger" aria-label="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      {wins.length === 0 && <span className="text-[12px] text-faint">none</span>}
    </div>
  );
}

/** Edit the default day's sittings and administrative blocks. */
export default function DayEditor({ value, onChange }: { value: DayEdit; onChange: (v: DayEdit) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Rows label="Sittings (hearings)" wins={value.sittings} tone="sit" onChange={(sittings) => onChange({ ...value, sittings })} />
      <Rows label="Administrative work" wins={value.admin} tone="admin" onChange={(admin) => onChange({ ...value, admin })} />
    </div>
  );
}
