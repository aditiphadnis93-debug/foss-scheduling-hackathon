# benchtime console API

The judge console (`web/`) talks to the engine only through the endpoints below. The engine serves them on
`http://127.0.0.1:8791`; `web/serve.ts` serves the console on `http://localhost:8792` and proxies `/api/*` to the
engine. When the engine is not running, or answers 404 or 501 for a route it does not have yet, `serve.ts` answers
from `web/fixtures/*.json` and the stand-ins in `web/mock/` and sets `x-benchtime-source: sample`; the console then
shows "Engine not running, showing sample data" in its footer. Every fixture is a worked example of the response
it is named after (`bun run web/fixtures/build.ts` regenerates them).

```
bun run web/serve.ts              # console on :8792, engine expected on :8791
SAMPLE=1 bun run web/serve.ts     # sample data only, never call the engine
ENGINE=http://host:port bun run web/serve.ts
```

## Conventions

- JSON in and out, `content-type: application/json`. Dates are ISO `YYYY-MM-DD`, clock times `HH:MM` (24 hour).
- Shares and probabilities are numbers in `[0, 1]`; the console turns them into percentages. Minutes are bench minutes.
- `Interval` is `{ "mean": number, "lo": number, "hi": number }`: the mean across world seeds and its 95% interval
  (t interval of the mean across seeds). A paired difference is the mean of the per-seed differences `b - a`, with
  the 95% interval of that mean; seeds are shared, so this is the common-random-numbers comparison.
- A value that is not random (for example the age bands at the start) is still an `Interval` with `lo = hi = mean`.
- Errors: HTTP 4xx or 5xx with `{ "error": string, "detail"?: string }`. A date that is not a working day is not an
  error for `/api/plan` (see `workingDay`).
- Case ids contain slashes (`ST/1922/2016`): URL-encode them in paths (`/api/case/ST%2F1922%2F2016`).
- Enumerations are the ones in `src/domain/types.ts`: `HearingType` (14 values), `SequentialType` (11),
  `FailureReason` (10), `ProcessKind`, `Outcome`, and `JudgeConfig`. `Partial<JudgeConfig>` means any subset of its
  fields; `weights` may itself be partial. The engine merges it over the policy's own config and clamps
  `ageingFloor` to at least `0.15`.
- `AgeBand` is one of `"0-1" | "1-3" | "3-4" | "4-5" | "5+"` (years since filing).
- `Role` is `"complainant" | "complainantAdvocate" | "accused" | "accusedAdvocate"`.

## Shared shapes

```ts
interface Interval { mean: number; lo: number; hi: number }

/** Every Scorecards field (src/domain/types.ts) as an Interval, plus the backlog card. Keys exactly as below. */
interface Summary {
  readme: {
    utilisation: Interval; reachRate: Interval; substantiveness: Interval;
    backlog4yHeardShare: Interval; backlog4ySubstantiveShare: Interval; predictabilityGapDays: Interval;
  };
  caseStudy: {
    utilisation: Interval; overrunDays: Interval; idleMinutesShare: Interval;
    heldAsScheduled: Interval; heldAsScheduledAllDue: Interval; substantiveness: Interval;
    ageBandsStart: Record<AgeBand, Interval>; ageBandsEnd: Record<AgeBand, Interval>;
    nextDateExcessDays: Interval; wastedRelistShare: Interval;
  };
  siddarth: {
    throughputPerMonth: Interval; judgeTimeUsed: Interval; wastedListings: Interval; heldOnPromisedDate: Interval;
    oldestPendingAgeYears: Interval; p95PendingAgeYears: Interval; neverHeard: Interval; loadBalanceCv: Interval;
  };
  extra: {
    listedPerDay: Interval; reachedPerDay: Interval; substantivePerDay: Interval; disposed: Interval;
    disposed4yPlus: Interval; tripsPerSubstantive: Interval; wastedTripShare: Interval;
    deskPerDay: Interval; vacatedPerDay: Interval;
  };
  /** derived per seed from the age bands: cases 3+, 4+, 5+ years old at the start and end, and end minus start */
  backlog: {
    plus3Start: Interval; plus3End: Interval; plus3Change: Interval;
    plus4Start: Interval; plus4End: Interval; plus4Change: Interval;
    plus5Start: Interval; plus5End: Interval; plus5Change: Interval;
  };
}
```

