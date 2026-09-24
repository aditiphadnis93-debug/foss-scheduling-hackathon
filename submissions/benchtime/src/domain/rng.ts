// Seeded PRNG (mulberry32) + the few distributions we need. Zero deps, reproducible runs.

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.uniform(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  normal(mu = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** normal clamped to [lo, hi] */
  clampedNormal(mu: number, sd: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, this.normal(mu, sd)));
  }
  /** positive duration with the given mean/sd (lognormal, matched moments) */
  duration(mean: number, sd: number): number {
    const v = Math.log(1 + (sd * sd) / (mean * mean));
    const mu = Math.log(mean) - v / 2;
    return Math.exp(this.normal(mu, Math.sqrt(v)));
  }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
  pick<T>(arr: readonly T[]): T {
    const i = Math.floor(this.next() * arr.length);
    const v = arr[i];
    if (v === undefined) throw new Error("pick from empty array");
    return v;
  }
  /** weighted pick; weights need not sum to 1 */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] ?? 0;
      if (r <= 0) {
        const v = items[i];
        if (v !== undefined) return v;
      }
    }
    const last = items[items.length - 1];
    if (last === undefined) throw new Error("weighted pick from empty array");
    return last;
  }
}

/** Zipf sampler over 0..n-1 with exponent s (few advocates hold most matters). */
export function makeZipf(n: number, s: number, rng: Rng): () => number {
  const cdf: number[] = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += 1 / Math.pow(i + 1, s);
    cdf[i] = acc;
  }
  return () => {
    const r = rng.next() * acc;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] ?? 0) < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
