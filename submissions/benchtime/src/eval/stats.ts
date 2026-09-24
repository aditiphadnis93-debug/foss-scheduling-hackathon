// Summary statistics for the arena: means with 95% intervals across world seeds, and paired differences
// against a baseline. Every interval is a percentile bootstrap on a fixed seed, so a report regenerated from
// the same runs is byte-identical (rule 2 applies to the evaluation too).

import { Rng } from "../domain/rng";

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export interface PairedInterval extends Interval {
  /** standard deviation of the per-seed differences */
  sd: number;
  /** seeds on which a beat b, and on which b beat a */
  wins: number;
  losses: number;
}

// NaN marks a measure with nothing to measure (no heard cases, say); it is dropped rather than averaged in.
const finite = (xs: readonly number[]): number[] => xs.filter((x) => Number.isFinite(x));

export function mean(xs: readonly number[]): number {
  const v = finite(xs);
  if (v.length === 0) return NaN;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** Sample standard deviation (n - 1). 0 for a single value, NaN for none. */
export function sd(xs: readonly number[]): number {
  const v = finite(xs);
  if (v.length === 0) return NaN;
  if (v.length === 1) return 0;
  const m = mean(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (v.length - 1));
}

/** Population standard deviation (n), for describing a whole set such as every sitting day of a run. */
export function sdPopulation(xs: readonly number[]): number {
  const v = finite(xs);
  if (v.length === 0) return NaN;
  const m = mean(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / v.length);
}

/** p-th percentile, p in [0, 100], linear interpolation between order statistics (R type 7, numpy default). */
export function percentile(xs: readonly number[], p: number): number {
  const v = finite(xs).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const h = (v.length - 1) * Math.min(100, Math.max(0, p)) / 100;
  const lo = Math.floor(h);
  const a = v[lo] ?? NaN;
  const b = v[Math.min(lo + 1, v.length - 1)] ?? NaN;
  return a + (h - lo) * (b - a);
}

/**
 * Percentile bootstrap interval for the mean. Deterministic: the resampling stream is seeded, and the
 * same values in the same order always give the same interval. With one value the interval is that value.
 */
export function bootstrapCI(values: readonly number[], level = 0.95, seed = 20260924, resamples = 2000): Interval {
  const v = finite(values);
  const n = v.length;
  const m = mean(v);
  if (n <= 1) return { mean: m, lo: m, hi: m, n };
  const rng = new Rng(seed);
  const means: number[] = new Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[Math.floor(rng.next() * n)] ?? 0;
    means[r] = s / n;
  }
  const tail = ((1 - level) / 2) * 100;
  return { mean: m, lo: percentile(means, tail), hi: percentile(means, 100 - tail), n };
}

/**
 * Paired difference a - b, matched by position (the arena lines runs up by world seed, so each pair faced
 * the same court). Pairs where either side is not finite are dropped together.
 */
export function pairedDiff(a: readonly number[], b: readonly number[], level = 0.95, seed = 20260924): PairedInterval {
  if (a.length !== b.length) throw new Error(`pairedDiff needs equal lengths, got ${a.length} and ${b.length}`);
  const d: number[] = [];
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? NaN;
    const y = b[i] ?? NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    d.push(x - y);
    if (x > y) wins++;
    else if (x < y) losses++;
  }
  return { ...bootstrapCI(d, level, seed), sd: sd(d), wins, losses };
}
