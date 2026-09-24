"use client";

import { motion, useReducedMotion } from "framer-motion";
import { CountUp } from "@/components/ui/Stat";
import { EASE } from "@/lib/motion";

type Step = { label: string; value: number; colour: string; note: string };

export default function Funnel({ steps, max }: { steps: Step[]; max: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col gap-4">
      {steps.map((s, i) => (
        <div key={s.label} className="grid grid-cols-[92px_1fr] items-center gap-4 md:grid-cols-[120px_1fr]">
          <div className="text-right">
            <div className="text-[12px] uppercase tracking-[0.14em] text-muted">{s.label}</div>
          </div>
          <div className="relative h-12 overflow-hidden rounded-lg bg-surface-2">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-lg"
              style={{ background: s.colour }}
              initial={{ width: reduce ? `${(s.value / max) * 100}%` : "0%" }}
              whileInView={{ width: `${(s.value / max) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, delay: 0.25 + i * 0.55, ease: EASE }}
            />
            <div className="absolute inset-0 flex items-center justify-between px-4">
              <CountUp value={s.value} className="display text-[20px] text-on-primary" />
              <span className="hidden text-[12px] text-muted md:block">{s.note}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
