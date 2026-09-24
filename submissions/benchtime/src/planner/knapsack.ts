// The daily selection: an exact 0/1 knapsack over integer expected minutes. A day is small (a few hundred
// due matters, 420 minutes), so dynamic programming is exact and cheap; there is no reason to accept a
// heuristic. The fairness floor (a share of minutes offered first to 4+ year cases) is a side constraint
// handled by a Lagrangian bonus per old minute, found by bisection, so the core stays a plain knapsack.
// The greedy answer is kept alongside so the console can show what exactness buys.

export interface KnapsackItem {
  id: string;
  /** expected bench minutes (rounded to whole minutes inside the solver) */
  minutes: number;
  value: number;
  /** a 4+ year case, counted towards the fairness floor */
  old: boolean;
  advocate?: string;
}

export interface KnapsackOptions {
  /** share of capacity (minutes) that should go to old items when enough of them exist */
  floorShare?: number;
}

export interface KnapsackResult {
  /** chosen ids, in input order */
  chosen: string[];
  /** sum of the original (unadjusted) values of the chosen items */
  value: number;
  minutes: number;
  /** the Lagrangian bonus per old minute that made the floor hold (0 when it held unaided) */
  lambda: number;
}

const wholeMinutes = (m: number): number => Math.max(0, Math.round(m));

/** Plain exact 0/1 knapsack on adjusted values; returns chosen indexes. Ties keep the earlier choice. */
function dp(values: number[], weights: number[], cap: number): number[] {
  const n = values.length;
  const width = cap + 1;
  const best = new Float64Array(width);
  const take = new Uint8Array(n * width);
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    const w = weights[i]!;
    if (v <= 0 || w > cap) continue; // a non-positive item never helps an unconstrained maximum
    const row = i * width;
    for (let c = cap; c >= w; c--) {
      const cand = best[c - w]! + v;
      // strict improvement (with a tolerance) so floating noise cannot flip ties between runs
      if (cand > best[c]! + 1e-12) {
        best[c] = cand;
        take[row + c] = 1;
      }
    }
  }
  const chosen: number[] = [];
  let c = cap;
  for (let i = n - 1; i >= 0; i--) {
    if (take[i * width + c]) {
      chosen.push(i);
      c -= weights[i]!;
    }
  }
  return chosen.reverse();
}

function summarise(items: KnapsackItem[], idx: number[], lambda: number): KnapsackResult {
  let value = 0;
  let minutes = 0;
  for (const i of idx) {
    value += items[i]!.value;
    minutes += wholeMinutes(items[i]!.minutes);
  }
  return { chosen: idx.map((i) => items[i]!.id), value, minutes, lambda };
}

function oldMinutesOf(items: KnapsackItem[], weights: number[], idx: number[]): number {
  let m = 0;
  for (const i of idx) if (items[i]!.old) m += weights[i]!;
  return m;
}

/**
 * Exact 0/1 knapsack: maximise the sum of values with total whole minutes <= capacity. With floorShare,
 * old items get a bonus lambda per minute; lambda is the smallest (by bisection) that makes old minutes
 * reach floorShare x capacity, or as many old minutes as can fit when the floor is not reachable.
 */
export function solveKnapsack(items: KnapsackItem[], capacity: number, opts: KnapsackOptions = {}): KnapsackResult {
  const cap = Math.max(0, Math.floor(capacity));
  const weights = items.map((it) => wholeMinutes(it.minutes));
  const base = items.map((it) => it.value);
  const at = (lambda: number): number[] =>
    dp(
      lambda === 0 ? base : items.map((it, i) => base[i]! + (it.old ? lambda * weights[i]! : 0)),
      weights,
      cap,
    );

  const free = at(0);
  const floor = (opts.floorShare ?? 0) * cap;
  if (floor <= 0 || oldMinutesOf(items, weights, free) >= floor) return summarise(items, free, 0);

  // A bonus above the total value spread makes one more old minute worth more than any value trade,
  // so the solution at lamHi carries the most old minutes that can fit: the reachable target.
  let spread = 1;
  for (const v of base) spread += Math.abs(v);
  let lamHi = spread;
  let hiSol = at(lamHi);
  const target = Math.min(floor, oldMinutesOf(items, weights, hiSol));
  let lamLo = 0;
  for (let k = 0; k < 40 && lamHi - lamLo > 1e-9 * spread; k++) {
    const mid = (lamLo + lamHi) / 2;
    const sol = at(mid);
    if (oldMinutesOf(items, weights, sol) >= target) {
      lamHi = mid;
      hiSol = sol;
    } else lamLo = mid;
  }
  return summarise(items, hiSol, lamHi);
}

