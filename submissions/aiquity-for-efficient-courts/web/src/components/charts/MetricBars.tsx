"use client";

import { motion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { fmtMetric } from "@/lib/metrics";

export type BarRow = { key: string; label: string; colour: string; value?: number; p10?: number; p90?: number };

/** Horizontal bars with optional p10-p90 whiskers; bars grow in on view. */
export default function MetricBars({ metric, rows, domainMax }: { metric: string; rows: BarRow[]; domainMax?: number }) {
  const vals = rows.flatMap((r) => [r.value ?? 0, r.p90 ?? 0]);
  const max = domainMax ?? Math.max(1e-9, ...vals) * 1.08;
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => {
        const w = ((r.value ?? 0) / max) * 100;
        return (
          <div key={r.key} className="grid grid-cols-[112px_1fr_72px] items-center gap-3">
            <span className="truncate text-[12px] text-muted" title={r.label}>
              {r.label}
            </span>
            <div className="relative h-5">
              <div className="absolute inset-0 rounded-md bg-surface-2" />
              <motion.div
                className="absolute inset-y-0 left-0 rounded-md"
                style={{ background: r.colour }}
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.max(0, w)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.9, delay: 0.05 * i, ease: EASE }}
              />
              {r.p10 !== undefined && r.p90 !== undefined && r.p90 > r.p10 && (
                <motion.div
                  className="absolute top-1/2 h-[10px] -translate-y-1/2 border-x-2 border-text"
                  style={{ left: `${(r.p10 / max) * 100}%`, width: `${((r.p90 - r.p10) / max) * 100}%` }}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.9 }}
                >
                  <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-text" />
                </motion.div>
              )}
            </div>
            <span className="num text-right text-[13px] text-text">{fmtMetric(metric, r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
