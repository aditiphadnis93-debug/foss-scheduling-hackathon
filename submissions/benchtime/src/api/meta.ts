// GET /api/meta: everything static the console needs. Policy names and descriptions come from the policy
// objects themselves and default configurations from src/planner/index, so a new planner shows up here as
// merged. Every measure's definition is the scorecard catalogue's own (src/eval/metrics.ts), with the
// console's short label; any scorecard field the catalogue adds later appears without a change here.

import { RULE_PRESETS, applyRules } from "../planner/zoo/rules";
import type { FailureReason, HearingType, JudgeConfig } from "../domain/types";
import { FAILURE_REASONS, HEARING_TYPES, SEQUENCE } from "../domain/types";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCORECARD_FIELDS } from "../eval/metrics";
import { MIN_AGEING_FLOOR, POLICY_IDS, defaultConfig } from "../planner/index";
import { AGE_BANDS, BASELINE, CAPACITY, HORIZON, POLICY_KIND, RECOMMENDED, REASON_LABEL, ROOT, ROSTER_ID, SEEDS, SITTING, getEnv, makePolicy, round, typeLabel } from "./context";

type Unit = "share" | "days" | "cases" | "minutes" | "years" | "perMonth" | "perDay" | "ratio" | "trips";
type Better = "higher" | "lower" | "neither";
interface Measure {
  id: string;
  card: string;
  label: string;
  unit: Unit;
  better: Better;
  digits: number;
  definition: string;
}

export const CARDS = [
  { id: "readme", label: "Repo README, the five printed scores" },
  { id: "caseStudy", label: "Case study, section 6" },
  { id: "siddarth", label: "Organisers' six" },
  { id: "backlog", label: "Backlog by age" },
  { id: "extra", label: "Trips, listings and disposals" },
];

// [id, label, unit, better, digits]: the console's short labels; definitions come from the catalogue
const MAIN: [string, string, Unit, Better, number][] = [
  ["readme.utilisation", "Utilisation", "share", "higher", 1],
  ["readme.reachRate", "Reach rate", "share", "higher", 1],
  ["readme.substantiveness", "Substantiveness", "share", "higher", 1],
  ["readme.backlog4yHeardShare", "4+ year cases heard at all", "share", "higher", 1],
  ["readme.backlog4ySubstantiveShare", "4+ year cases moved at least once", "share", "higher", 1],
  ["readme.predictabilityGapDays", "Wait from first listing to first hearing", "days", "lower", 1],
  ["caseStudy.utilisation", "Utilisation within capacity", "share", "higher", 1],
  ["caseStudy.overrunDays", "Days the list overran", "days", "lower", 1],
  ["caseStudy.idleMinutesShare", "Idle bench minutes", "share", "lower", 1],
  ["caseStudy.heldAsScheduled", "Held as scheduled", "share", "higher", 1],
  ["caseStudy.heldAsScheduledAllDue", "Held as scheduled, all due matters", "share", "higher", 1],
  ["caseStudy.substantiveness", "Substantiveness", "share", "higher", 1],
  ["caseStudy.nextDateExcessDays", "Next date beyond the procedural minimum", "days", "lower", 1],
  ["caseStudy.wastedRelistShare", "Next dates on which the case was not ready", "share", "lower", 1],
  ["siddarth.throughputPerMonth", "Throughput", "perMonth", "higher", 1],
  ["siddarth.judgeTimeUsed", "Judge time used", "share", "higher", 1],
  ["siddarth.wastedListings", "Wasted listings", "share", "lower", 1],
  ["siddarth.heldOnPromisedDate", "Held on the promised date", "share", "higher", 1],
  ["siddarth.oldestPendingAgeYears", "Oldest pending case at the end", "years", "lower", 1],
  ["siddarth.p95PendingAgeYears", "95th percentile pending age", "years", "lower", 2],
  ["siddarth.neverHeard", "Cases never heard", "cases", "lower", 0],
  ["siddarth.loadBalanceCv", "Load balance across days", "ratio", "lower", 3],
  ["extra.listedPerDay", "Listed a day", "perDay", "neither", 1],
  ["extra.reachedPerDay", "Reached a day", "perDay", "higher", 1],
  ["extra.substantivePerDay", "Substantive hearings a day", "perDay", "higher", 1],
  ["extra.disposed", "Disposed in the horizon", "cases", "higher", 0],
  ["extra.disposed4yPlus", "4+ year cases disposed", "cases", "higher", 0],
  ["extra.tripsPerSubstantive", "Trips per substantive hearing", "trips", "lower", 2],
  ["extra.wastedTripShare", "Wasted trips", "share", "lower", 1],
  ["extra.deskPerDay", "Handled at the desk a day", "perDay", "neither", 1],
  ["extra.vacatedPerDay", "Released at check-in a day", "perDay", "neither", 1],
];

