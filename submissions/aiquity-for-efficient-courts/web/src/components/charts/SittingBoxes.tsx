"use client";

import { motion } from "framer-motion";
import type { Day, Run } from "@/lib/types";
import { toMin } from "@/lib/format";
import { C } from "@/lib/theme";
import { windowsOf } from "@/lib/courtday";

type SlotCfg = { name: string; purposes?: string[]; min_age_years?: number };

/** One card per sitting: its minute budget, planned expected minutes, minutes actually used, and matters. */
export default function SittingBoxes({ run, day }: { run: Run; day: Day }) {
  const windows = windowsOf(run, day);
  const reserve = Number((day as Day & { reserve_minutes?: number }).reserve_minutes ?? run.meta.config_detail?.reserve_minutes ?? 0);
  const slots = (run.meta.config_detail?.slots as SlotCfg[] | undefined) ?? [];
  const slotNames = [...new Set(day.listings.map((l) => l.slot))];
  const bySitting = slots.length === 0 && slotNames.every((s) => /^sitting_\d+$/.test(s) || s === "day");
  const boxes = bySitting
    ? windows.map(([a, b], i) => ({ key: `sitting_${i + 1}`, title: `Sitting ${i + 1}`, a, b, match: (slot: string) => slot === `sitting_${i + 1}` || (windows.length === 1 && slot === "day"), note: "" }))
    : slotNames.map((name) => {
        const cfg = slots.find((s) => s.name === name);
        const ls = day.listings.filter((l) => l.slot === name);
        const a = Math.min(...ls.map((l) => toMin(l.start)));
        const b = Math.max(...ls.map((l) => toMin(l.end)));
        const note = cfg?.min_age_years ? `Oldest matters, ${cfg.min_age_years}+ years` : cfg?.purposes?.length ? `${cfg.purposes.length} kinds of hearing` : "";
        return { key: name, title: name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), a, b, match: (slot: string) => slot === name, note };
      });
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="mb-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {boxes.map((bx, i) => {
          const ls = day.listings.filter((l) => bx.match(l.slot));
          const budget = Math.max(0, bx.b - bx.a) - (i === 0 ? reserve : 0);
          const planned = ls.reduce((s, l) => s + l.exp_min, 0);
          const used = ls.reduce((s, l) => s + (l.outcome?.minutes ?? 0), 0);
          const max = Math.max(budget, planned, used, 1);
          const bar = (v: number, colour: string) => (
            <div className="h-1.5 rounded bg-surface-2">
              <motion.div className="h-1.5 rounded" style={{ background: colour }} initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ duration: 0.6 }} />
            </div>
          );
          return (
            <div key={bx.key} className="card p-4">
              <p className="text-[13px] font-medium text-text">
                {bx.title} · <span className="num">{Number.isFinite(bx.a) ? `${hh(bx.a)}–${hh(bx.b)}` : "--"}</span> · <span className="num">{Math.max(0, bx.b - bx.a)} min</span>
              </p>
              {bx.note && <p className="text-[12px] text-muted">{bx.note}</p>}
              {i === 0 && reserve > 0 && <p className="text-[12px] text-muted">{reserve} min kept for urgent matters</p>}
              <div className="mt-2 grid grid-cols-[70px_1fr_52px] items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                <span>Budget</span>{bar(budget, "var(--border)")}<span className="num text-right text-text">{Math.round(budget)}</span>
                <span>Planned</span>{bar(planned, C.primary)}<span className="num text-right text-text">{Math.round(planned)}</span>
                <span>Used</span>{bar(used, C.substantive)}<span className="num text-right text-text">{Math.round(used)}</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">{ls.length} matters</p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Each sitting is filled up to its budget in expected minutes plus one shared safety buffer; every matter gets a one-hour window inside its sitting.
      </p>
    </div>
  );
}
