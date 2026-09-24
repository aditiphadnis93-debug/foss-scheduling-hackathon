"use client";

import clsx from "clsx";
import { useRef } from "react";
import { useInView } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useCountUp } from "@/lib/motion";
import { deltaTone, fmtDelta, fmtNum, unitOf } from "@/lib/metrics";

export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const v = useCountUp(value, 1400, inView);
  return (
    <span ref={ref} className={clsx("num", className)}>
      {fmtNum(v, decimals)}
    </span>
  );
}

const TONE = {
  good: "text-green-strong bg-green-subtle ring-green/30",
  bad: "text-danger bg-danger/10 ring-danger/30",
  flat: "text-muted bg-surface-2 ring-line",
  neutral: "text-muted bg-surface-2 ring-line",
};

export function DeltaPill({ k, a, b, className }: { k: string; a?: number; b?: number; className?: string }) {
  const tone = deltaTone(k, a, b);
  const txt = fmtDelta(k, a, b);
  if (!txt) return null;
  const up = a !== undefined && b !== undefined && a > b;
  const Icon = tone === "flat" ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={clsx("num inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] ring-1", TONE[tone], className)}>
      <Icon size={12} />
      {txt}
    </span>
  );
}

export function BigMetric({
  k,
  label,
  value,
  base,
  sub,
  highlight,
}: {
  k: string;
  label: string;
  value?: number;
  base?: number;
  sub?: string;
  highlight?: boolean;
}) {
  const u = unitOf(k);
  const dec = u ? 1 : Number.isInteger(value ?? 0) ? 0 : 2;
  return (
    <div className={clsx("card relative overflow-hidden p-5", highlight && "border-l-2 border-l-primary")}>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="mt-2 flex items-baseline gap-1.5">
        {value !== undefined ? (
          <CountUp value={value} decimals={dec} className="display text-[40px] leading-none text-text" />
        ) : (
          <span className="num text-[40px] text-faint">--</span>
        )}
        <span className="text-[14px] text-muted">{u === "%" ? "%" : u}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DeltaPill k={k} a={value} b={base} />
        {sub && <span className="text-[12px] text-faint">{sub}</span>}
      </div>
    </div>
  );
}