/**
 * The obvious heuristic, for comparison: offer old items first by value per minute until the floor is met,
 * then everything else by value per minute, taking whatever still fits.
 */
export function greedyKnapsack(items: KnapsackItem[], capacity: number, opts: KnapsackOptions = {}): KnapsackResult {
  const cap = Math.max(0, Math.floor(capacity));
  const weights = items.map((it) => wholeMinutes(it.minutes));
  const density = (i: number): number => (weights[i]! === 0 ? Infinity : items[i]!.value / weights[i]!);
  const order = items
    .map((_, i) => i)
    .filter((i) => items[i]!.value > 0)
    .sort((a, b) => density(b) - density(a) || a - b);
  const floor = (opts.floorShare ?? 0) * cap;
  const taken = new Set<number>();
  let used = 0;
  let oldUsed = 0;
  if (floor > 0) {
    for (const i of order) {
      if (oldUsed >= floor) break;
      if (!items[i]!.old || used + weights[i]! > cap) continue;
      taken.add(i);
      used += weights[i]!;
      oldUsed += weights[i]!;
    }
  }
  for (const i of order) {
    if (taken.has(i) || used + weights[i]! > cap) continue;
    taken.add(i);
    used += weights[i]!;
  }
  return summarise(
    items,
    [...taken].sort((a, b) => a - b),
    0,
  );
}

export interface ClusterResult {
  chosen: string[];
  value: number;
  minutes: number;
  swaps: number;
  /** distinct advocates before and after the pass */
  advocatesBefore: number;
  advocatesAfter: number;
}

/**
 * Advocate clustering by local search: swap a chosen matter whose advocate has nothing else today for an
 * unchosen matter of an advocate who is already coming, when capacity and the floor still hold and the
 * total value lost stays within epsilon x the starting value. Each swap saves one advocate a trip.
 */
export function clusterByAdvocate(
  items: KnapsackItem[],
  chosenIds: string[],
  capacity: number,
  opts: { floorShare?: number; epsilon?: number } = {},
): ClusterResult {
  const cap = Math.max(0, Math.floor(capacity));
  const byId = new Map(items.map((it) => [it.id, it]));
  const chosen = new Set(chosenIds);
  const w = (it: KnapsackItem): number => wholeMinutes(it.minutes);
  let minutes = 0;
  let value = 0;
  let oldMin = 0;
  const count = new Map<string, number>();
  for (const id of chosen) {
    const it = byId.get(id)!;
    minutes += w(it);
    value += it.value;
    if (it.old) oldMin += w(it);
    if (it.advocate) count.set(it.advocate, (count.get(it.advocate) ?? 0) + 1);
  }
  const advocatesBefore = count.size;
  const floor = (opts.floorShare ?? 0) * cap;
  const floorWasMet = oldMin >= floor;
  let budget = Math.max(0, (opts.epsilon ?? 0.02) * value);
  let swaps = 0;
  let improved = true;
  while (improved) {
    improved = false;
    // lone matters, least valuable first: the cheapest to give up
    const lone = [...chosen]
      .map((id) => byId.get(id)!)
      .filter((it) => it.advocate && count.get(it.advocate) === 1)
      .sort((a, b) => a.value - b.value || (a.id < b.id ? -1 : 1));
    // matters of advocates already coming, most valuable first
    const joiners = items
      .filter((it) => !chosen.has(it.id) && it.advocate && (count.get(it.advocate) ?? 0) > 0 && it.value > 0)
      .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
    outer: for (const out of lone) {
      for (const inn of joiners) {
        if (inn.advocate === out.advocate) continue;
        const loss = out.value - inn.value;
        if (loss > budget + 1e-12) continue;
        const newMinutes = minutes - w(out) + w(inn);
        if (newMinutes > cap) continue;
        const newOld = oldMin - (out.old ? w(out) : 0) + (inn.old ? w(inn) : 0);
        if (floorWasMet && newOld < floor) continue;
        if (!floorWasMet && newOld < oldMin) continue;
        chosen.delete(out.id);
        chosen.add(inn.id);
        count.delete(out.advocate!);
        count.set(inn.advocate!, (count.get(inn.advocate!) ?? 0) + 1);
        minutes = newMinutes;
        oldMin = newOld;
        value -= loss;
        budget -= Math.max(0, loss);
        swaps++;
        improved = true;
        break outer;
      }
    }
  }
  const order = new Map(items.map((it, i) => [it.id, i]));
  return {
    chosen: [...chosen].sort((a, b) => order.get(a)! - order.get(b)!),
    value,
    minutes,
    swaps,
    advocatesBefore,
    advocatesAfter: count.size,
  };
}