const DIGITS: Record<Unit, number> = { share: 1, days: 1, cases: 0, minutes: 0, years: 2, perMonth: 1, perDay: 1, ratio: 3, trips: 2 };

export function measures(): Measure[] {
  const cat = new Map(SCORECARD_FIELDS.map((f) => [`${f.family}.${f.key}`, f]));
  const out: Measure[] = MAIN.map(([id, label, unit, better, digits]) => ({ id, card: id.split(".")[0]!, label, unit, better, digits, definition: cat.get(id)?.source ?? label }));
  const start = HORIZON.start;
  const end = HORIZON.end;
  for (const n of [3, 4, 5]) {
    out.push({ id: `backlog.plus${n}Start`, card: "backlog", label: `${n}+ year cases at the start`, unit: "cases", better: "neither", digits: 0, definition: `Pending cases aged ${n} years or more (365.25-day years since filing) on ${start}.` });
    out.push({ id: `backlog.plus${n}End`, card: "backlog", label: `${n}+ year cases at the end`, unit: "cases", better: "lower", digits: 0, definition: `Pending cases aged ${n} years or more on ${end}.` });
    out.push({ id: `backlog.plus${n}Change`, card: "backlog", label: `Change in ${n}+ year cases`, unit: "cases", better: "lower", digits: 0, definition: `End minus start, per seed. Positive means the band grew.` });
  }
  for (const b of AGE_BANDS) {
    const id = `caseStudy.ageBandsEnd.${b}`;
    out.push({ id, card: "caseStudy", label: `Pending at the end, ${b} years`, unit: "cases", better: b === "0-1" || b === "1-3" ? "neither" : "lower", digits: 0, definition: cat.get(id)?.source ?? `Pending cases aged ${b} years on ${end}.` });
  }
  // every other scorecard field the catalogue defines (alternative readings and further measures)
  const have = new Set(out.map((m) => m.id));
  for (const f of SCORECARD_FIELDS) {
    const id = `${f.family}.${f.key}`;
    if (have.has(id) || f.key.startsWith("ageBandsStart") || f.key.startsWith("ageBandsEnd")) continue;
    const unit: Unit = f.unit === "count" ? "cases" : f.unit;
    out.push({ id, card: f.family, label: f.label, unit, better: f.better ?? "neither", digits: DIGITS[unit], definition: f.source });
  }
  return out;
}

function presets(): { id: string; name: string; description: string; config: JudgeConfig }[] {
  // the case study's judges' rules expressed as benchtime configurations (their own settings, run through the engine)
  return [
    { id: "recommended", name: "Recommended", description: "The tournament winner: every case gets a date inside the quarter; each day the due cases are ranked by one priority number (the value of hearing it today and the cost of it waiting, less the trips a failure wastes, per minute); at least a third of the minutes go first to 4+ year cases and every one of them comes before the bench at least every 45 working days; summons, notices and warrants not yet back are handled at the desk; next dates are the earliest day with room after PUCAR's typical gap.", config: defaultConfig(RECOMMENDED) },
    { id: "sehgal", name: "Justice Sehgal", description: "Fresh matters in a morning block and the oldest in an afternoon block, lists more than the day holds, unheard cases return the same weekday next week.", config: defaultConfig("sehgal") },
    { id: "dimakar", name: "Justice Dimakar", description: "Old matters weighted twice, hearings grouped by advocate.", config: defaultConfig("dimakar") },
    { id: "joshi", name: "Justice Joshi", description: "Fresh matters first; no extra weight for age beyond the 15% floor that no rule may go below.", config: defaultConfig("joshi") },
  ];
}

