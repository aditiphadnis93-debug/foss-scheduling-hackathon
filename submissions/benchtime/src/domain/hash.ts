// Stateless random draws for the world (rule 2 in DESIGN.md: shared seeds, common random numbers).
// Every draw is a pure function of the world seed and a semantic key (case id, actor, date, event), so
// the same person on the same day makes the same draw under every policy, whatever order the simulator
// happens to ask in. There is no stream and no position: nothing a policy does can shift a later draw.
// Continuous draws use inversion (one uniform through a monotone map) wherever practical, so a change
// of parameter moves the draw smoothly instead of re-rolling it.

export type Key = string | number;

// Unit separator between key parts, so ("a", "1") and ("a1") hash differently.
const SEP = "\u001f";
// Sub-key tag for derived draws (Box-Muller's second uniform); control characters keep it out of the
// way of any key a caller would plausibly build.
const SUB = "\u0000";

/** murmur3's 32-bit finaliser: full avalanche on one lane. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** cyrb53-style two-lane hash of the seed and key, finalised per lane; returns a 53-bit integer. */
function hash53(seed: number, key: readonly Key[]): number {
  // The whole seed goes into the string as well as the lane seeds, so seeds beyond 32 bits or
  // non-integers never alias.
  const s = String(seed) + SEP + key.join(SEP);
  // Scramble the lane seeds first: a raw seed XOR can cancel against the seed's own digit characters
  // (seed 7 then "7" and seed 8 then "8" would leave identical lanes).
  const lo = fmix32((seed >>> 0) ^ 0x27d4eb2f);
  let h1 = 0xdeadbeef ^ lo;
  let h2 = 0x41c6ce57 ^ fmix32(lo ^ 0x165667b1);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = fmix32(h1 ^ 0x9e3779b9);
  const b = fmix32(h2 ^ a);
  return (b & 0x1fffff) * 4294967296 + a;
}

/** A uniform draw in [0, 1) that depends only on (seed, key...). Numbers and strings with the same text are the same key part. */
export function u(seed: number, ...key: Key[]): number {
  return hash53(seed, key) / 9007199254740992; // 2^53
}

/** Uniform in the open interval (0, 1), for logs and inverse CDFs. */
function uOpen(seed: number, key: readonly Key[]): number {
  return (hash53(seed, key) + 0.5) / 9007199254740992;
}

/** Standard normal draw (Box-Muller over two sub-keyed uniforms). */
export function uNormal(seed: number, ...key: Key[]): number {
  const u1 = uOpen(seed, [...key, SUB + "bm1"]);
  const u2 = u(seed, ...key, SUB + "bm2");
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Lognormal draw with the given mean and coefficient of variation (sd / mean); cv 0 returns the mean. */
export function uLognormal(mean: number, cv: number, seed: number, ...key: Key[]): number {
  if (mean <= 0) return 0;
  if (cv <= 0) return mean;
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * uNormal(seed, ...key));
}

/** Beta(a, b) draw by inverting the regularised incomplete beta at a single uniform (monotone in the uniform). */
export function uBeta(a: number, b: number, seed: number, ...key: Key[]): number {
  if (!(a > 0) || !(b > 0)) throw new Error(`uBeta needs positive shape parameters, got a=${a} b=${b}`);
  return betaInv(uOpen(seed, key), a, b);
}

/** Uniform pick from a non-empty list. */
export function uPick<T>(items: readonly T[], seed: number, ...key: Key[]): T {
  if (items.length === 0) throw new Error("uPick from an empty list");
  return items[Math.min(items.length - 1, Math.floor(u(seed, ...key) * items.length))]!;
}

/** Weighted pick over a record of non-negative weights (need not sum to 1), e.g. failure-reason shares. */
export function uPickWeighted<K extends string>(weights: Readonly<Record<K, number>>, seed: number, ...key: Key[]): K {
  const entries = Object.entries(weights) as [K, number][];
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  if (entries.length === 0 || total <= 0) throw new Error("uPickWeighted needs at least one positive weight");
  let r = u(seed, ...key) * total;
  let last: K = entries[0]![0];
  for (const [k, w] of entries) {
    if (w <= 0) continue;
    last = k;
    r -= w;
    if (r < 0) return k;
  }
  return last; // rounding at the top edge
}

// ---------------------------------------------------------------------------------------------
// Incomplete beta and its inverse (Numerical Recipes, Lentz continued fraction)

function lnGamma(x: number): number {
  // Lanczos approximation, g = 7, n = 9; accurate to ~1e-15 for x > 0
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  // The continued fraction converges fast on the side of the mean; use symmetry on the other
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lnFront) * betacf(x, a, b)) / a;
  return 1 - (Math.exp(lnFront) * betacf(1 - x, b, a)) / b;
}

/** Inverse of I_x(a, b) at p in (0, 1): safeguarded Newton inside a shrinking bisection bracket. */
function betaInv(p: number, a: number, b: number): number {
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  let lo = 0;
  let hi = 1;
  let x = a / (a + b);
  for (let it = 0; it < 100; it++) {
    const f = betaCdf(x, a, b) - p;
    if (Math.abs(f) < 1e-13) return x;
    if (f > 0) hi = x;
    else lo = x;
    const pdf = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB);
    let next = x - f / pdf;
    if (!(next > lo && next < hi) || !Number.isFinite(next)) next = (lo + hi) / 2;
    if (Math.abs(next - x) < 1e-15) return next;
    x = next;
  }
  return x;
}
