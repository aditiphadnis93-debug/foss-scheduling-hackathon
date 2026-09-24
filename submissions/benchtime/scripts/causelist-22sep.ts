// PUCAR's real causelist for 22 September 2026, scored with nothing but PUCAR's own per-type tables.
// No simulator, no behavioural assumption: expected minutes and expected substantive hearings come
// straight from hearing_type_reference.csv (duration) and substantiveness_by_hearing_type.csv (P).
//
//   bun run scripts/causelist-22sep.ts            -> prints the comparison, writes out/causelist-22sep.md
//
// Three ways to run the same 90 listings through a 420-minute day:
//   as printed : call in the printed order until the day runs out (the status quo)
//   exact best : the subset of the same 90 that maximises expected substantive hearings within 420 expected
//                minutes (0/1 knapsack, dynamic programming, exact)
//   desk first : as exact best, after moving matters whose most common failure is process not returned or
//                an outside report not ready to the desk (they are chased on paper, not called)
// A failed hearing is assumed to take 2 minutes to call and adjourn (the one assumption, stated).

import { parseCsv } from "../src/data/csv";

const DATA = new URL("../../../data/", import.meta.url).pathname;
const CAPACITY = 420;
const CALL_MINUTES = 2;

const read = async (f: string) => parseCsv(await Bun.file(DATA + f).text());
const ref = new Map((await read("hearing_type_reference.csv")).map((r) => [r["Hearing Purpose"]!, { minutes: Number(r["Time it takes for hearing (mins) - estimated"]) }]));
const sub = new Map((await read("substantiveness_by_hearing_type.csv")).map((r) => [r["hearingType"]!, Number(r["Substantive Hearings (percentage probability)"]) / 100]));
const fail = new Map(
  (await read("hearing_failure_reasons.csv")).map((r) => {
    const total = Number(r["total_no"]);
    const knowable = Number(r["Awaiting Process / Summons / Warrant Return"]) + Number(r["External Dependency"]);
    return [r["hearingType"]!, { knowableShare: total ? knowable / total : 0 }];
  }),
);
const list = await read("sample_causelist_2026-09-22.csv");

interface Item { id: string; type: string; p: number; minutes: number; exp: number; knowable: number }
const items: Item[] = list.map((r, i) => {
  const type = r["Hearing Type"]!;
  const p = sub.get(type)!;
  const minutes = ref.get(type)!.minutes;
  const knowable = fail.get(type)!.knowableShare;
  return { id: r["Case Number"] || r["Filing Number"] || `row${i + 1}`, type, p, minutes, exp: p * minutes + (1 - p) * CALL_MINUTES, knowable };
});

function asPrinted(xs: Item[]) {
  let used = 0;
  let substantive = 0;
  let reached = 0;
  for (const x of xs) {
    if (used >= CAPACITY) break;
    used += x.exp;
    substantive += x.p;
    reached++;
  }
  return { reached, substantive, minutes: used };
}

/** exact 0/1 knapsack on integer tenths of a minute: maximise sum of p subject to sum of expected minutes <= capacity */
function exactBest(xs: Item[]) {
  const W = CAPACITY * 10;
  const w = xs.map((x) => Math.ceil(x.exp * 10));
  const best = new Float64Array(W + 1);
  const take: Uint8Array[] = xs.map(() => new Uint8Array(W + 1));
  xs.forEach((x, i) => {
    for (let c = W; c >= w[i]!; c--) {
      const v = best[c - w[i]!]! + x.p;
      if (v > best[c]! + 1e-12) {
        best[c] = v;
        take[i]![c] = 1;
      }
    }
  });
  const chosen: Item[] = [];
  let c = W;
  for (let i = xs.length - 1; i >= 0; i--) {
    if (take[i]![c]) {
      chosen.push(xs[i]!);
      c -= w[i]!;
    }
  }
  return { chosen: chosen.reverse(), substantive: chosen.reduce((s, x) => s + x.p, 0), minutes: chosen.reduce((s, x) => s + x.exp, 0) };
}

const total = items.reduce((s, x) => s + x.minutes, 0);
const totalExp = items.reduce((s, x) => s + x.exp, 0);
const printed = asPrinted(items);
const best = exactBest(items);

