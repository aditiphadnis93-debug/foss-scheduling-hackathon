// Intervals as the console reads them (web/API.md, "Conventions"): the mean across world seeds with the 95%
// t interval of that mean, and paired differences b - a per seed with the t interval of their mean. Seeds
// are shared, so a paired difference is the common-random-numbers comparison. A value that is not random
// (the same on every seed) comes out with lo = hi = mean.

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

// two-sided 95% critical values of Student's t, df 1..30
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
  2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
export const t95 = (df: number): number => (df <= 0 ? NaN : df <= 30 ? T95[df - 1]! : 1.96 + 2.4 / df);

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Mean and 95% t interval; non-finite values are dropped; NaN everywhere when nothing is left. */
export function tInterval(values: readonly number[]): Interval {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN };
  const m = v.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { mean: r6(m), lo: r6(m), hi: r6(m) };
  const s2 = v.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1);
  const half = t95(n - 1) * Math.sqrt(s2 / n);
  // identical values: no spread, not a rounding artefact
  if (half < 1e-12) return { mean: r6(m), lo: r6(m), hi: r6(m) };
  return { mean: r6(m), lo: r6(m - half), hi: r6(m + half) };
}

/** b - a per position (both lists ordered by seed), then the t interval of the differences. */
export function pairedInterval(a: readonly number[], b: readonly number[]): Interval {
  const d: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) d.push(y - x);
  }
  return tInterval(d);
}

export const fixed = (x: number): Interval => ({ mean: x, lo: x, hi: x });
