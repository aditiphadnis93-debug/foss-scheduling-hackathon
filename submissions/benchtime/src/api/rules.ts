// GET /api/rules/presets and POST /api/rules/preview: the judge's saved rules. The presets are the case
// study's judges as rule sets over our planner (edit any field); the preview shows a rule set's effect on
// one day's plan (and whether that plan keeps every rule) and on every scorecard over the horizon, with and
// without the rules, paired on shared seeds.

import type { JudgeConfig } from "../domain/types";
import { RULE_PRESETS, ruleViolations, type Rules } from "../planner/zoo/rules";
import { CAPACITY, HORIZON, HttpError, checkPolicy, cleanConfig, effectiveConfig, getEnv, inHorizon, isWorkingDay, nextWorkingDayOnOrAfter } from "./context";
import { freePlan } from "./plan";
import { diffSummary, parseSeeds, parseWeeks, runSeeds, summaryOf } from "./simulate";
import { stateAt } from "./state";

/** the planner the rules sit on: ours (the zoo) unless the request names another */
const RULES_POLICY = "zoo";

export function rulesPresetsHandler() {
  return {
    policy: RULES_POLICY,
    note: "Each preset is a starting point: send it back as `config` (edited or not) to /api/plan, /api/simulate or /api/rules/preview. The 15% floor for 4+ year cases cannot be lowered.",
    presets: Object.values(RULE_PRESETS).map((p) => ({ id: p.id, name: p.name, description: p.description, config: p.rules })),
  };
}

/** Problems with a rule set that cleaning cannot fix by itself: reported, never silently kept. */
export function ruleProblems(raw: unknown, eff: Rules): string[] {
  const out: string[] = [];
  if (raw && typeof raw === "object") {
    const known = new Set(["weights", "fillTarget", "ageingFloor", "clusterByAdvocate", "blocks", "carryForward", "processDesk", "checkin", "standbyShare", "smartNextDate", "blocksByWeekday", "maxListed", "halfDays", "halfDayWeekdays", "leaveDays", "priorityTypes", "minNoticeDays", "maxGapDays", "maxPerAdvocate", "groupByAdvocate", "carriedFirst", "aim"]);
    for (const k of Object.keys(raw as object)) if (!known.has(k)) out.push(`unknown rule "${k}" ignored`);
    const r = raw as Record<string, unknown>;
    if (typeof r.ageingFloor === "number" && r.ageingFloor < 0.15) out.push("the floor for 4+ year cases cannot go below 15%: kept at 15%");
  }
  if (eff.minNoticeDays !== undefined && eff.maxGapDays !== undefined && eff.minNoticeDays > eff.maxGapDays) out.push("minimum notice is longer than the maximum gap: the notice wins");
  const themed = Object.values(eff.blocksByWeekday ?? {}).filter((b) => b && b.length);
  if (themed.length > 0 && themed.length < 5) out.push("weekday themes cover only some weekdays: the other days take every purpose");
  for (const b of [...eff.blocks, ...Object.values(eff.blocksByWeekday ?? {}).flat()]) if (b && b.types !== "all" && b.types.length === 0) out.push(`block "${b.id}" admits no purpose`);
  if (eff.maxListed !== undefined && eff.maxListed < 10) out.push(`a cap of ${eff.maxListed} matters leaves most of the day unused`);
  return out;
}

export async function rulesPreviewHandler(body: Record<string, unknown>) {
  const t0 = performance.now();
  const policy = body.policy === undefined ? RULES_POLICY : checkPolicy(body.policy);
  const presetId = body.preset;
  if (presetId !== undefined && (typeof presetId !== "string" || !(presetId in RULE_PRESETS))) throw new HttpError(400, "unknown preset", `${String(presetId)}; known: ${Object.keys(RULE_PRESETS).join(", ")}`);
  const preset = typeof presetId === "string" ? RULE_PRESETS[presetId]!.rules : {};
  const edits = cleanConfig(body.config) ?? {};
  const without = cleanConfig(body.baseConfig);
  const withRules: Partial<JudgeConfig> = { ...(without ?? {}), ...preset, ...edits, weights: { ...(without?.weights ?? {}), ...(preset.weights ?? {}), ...(edits.weights ?? {}) } as JudgeConfig["weights"] };
  const effWith = effectiveConfig(policy, withRules) as Rules;
  const problems = ruleProblems(body.config, effWith);

  // one day's plan both ways, and whether the plan with the rules keeps every one of them
  const env = getEnv();
  let date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : HORIZON.start;
  if (!inHorizon(date)) throw new HttpError(400, "date outside the horizon", `plans are made for ${HORIZON.start} to ${HORIZON.end}`);
  if (!isWorkingDay(date, env.calendar)) date = nextWorkingDayOnOrAfter(date, env.calendar);
  const dayOf = async (cfg: Partial<JudgeConfig> | undefined) => {
    const st = await stateAt(policy, cfg, date);
    const plan = freePlan(policy, cfg, st.ctx);
    const main = plan.listings.filter((l) => !l.standby);
    const byType: Record<string, number> = {};
    for (const l of plan.listings) byType[l.type] = (byType[l.type] ?? 0) + 1;
    return { ctx: st.ctx, plan, summary: { listed: plan.listings.length, standby: plan.listings.length - main.length, expectedMinutes: Math.round(main.reduce((s, l) => s + l.expectedMinutes, 0)), expectedSubstantive: +plan.expected.substantive.toFixed(2), desk: plan.desk.length, deferred: plan.deferred.length, byType } };
  };
  const [a, b] = await Promise.all([dayOf(without), dayOf(withRules)]);
  const violations = ruleViolations(effWith, b.ctx, b.plan, CAPACITY);

  // every scorecard over the horizon (or the first weeks), paired on shared seeds
  const seeds = parseSeeds(body.seeds, body.quick !== false);
  const { weeks, end } = parseWeeks(body.weeks);
  const [ra, rb] = await Promise.all([runSeeds({ policy, config: without, seeds, end }), runSeeds({ policy, config: withRules, seeds, end })]);
  return {
    policy,
    preset: presetId ?? null,
    config: effWith,
    problems,
    date,
    plan: {
      without: a.summary,
      with: b.summary,
      listings: b.plan.listings.map((l) => ({ caseId: l.caseId, type: l.type, callTime: l.callTime, window: l.window, standby: l.standby, why: l.why[l.why.length - 1] ?? "" })),
      keepsEveryRule: violations.length === 0,
      violations: violations.slice(0, 50),
    },
    seeds,
    weeks,
    horizon: { start: HORIZON.start, end },
    scorecards: { without: summaryOf(ra.map((x) => x.scorecards)), with: summaryOf(rb.map((x) => x.scorecards)), diff: diffSummary(ra.map((x) => x.scorecards), rb.map((x) => x.scorecards)) },
    elapsedMs: Math.round(performance.now() - t0),
  };
}