// Who comes to a listing: PUCAR's roster records who was present at the last hearing of each of its 100 cases.
const roster = await read("roster_sample_100.csv");
const roles = ["Complainant", "Complainant's Advocate", "Accused", "Accused Advocate"];
const presentRate = roles.map((role) => roster.filter((r) => (r["last_hearing_summary"] ?? "").split("\n").some((l) => l.trim().startsWith("Present:") && l.split(",").some((x) => x.replace("Present:", "").trim() === role))).length / roster.length);
const peoplePerListing = presentRate.reduce((a, b) => a + b, 0);

// A listing whose failure is knowable the night before (process not returned, outside report not ready) is the
// share (1 - p) x knowable of each type. Chasing those at the desk changes no expected substantive hearing (they
// would have failed anyway); it saves their call minutes and every trip made for them.
const knowableFails = items.reduce((s, x) => s + (1 - x.p) * x.knowable, 0);
const allFails = items.reduce((s, x) => s + (1 - x.p), 0);
const tripsWasted = allFails * peoplePerListing;
const tripsKnowable = knowableFails * peoplePerListing;
const byType = new Map<string, number>();
for (const x of items) byType.set(x.type, (byType.get(x.type) ?? 0) + 1);

const f1 = (n: number) => n.toFixed(1);
const lines = [
  "# The real causelist of 22 September 2026, scored with PUCAR's own tables",
  "",
  `${items.length} matters listed. If every one were heard in full: ${Math.round(total)} minutes of work for a ${CAPACITY}-minute day (${f1(total / CAPACITY)} times capacity).`,
  `Expected minutes once failures are counted (a failed matter takes ${CALL_MINUTES} minutes to call and adjourn): ${Math.round(totalExp)}.`,
  "",
  "## Choosing better from this list alone barely helps",
  "",
  "| way of running the same list | matters called | expected substantive hearings | expected minutes used |",
  "|---|---|---|---|",
  `| as printed, until the day runs out | ${printed.reached} | ${f1(printed.substantive)} | ${Math.round(printed.minutes)} |`,
  `| exact best subset of the same ${items.length} | ${best.chosen.length} | ${f1(best.substantive)} | ${Math.round(best.minutes)} |`,
  "",
  `A failed matter costs the bench about ${CALL_MINUTES} minutes, so calling most of a 90-matter list captures most of its value. The bench is not where the waste is.`,
  "",
  `## The waste is people, and ${Math.round((100 * knowableFails) / allFails)}% of it is knowable the night before`,
  "",
  `Expected failed listings on this day: ${f1(allFails)} of ${items.length}. Of those, ${f1(knowableFails)} fail because a summons, notice or warrant has not come back or an outside report is not ready (PUCAR's failure shares per type).`,
  `People per listing, from who PUCAR's roster records as present at the last hearing: ${f1(peoplePerListing)} (complainant ${Math.round(presentRate[0]! * 100)}%, complainant's advocate ${Math.round(presentRate[1]! * 100)}%, accused ${Math.round(presentRate[2]! * 100)}%, accused's advocate ${Math.round(presentRate[3]! * 100)}%).`,
  `Expected trips made for hearings that fail: ${Math.round(tripsWasted)}. Trips made for hearings that fail for a reason known the night before: ${Math.round(tripsKnowable)}. Those are the ones a process desk removes without losing a single substantive hearing.`,
  "",
  "Hearing types on the list:",
  "",
  "| hearing type | listed | minutes if heard | P(substantive) | share of failures that were knowable (process or outside report) |",
  "|---|---|---|---|---|",
  ...[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
    const x = items.find((i) => i.type === t)!;
    return `| ${t} | ${n} | ${x.minutes} | ${Math.round(x.p * 100)}% | ${Math.round(x.knowable * 100)}% |`;
  }),
  "",
  "Expected values only; no simulation and no behavioural assumption beyond the 2-minute call. The exact best subset is",
  "the ceiling of what choosing from this particular list can do; the full engine also chooses which cases to list at all,",
  "and whether their people need to come.",
];
await Bun.write(new URL("../out/causelist-22sep.md", import.meta.url).pathname, lines.join("\n") + "\n");
console.log(lines.join("\n"));
