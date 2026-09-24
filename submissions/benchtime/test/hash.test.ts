import { describe, expect, test } from "bun:test";
import { betaCdf, u, uBeta, uLognormal, uNormal, uPick, uPickWeighted } from "../src/domain/hash";

const N = 10_000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

describe("u", () => {
  test("is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const a = u(42, "attend", `ST/${i}/2023`, "2026-10-05");
      expect(a).toBe(u(42, "attend", `ST/${i}/2023`, "2026-10-05"));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  test("depends on seed, key order and key boundaries", () => {
    expect(u(1, "a", "b")).not.toBe(u(2, "a", "b"));
    expect(u(1, "a", "b")).not.toBe(u(1, "b", "a"));
    expect(u(1, "a1")).not.toBe(u(1, "a", 1));
    expect(u(1, "ab", "c")).not.toBe(u(1, "a", "bc"));
    // seeds beyond 32 bits do not alias their low bits
    expect(u(2 ** 32 + 7, "k")).not.toBe(u(7, "k"));
    // numbers and strings with the same text are the same key part (ids may arrive either way)
    expect(u(3, "case", 17)).toBe(u(3, "case", "17"));
  });

  test("is roughly uniform on 10k draws (chi-square, 20 bins)", () => {
    for (const seed of [1, 42, 31337]) {
      const bins = new Array(20).fill(0);
      for (let i = 0; i < N; i++) bins[Math.floor(u(seed, "dur", i) * 20)]++;
      const e = N / 20;
      const chi = bins.reduce((s: number, o: number) => s + ((o - e) * (o - e)) / e, 0);
      expect(chi).toBeLessThan(43.8); // df 19, p = 0.001
    }
    // consecutive world seeds with one fixed key (seeds 1..60 are used side by side)
    const bins = new Array(20).fill(0);
    for (let s = 0; s < N; s++) bins[Math.floor(u(s, "attend", "ST/1/2023") * 20)]++;
    const chi = bins.reduce((acc: number, o: number) => acc + ((o - N / 20) ** 2) / (N / 20), 0);
    expect(chi).toBeLessThan(43.8);
  });

  test("shows no correlation between adjacent keys or adjacent seeds", () => {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const ws: number[] = [];
    for (let i = 0; i < N; i++) {
      xs.push(u(7, "case", i));
      ys.push(u(7, "case", i + 1));
      zs.push(u(8, "case", i));
      ws.push(u(7, "case", i, "accused"));
    }
    const lim = 4 / Math.sqrt(N); // four standard errors
    expect(Math.abs(pearson(xs, ys))).toBeLessThan(lim);
    expect(Math.abs(pearson(xs, zs))).toBeLessThan(lim);
    expect(Math.abs(pearson(xs, ws))).toBeLessThan(lim);
    // serial pairs of bits: low-order structure would show up as a skewed (u_i < 0.5, u_i+1 < 0.5) table
    let both = 0;
    for (let i = 0; i < N; i++) if (xs[i]! < 0.5 && ys[i]! < 0.5) both++;
    expect(Math.abs(both / N - 0.25)).toBeLessThan(0.02);
  });
});

describe("derived draws", () => {
  test("uNormal has mean 0 and sd 1, deterministically", () => {
    const xs = Array.from({ length: N }, (_, i) => uNormal(5, "z", i));
    const m = mean(xs);
    const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    expect(Math.abs(m)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
    expect(uNormal(5, "z", 3)).toBe(xs[3]!);
  });

  test("uLognormal matches the requested mean and cv", () => {
    const xs = Array.from({ length: N }, (_, i) => uLognormal(30, 0.5, 9, "duration", i));
    const m = mean(xs);
    const cv = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
    expect(Math.abs(m - 30)).toBeLessThan(0.8);
    expect(Math.abs(cv - 0.5)).toBeLessThan(0.05);
    expect(xs.every((x) => x > 0)).toBe(true);
    expect(uLognormal(30, 0, 9, "duration", 1)).toBe(30);
  });

  test("uBeta matches the Beta mean and is monotone in the underlying uniform", () => {
    for (const [a, b] of [
      [2, 5],
      [0.5, 0.5],
      [8, 2],
      [30, 70],
    ] as const) {
      const xs = Array.from({ length: 4000 }, (_, i) => uBeta(a, b, 11, "propensity", i));
      expect(Math.abs(mean(xs) - a / (a + b))).toBeLessThan(0.02);
      expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
      // inversion: the CDF at the draw gives back a uniform
      const us = xs.map((x) => betaCdf(x, a, b));
      expect(Math.abs(mean(us) - 0.5)).toBeLessThan(0.02);
    }
    // common random numbers: same key, higher a gives a higher draw (the draw moves, never re-rolls)
    for (let i = 0; i < 200; i++) expect(uBeta(3, 4, 1, "p", i)).toBeLessThan(uBeta(4, 4, 1, "p", i));
  });

  test("uPick and uPickWeighted pick deterministically in proportion", () => {
    const items = ["a", "b", "c", "d"] as const;
    const counts: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const x = uPick(items, 3, "pick", i);
      counts[x] = (counts[x] ?? 0) + 1;
    }
    for (const k of items) expect(Math.abs((counts[k] ?? 0) / N - 0.25)).toBeLessThan(0.02);
    expect(uPick(items, 3, "pick", 1)).toBe(uPick(items, 3, "pick", 1));
    expect(() => uPick([], 3, "x")).toThrow();

    const w = { court_admin: 0.1, sought_time: 0.6, unclear: 0.3, never: 0 };
    const wc: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const x = uPickWeighted(w, 4, "reason", i);
      wc[x] = (wc[x] ?? 0) + 1;
    }
    expect(Math.abs((wc.sought_time ?? 0) / N - 0.6)).toBeLessThan(0.02);
    expect(Math.abs((wc.court_admin ?? 0) / N - 0.1)).toBeLessThan(0.015);
    expect(wc.never ?? 0).toBe(0);
  });
});