`caseStudy.overrunDays` is a count of sitting days in the simulated window (not a share). Everything else follows
DESIGN.md. The console labels, formats and colours every field from `meta.measures` (below), so a new field needs
only a new catalogue entry.

```ts
/** One case as the court knows it on the plan date (rule 1: nothing from the world). */
interface CaseDetail {
  id: string; filingNumber: string; filingDate: string;
  ageYears: number;                    // on the plan date, two decimals
  ageBand: AgeBand;
  crossesNext: { years: 3 | 4 | 5 | 10; on: string } | null;   // next age threshold crossed inside the horizon
  advocateId: string; partyId: string;
  stage: SequentialType; stageLabel: string;
  nextPurpose: HearingType; nextPurposeLabel: string;
  hearingsAtPurpose: number;           // hearings already held at the next purpose (roster count plus observed)
  pucarMedianAtPurpose: number;        // PUCAR's median hearings per case for that type
  totalHearings: number;
  consecutiveNonSubstantive: number;   // hearings in a row that did not move the case
  lastSummary: { raw: string; notes: string[]; tags: string[] };   // ParsedSummary: raw text, non-attendance lines, parser tags
  attendance: {
    last: Record<Role, boolean | null>;                          // at the last hearing, null = not recorded
    record: Record<Role, { present: number; recorded: number }>; // over hearings where attendance was recorded
  };
  process: { kind: ProcessKind; state: "out" | "returned" | "served"; issuedOn: string | null;
             daysOut: number | null; returnedKnownOn: string | null } | null;
  externalPending: { kind: "mediation_report"; since: string | null; readyKnownOn: string | null } | null;
  prediction: {
    pSubstantive: number;              // what the planner uses
    prior: number;                     // PUCAR's rate for the type
    reasons: { text: string; effect: number }[];   // signed change in probability, in the order applied; prior + sum = pSubstantive (after clamping)
  };
  nextDate: string | null;             // the date currently promised
  lastHeardOn: string | null;
}
```

## GET /api/meta

Everything static the console needs. Cached by the console for the page load.

```ts
{
  version: 1,
  court: { name: string; bench: string; rosterId: string; cases: number; capacityMinutes: 420;
           sitting: { start: "10:00"; end: "17:30"; breaks: { start: string; end: string }[] } },
  horizon: { start: "2026-10-01"; end: "2026-12-15"; workingDays: string[]; holidays: { date: string; name: string }[]; judgeLeave: string[] },
  defaultDate: string,                          // first working day the console opens on
  hearingTypes: { type: HearingType; label: string; sequential: boolean; durationMin: number; gapDays: number;
                  pSubstantive: number; pSubstantiveSource: "real" | "estimated"; medianHearings: number; meanHearings: number }[],
  failureReasons: { id: FailureReason; label: string; share: number }[],   // PUCAR's pooled share among non-substantive hearings
  ageBands: AgeBand[],
  policies: { id: string; name: string; kind: "baseline" | "judge" | "ours"; description: string; config: JudgeConfig }[],
  recommended: "zoo",                          // the tournament winner (the zoo at its default genome)
  baseline: "status_quo_60",
  defaultConfig: JudgeConfig,                   // the recommended rules
  presets: { id: "recommended" | "sehgal" | "dimakar" | "joshi"; name: string; description: string; config: JudgeConfig }[],
  limits: { ageingFloorMin: 0.15; ageingFloorReason: string;
            fillTarget: { min: number; max: number; step: number }; standbyShare: { min: number; max: number; step: number } },
  seeds: { tuning: [1, 20]; validation: [21, 30]; test: [31, 60]; interactiveDefault: [31, 40] },
  cards: { id: "readme" | "caseStudy" | "siddarth" | "backlog" | "extra"; label: string }[],
  measures: {
    id: string;              // dotted path into Summary, e.g. "readme.reachRate", "caseStudy.ageBandsEnd.5+"
    card: string; label: string;
    unit: "share" | "days" | "cases" | "minutes" | "years" | "perMonth" | "perDay" | "ratio" | "trips";
    better: "higher" | "lower" | "neither";
    digits: number;          // decimals to show (shares: decimals of the percentage)
    definition: string;
  }[]
}
```

