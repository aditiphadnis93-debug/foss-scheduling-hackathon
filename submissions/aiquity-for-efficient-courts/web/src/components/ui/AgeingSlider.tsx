"use client";

import { Lock } from "lucide-react";
import { motion } from "framer-motion";

/** Ageing share control: 0-60% track with the 0-20% floor drawn as a locked zone the thumb cannot enter. */
export default function AgeingSlider({
  value,
  auto,
  floor,
  onChange,
  onAuto,
}: {
  value: number;
  auto: boolean;
  floor: number;
  onChange: (v: number) => void;
  onAuto: (a: boolean) => void;
}) {
  const MAX = 0.6;
  const pos = (v: number) => `${(v / MAX) * 100}%`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-text">Minimum share of listed minutes for 4+ yr cases</span>
        <span className="num text-[13px] text-old">{auto ? "auto" : `${Math.round(value * 100)}%`}</span>
      </div>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-2 ring-1 ring-line" />
        <div
          className="locked-zone absolute top-1/2 h-2 -translate-y-1/2 rounded-l-full ring-1 ring-old/50"
          style={{ left: 0, width: pos(floor) }}
        />
        <div
          className="absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-surface text-old ring-1 ring-old/60"
          style={{ left: pos(floor / 2) }}
          title="The ageing floor cannot be lowered"
        >
          <Lock size={11} />
        </div>
        {!auto && (
          <motion.div
            className="absolute top-1/2 h-2 -translate-y-1/2 bg-old/80"
            style={{ left: pos(floor) }}
            animate={{ width: `calc(${pos(value)} - ${pos(floor)})` }}
          />
        )}
        <input
          type="range"
          min={0}
          max={MAX}
          step={0.05}
          value={value}
          disabled={auto}
          onChange={(e) => onChange(Math.max(floor, Number(e.target.value)))}
          className="absolute inset-0 disabled:opacity-40"
          aria-label="Ageing share"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span className="text-old/90">0-{Math.round(floor * 100)}% locked: the floor cannot be switched off</span>
        <label className="flex cursor-pointer items-center gap-2 text-muted">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} className="accent-[var(--primary)]" />
          auto (follow the roster&apos;s age mix)
        </label>
      </div>
    </div>
  );
}
