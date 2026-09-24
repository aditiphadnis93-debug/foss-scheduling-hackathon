"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** Count up from 0 to `to` once the element is on screen. */
export function useCountUp(to: number, ms = 1400, start = true): number {
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!start || !Number.isFinite(to)) return;
    if (reduce) {
      raf.current = requestAnimationFrame(() => setV(to));
      return () => {
        if (raf.current) cancelAnimationFrame(raf.current);
      };
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(to * e);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, ms, start, reduce]);
  return v;
}

export const EASE = [0.22, 1, 0.36, 1] as const;
