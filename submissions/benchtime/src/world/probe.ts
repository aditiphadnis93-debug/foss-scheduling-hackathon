// The world's draws, with a probe for the rule 1 tests (test/leakage*.test.ts). The world draws only through
// these wrappers. Inactive (the default) they are src/domain/hash.ts unchanged. A test may set `after` to
// salt every draw made on a simulated day later than it (and move every latent return or ready day past
// it), or `saltKeys` to salt draws by event name: two worlds identical up to a day, or identical but for one
// latent quantity. A policy that plans only on what is known must decide identically in both.

import * as H from "../domain/hash";
import type { Key } from "../domain/hash";

export const LEAK: { after: string | null; today: string; saltKeys: Set<string> } = { after: null, today: "", saltKeys: new Set() };

const SALT = "\u0002perturbed";
const active = (): boolean => LEAK.after !== null || LEAK.saltKeys.size > 0;
const salted = (key: Key[]): Key[] =>
  (LEAK.after !== null && LEAK.today > LEAK.after) || (LEAK.saltKeys.size > 0 && LEAK.saltKeys.has(String(key[0]))) ? [...key, SALT] : key;

export const u = (seed: number, ...key: Key[]): number => (active() ? H.u(seed, ...salted(key)) : H.u(seed, ...key));
export const uBeta = (a: number, b: number, seed: number, ...key: Key[]): number => (active() ? H.uBeta(a, b, seed, ...salted(key)) : H.uBeta(a, b, seed, ...key));
export const uLognormal = (mean: number, cv: number, seed: number, ...key: Key[]): number =>
  active() ? H.uLognormal(mean, cv, seed, ...salted(key)) : H.uLognormal(mean, cv, seed, ...key);