Policy ids: `status_quo_60`, `status_quo_ref`, `fifo_capped`, `bin_packing`, `oldest_first`, `sehgal`, `dimakar`,
`joshi`, `benchtime`. The presets are `JudgeConfig`s for `benchtime` (the judge's rules), distinct from the
`sehgal` / `dimakar` / `joshi` policies (the case study's judges as baselines).

## POST /api/plan

Tomorrow's list for one date under one policy, with every listed, desk and deferred case in full, the expected
load, and (when the court pins or drops cases) the cost against the plan the policy would have made on its own.

Request:

```ts
{
  date: string;                       // required
  policy: string;                     // default "benchtime"
  config?: Partial<JudgeConfig>;      // the judge's rules, merged over the policy's config
  pin?: string[];                     // case ids the court wants listed (from desk, deferred, or any pending case)
  drop?: string[];                    // case ids the court wants off this day's list
}
```

With `pin` or `drop` the engine plans twice with the same inputs: once constrained (pinned cases forced in,
dropped cases excluded, the rest re-optimised) and once unconstrained. The response is the constrained plan.

Response:

```ts
{
  date: string; policy: string; policyName: string; config: JudgeConfig;   // effective config
  workingDay: boolean;                // false: every list is empty and nextWorkingDay is set
  nextWorkingDay?: string;
  capacityMinutes: 420;
  sitting: { start: string; end: string; breaks: { start: string; end: string }[] };
  listings: {                         // DayPlan.listings, call order, standby matters last
    caseId: string; type: HearingType; order: number;
    callTime: string | null;          // null for standby and for policies without times
    window: string | null;            // "HH:MM-HH:MM", "standby", or null
    standby: boolean; expectedMinutes: number; pSubstantive: number;
    why: string[];                    // one to three short reasons, most important first
    pinned: boolean;
    block: string | null;             // JudgeConfig block id ("day" when there are no blocks)
    case: CaseDetail;
  }[];
  desk: {                             // DayPlan.desk
    caseId: string; action: "await_return" | "reissue" | "await_report";
    kind: ProcessKind | "mediation_report";
    note: string;                     // what the desk does, one sentence
    case: CaseDetail;
  }[];
  deferred: { caseId: string; to: string; reason: string; case: CaseDetail }[];   // DayPlan.deferred
  expected: Expected;                 // for this (possibly constrained) plan, standby excluded
  load: {
    capacityMinutes: 420;
    blocks: { id: string; label: string; start: string; end: string; capacityMinutes: number; expectedMinutes: number; listed: number }[];
    byType: { type: HearingType; label: string; listed: number; expectedMinutes: number }[];
    cumulative: { order: number; caseId: string; expectedEnd: number; lo: number; hi: number }[];  // bench minutes after each call, 10th to 90th percentile
  };
  unconstrained: Expected | null;     // null unless pin or drop was given
  delta: {                            // constrained minus unconstrained, null unless pin or drop was given
    listed: number; substantive: number; minutes: number; utilisation: number;
    overrunRisk: number; minutes4yPlus: number;
  } | null;
  overrides: { pinned: string[]; dropped: string[]; rejected: { caseId: string; reason: string }[] };
  messages: {                         // what publishing would send, one per matter
    caseId: string; to: string;       // advocate id
    channel: "sms"; kind: "listed" | "standby" | "desk" | "deferred";
    text: string;                     // plain sentences; desk messages say "you need not come"
  }[];
}

interface Expected {
  listed: number; standby: number; desk: number; deferred: number;
  minutes: number;                    // expected bench minutes of the listed matters
  minutesLo: number; minutesHi: number;   // 10th and 90th percentile
  reached: number;                    // expected matters reached
  substantive: number;                // expected hearings that move a case
  substantiveLo: number; substantiveHi: number;   // 10th and 90th percentile of hearings that move a case
  overrunRisk: number;                // P(listed work exceeds capacity)
  utilisation: number;                // expected minutes used / capacity
  minutes4yPlus: number; share4yPlus: number;   // expected minutes on cases 4+ years old, and their share
}
```

Example: `fixtures/plan.json` (no overrides), `fixtures/plan-overrides.json` (one pin, one drop).

## POST /api/simulate

Runs the simulator for one policy and config over the horizon (or the first `weeks` weeks) on the given seeds.

Request: `{ policy: string; config?: Partial<JudgeConfig>; seeds?: number[]; weeks?: number; noBehaviour?: boolean }`.
Default seeds are `meta.seeds.interactiveDefault` (31 to 40); default weeks the whole horizon.

Response:

```ts
{
  policy: string; policyName: string; config: JudgeConfig;
  seeds: number[]; weeks: number; horizon: { start: string; end: string }; sittingDays: number;
  summary: Summary;
  initial: { pendingByAge: Record<AgeBand, number>; pendingByStage: Record<SequentialType, number> };  // on the first day
  weekly: {                           // Monday to Sunday weeks clipped to the horizon; week 1 starts 2026-10-01
    week: number; start: string; end: string; sittingDays: number;
    listed: Interval; reached: Interval; substantive: Interval; disposed: Interval;
    desk: Interval; vacated: Interval; minutesUsed: Interval; overrunDays: Interval;   // totals for the week
    pendingByAge: Record<AgeBand, Interval>;        // at the end of the week
    pendingByStage: Record<SequentialType, Interval>;   // at the end of the week, interrupting types counted at their underlying stage
  }[];
  elapsedMs: number;
}
```

Example: `fixtures/simulate.json`.

## POST /api/compare

Two rule sets on the same seeds, with paired differences.

Request: `{ a: { policy: string; config?: Partial<JudgeConfig> }; b: { policy: string; config?: Partial<JudgeConfig> }; seeds?: number[]; weeks?: number }`.

Response:

```ts
{
  seeds: number[]; weeks: number;
  a: { policy: string; policyName: string; config: JudgeConfig; summary: Summary; weekly: Weekly[] };
  b: { policy: string; policyName: string; config: JudgeConfig; summary: Summary; weekly: Weekly[] };
  diff: Summary;                      // b minus a, paired per seed
  elapsedMs: number;
}
```

`Weekly` is the element type of `simulate.weekly`. The console calls a difference better or worse only when its
interval excludes zero, using `meta.measures[].better`. Example: `fixtures/compare.json` (recommended against the
Sehgal preset).

## GET /api/health?date=&policy=

The live picture of the docket on `date` (default `meta.defaultDate`) as the court knows it, and, where it needs the
future, the simulator under `policy` (default `benchtime`, seeds `interactiveDefault`).

```ts
{
  date: string; policy: string; horizon: { start: string; end: string }; pending: number;
  ageingRisk: {
    thresholds: [3, 4, 5, 10];
    counts: Record<"3" | "4" | "5" | "10", number>;   // cases crossing each threshold between date and the horizon end
    byWeek: { week: number; start: string; end: string; "3": number; "4": number; "5": number; "10": number }[];
    cases: {                          // the most urgent first: highest threshold, then earliest crossing; up to 60
      caseId: string; ageYears: number; threshold: 3 | 4 | 5 | 10; crossesOn: string;
      stage: SequentialType; stageLabel: string; nextPurpose: HearingType; nextPurposeLabel: string; advocateId: string;
      nextDate: string | null;
      whyCode: "process_out" | "awaiting_report" | "not_due" | "no_room" | "deferred" | "low_readiness";
      whyNotHeard: string;            // one sentence
      pSubstantive: number;
    }[];
  };
  repeatAdjourned: {
    distribution: { consecutive: number; cases: number; orMore: boolean }[];   // 0..10, the last bucket is "10 or more"
    cases: {                          // most consecutive first; up to 40
      caseId: string; ageYears: number; stage: SequentialType; stageLabel: string;
      nextPurpose: HearingType; nextPurposeLabel: string; advocateId: string;
      consecutive: number; pucarMedian: number;
      reasons: (FailureReason | "unrecorded")[];   // oldest first; the roster records no per-hearing reason, so older ones are "unrecorded" until the court records them
      reasonCounts: Record<string, number>;
      lastNote: string; nextDate: string | null; pSubstantive: number;
    }[];
  };
  stuck: {
    byType: { type: HearingType; label: string; cases: number; docketMedian: number; pucarMedian: number; overMedian: number; overTwiceMedian: number }[];
    cases: { caseId: string; type: HearingType; label: string; hearingsAtPurpose: number; pucarMedian: number; ratio: number; ageYears: number; advocateId: string }[];
  };
  drift: {
    policy: string; policyName: string; seeds: number[];
    weeks: {
      week: number; start: string; end: string; sittingDays: number;
      into: Record<"3" | "4" | "5", number>;       // cases crossing into the band that week
      out: Record<"3" | "4" | "5", Interval>;      // cases in the band disposed that week (simulated)
      net: Record<"3" | "4" | "5", Interval>;      // into minus out
      pending4Plus: Interval;                      // 4+ year cases pending at the end of the week
    }[];
    byStage: { stage: SequentialType; label: string; start: number; end: Interval; change: Interval }[];
  };
  processDesk: {
    total: number;
    byKind: { kind: ProcessKind; label: string; out: number; ageDays: Record<"0-14" | "15-30" | "31-60" | "61+", number>; oldestDays: number }[];
    cases: { caseId: string; kind: ProcessKind; label: string; issuedOn: string | null; daysOut: number | null;
             ageYears: number; advocateId: string; nextDate: string | null; action: "await_return" | "reissue" }[];
  };
}
```

Example: `fixtures/health.json`.

## GET /api/evidence

The experiment outputs (held-out test seeds 31 to 60), computed once by `src/eval` and served as stored.

```ts
{
  generatedAt: string; rosterId: string;
  seeds: { tuning: [1, 20]; validation: [21, 30]; test: [31, 60] };
  baseline: "status_quo_60"; recommended: "zoo";
  arena: { rows: { policyId: string; policyName: string; kind: string; summary: Summary; vsBaseline: Summary }[] };  // every policy, vsBaseline = policy minus baseline, paired
  ablation: {
    measures: string[];                               // measure ids reported
    base: { policyId: "benchtime"; values: Record<string, Interval> };
    statusQuo: { policyId: "status_quo_60"; values: Record<string, Interval> };
    rows: { component: string; label: string;
            removed: Record<string, Interval>;        // benchtime without the component minus benchtime
            added: Record<string, Interval> }[];      // status quo with the component minus status quo
  };
  sensitivity: {
    measure: string;                                  // the headline measure, e.g. "extra.substantivePerDay"
    compared: { a: string; b: string };               // the paired difference b minus a is what is reported
    rows: { assumption: string; label: string; unit: string; low: number; base: number; high: number;
            atLow: Interval; atBase: Interval; atHigh: Interval }[];
  };
  robustness: {
    measure: string; baseline: string;
    scenarios: { id: string; label: string; description: string }[];
    policies: string[];
    cells: { policyId: string; scenarioId: string; value: Interval; vsBaseline: Interval }[];
  };
  exactVsGreedy: {
    days: number; valueUnit: string;
    meanGap: Interval;                                // (exact - greedy) / exact, per day
    maxGap: number; daysExactBetter: number;
    effect: Record<string, Interval>;                 // on measures: exact minus greedy
    byDay: { date: string; exact: number; greedy: number; gap: number }[];
    note: string;
  };
  calibration: {
    follows: string;
    rows: { type: HearingType; label: string; source: "real" | "estimated"; pucarNonSubstantive: number;
            pucar: { pSubstantive: number; failureShare: Record<FailureReason, number> };
            simulated: { pSubstantive: Interval; failureShare: Record<FailureReason, number> };
            error: number }[];                        // simulated mean minus PUCAR
    pooled: { pucar: Record<FailureReason, number>; simulated: Record<FailureReason, number> };
    conflicts: string[];
  };
  fillCurve: {                                        // benchtime with only fillTarget varied
    policy: "benchtime"; recommendedFill: number;
    levels: { fill: number; reachRate: Interval; heldAsScheduled: Interval; overrunDays: Interval; utilisation: Interval;
              substantivePerDay: Interval; idleMinutesShare: Interval; wastedTripShare: Interval }[];   // fill 0.60 to 1.50 in steps of 0.05
  };
}
```

Example: `fixtures/evidence.json`. Until every study has been run, the engine may return a section as `null` (or with no rows). `web/serve.ts` then fills only those sections from the fixture, lists them in `sampleSections: string[]`, and marks the response as sample; the Evidence screen says which sections are sample results.

## GET /api/case/:id?date=

One case in full: `CaseDetail` plus

```ts
{
  hearingCounts: Record<HearingType, number>;
  history: { date: string; type: HearingType; outcome: Outcome; reason: FailureReason | null; minutes: number;
             attendance: Record<Role, boolean> | null; recordedBy: "roster" | "court" }[];   // oldest first
  nextDateRecommendation: { date: string; reason: string } | null;
}
```

404 with `{ error: "no such case" }` for an unknown id. Example: `fixtures/case.json`.

## The judge's saved rules (GET /api/rules/presets, POST /api/rules/preview)

`config` everywhere (`/api/plan`, `/api/simulate`, `/api/compare`, the preview) also takes the judge's saved rules,
all optional; each is cleaned like the rest of `config` (malformed values dropped, numbers clamped) and honoured by
the `zoo` planner on top of whatever genome it runs (`src/planner/zoo/rules.ts`):

```ts
{
  blocks?: { id; start; end; types: HearingType[] | "all"; oldestFirst?: true; newestFirst?: true }[];
  blocksByWeekday?: { [weekday 0-6]: Block[] };  // weekday themes: "evidence on Mondays"
  maxListed?: number;          // 1-500 matters a day, standby included
  halfDays?: string[];         // 210-minute sittings (ISO dates)
  halfDayWeekdays?: number[];  // e.g. [5]: Friday afternoons kept for judgments
  leaveDays?: string[];        // nothing listed, no date given
  priorityTypes?: HearingType[]; // selected and called first (bail, warrants)
  minNoticeDays?: number;      // 0-90: no next date sooner
  maxGapDays?: number;         // 1-365: no next date later
  maxPerAdvocate?: number;     // 1-200 matters of one advocate a day
  groupByAdvocate?: boolean;   // an advocate's matters called one after another
  carriedFirst?: boolean;      // matters carried from an earlier list are taken first
}
```

`processDesk`, `checkin`, `clusterByAdvocate`, `weights` and `smartNextDate` override the genome's own choice when
they differ from it. `ageingFloor` never goes below 0.15.

`GET /api/rules/presets` returns `{ policy: "zoo", presets: { id: "sehgal_way" | "dimakar_way" | "joshi_way"; name;
description; config: Partial<JudgeConfig> }[] }` (also in `/api/meta` as `rulePresets`, with the full merged config).

`POST /api/rules/preview` with `{ preset?, config?, baseConfig?, policy? = "zoo", date?, seeds?, weeks?, quick? }`
returns the rules' effect: `config` (effective), `problems` (unknown rules, a floor below 15%, notice longer than
the gap, ...), `plan: { without, with, listings, keepsEveryRule, violations }` for the date (moved to the next
working day), and `scorecards: { without, with, diff }` (`diff` = with minus without, paired on shared seeds; quick
seeds unless `quick: false`).

## What the console stores

Nothing on the server. The judge's rules (`JudgeConfig`) and tomorrow's pins and drops live in the browser
(`localStorage` keys `benchtime.rules` and `benchtime.overrides`) and are sent with each request. A future
`GET/PUT /api/rules` (INTEGRATION.md, section 4) can replace that without changing these shapes.
