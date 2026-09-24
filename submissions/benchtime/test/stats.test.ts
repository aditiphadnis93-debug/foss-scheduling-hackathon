// Summary statistics: known values, deterministic bootstrap intervals, and the sign of paired differences.

import { describe, expect, test } from "bun:test";
import { bootstrapCI, mean, pairedDiff, percentile, sd, sdPopulation } from "../src/eval/stats";
import { Rng } from "../src/domain/rng";

describe("descriptive", () => {
  test("mean and sd of 2 4 4 4 5 5 7 9", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    expect(sdPopulation(xs)).toBeCloseTo(2, 12); // the textbook example: population sd 2
    expect(sd(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });
  test("NaN values are dropped, empty gives NaN", () => {
    expect(mean([1, NaN, 3])).toBe(2);
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(sd([4])).toBe(0);
  });
  test("percentile interpolates between order statistics (type 7)", () => {
    const xs = [15, 20, 35, 40, 50];
    expect(percentile(xs, 0)).toBe(15);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 50)).toBe(35);
    expect(percentile(xs, 40)).toBeCloseTo(29, 12); // rank 1.6: 20 + 0.6 x 15
    expect(percentile([3, 1, 2], 50)).toBe(2); // unsorted input
  });
});

describe("bootstrap interval", () => {
  const rng = new Rng(7);
  const xs = Array.from({ length: 30 }, () => 10 + rng.normal(0, 2));

  test("deterministic for the same seed, and brackets the mean", () => {
    const a = bootstrapCI(xs);
    const b = bootstrapCI(xs);
    expect(a).toEqual(b);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
    expect(a.n).toBe(30);
  });
  test("width close to the normal-theory interval", () => {
    const ci = bootstrapCI(xs);
    const half = (1.96 * sd(xs)) / Math.sqrt(xs.length);
    expect((ci.hi - ci.lo) / 2).toBeGreaterThan(half * 0.8);
    expect((ci.hi - ci.lo) / 2).toBeLessThan(half * 1.2);
  });
  test("covers the true mean in most repeated samples", () => {
    let covered = 0;
    const r = new Rng(11);
    for (let k = 0; k < 200; k++) {
      const sample = Array.from({ length: 30 }, () => r.normal(5, 1));
      const ci = bootstrapCI(sample, 0.95, k, 500);
      if (ci.lo <= 5 && 5 <= ci.hi) covered++;
    }
    expect(covered / 200).toBeGreaterThan(0.88);
  });
  test("a wider level gives a wider interval; one value gives a point", () => {
    const c90 = bootstrapCI(xs, 0.9);
    const c99 = bootstrapCI(xs, 0.99);
    expect(c99.hi - c99.lo).toBeGreaterThan(c90.hi - c90.lo);
    expect(bootstrapCI([3])).toEqual({ mean: 3, lo: 3, hi: 3, n: 1 });
  });
});

describe("paired difference", () => {
  const r = new Rng(3);
  // a shared court effect per seed (large) plus a small policy effect: pairing removes the court effect
  const court = Array.from({ length: 30 }, () => r.normal(0, 10));
  const a = court.map((c) => 50 + c + 1 + r.normal(0, 0.5));
  const b = court.map((c) => 50 + c + r.normal(0, 0.5));

  test("a better than b: interval above zero, and the sign flips when swapped", () => {
    const d = pairedDiff(a, b);
    expect(d.mean).toBeCloseTo(mean(a) - mean(b), 12);
    expect(d.lo).toBeGreaterThan(0);
    expect(d.wins).toBeGreaterThan(d.losses);
    const e = pairedDiff(b, a);
    expect(e.hi).toBeLessThan(0);
    expect(e.mean).toBeCloseTo(-d.mean, 12);
  });
  test("pairing is what makes the small effect visible", () => {
    const unpairedA = bootstrapCI(a);
    const unpairedB = bootstrapCI(b);
    expect(unpairedA.lo).toBeLessThan(unpairedB.hi); // the intervals overlap
  });
  test("identical inputs give a zero interval; lengths must match", () => {
    const z = pairedDiff([1, 2, 3], [1, 2, 3]);
    expect([z.mean, z.lo, z.hi, z.wins, z.losses]).toEqual([0, 0, 0, 0, 0]);
    expect(() => pairedDiff([1], [1, 2])).toThrow();
  });
});