export function metaHandler() {
  const env = getEnv();
  const { ref, calendar } = env;
  // PUCAR's pooled share of each reason among non-substantive hearings, weighted by its failure counts
  const pooled = Object.fromEntries(FAILURE_REASONS.map((f) => [f, 0])) as Record<FailureReason, number>;
  let total = 0;
  for (const t of HEARING_TYPES) {
    const n = ref[t].failureCount;
    total += n;
    for (const f of FAILURE_REASONS) pooled[f] += n * (ref[t].failureShare[f] ?? 0);
  }
  return {
    version: 1,
    court: { name: "Kollam, Section 138 NI Act summary trials", bench: "One judge", rosterId: ROSTER_ID, cases: env.records.length, capacityMinutes: CAPACITY, sitting: SITTING },
    horizon: {
      start: HORIZON.start,
      end: HORIZON.end,
      workingDays: env.days,
      holidays: [...calendar.holidays.entries()].filter(([d]) => d >= HORIZON.start && d <= HORIZON.end).map(([date, name]) => ({ date, name })).sort((a, b) => (a.date < b.date ? -1 : 1)),
      judgeLeave: [...calendar.judgeLeave].filter((d) => d >= HORIZON.start && d <= HORIZON.end).sort(),
    },
    defaultDate: env.days[0],
    hearingTypes: HEARING_TYPES.map((t: HearingType) => ({
      type: t,
      label: typeLabel(t),
      sequential: (SEQUENCE as readonly string[]).includes(t),
      durationMin: ref[t].durationMin,
      gapDays: ref[t].gapDays,
      pSubstantive: ref[t].pSubstantive,
      pSubstantiveSource: ref[t].pSubstantiveSource,
      medianHearings: ref[t].hearingsPerCase.median,
      meanHearings: ref[t].hearingsPerCase.mean,
    })),
    failureReasons: FAILURE_REASONS.map((f) => ({ id: f, label: REASON_LABEL[f], share: total > 0 ? round(pooled[f] / total, 3) : 0 })),
    ageBands: [...AGE_BANDS],
    policies: POLICY_IDS.map((id) => {
      const p = makePolicy(id);
      return { id, name: p.name, kind: POLICY_KIND[id] ?? "baseline", description: p.description, config: defaultConfig(id) };
    }),
    recommended: RECOMMENDED,
    // what the list can aim for: send { aim: id } in config; each aim's measured effect (out/aims.json)
    aims: loadAims(),
    baseline: BASELINE,
    defaultConfig: defaultConfig(RECOMMENDED),
    presets: presets(),
    // the judges' ways as saved rules over our planner (the zoo): start from one, edit, send back as config
    rulePresets: Object.values(RULE_PRESETS).map((p) => ({ id: p.id, name: p.name, description: p.description, policy: "zoo", rules: p.rules, config: applyRules(defaultConfig("zoo"), p.rules) })),
    limits: {
      ageingFloorMin: MIN_AGEING_FLOOR,
      ageingFloorReason: "Ageing cases may never be deprioritised (case study, section 4, goal 6), so at least 15% of minutes are offered first to cases 4 years or older.",
      fillTarget: { min: 0.6, max: 1.5, step: 0.05 },
      standbyShare: { min: 0, max: 0.3, step: 0.05 },
    },
    seeds: SEEDS,
    cards: CARDS,
    measures: measures(),
  };
}

function loadAims(): unknown {
  const f = join(ROOT, "out", "aims.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
