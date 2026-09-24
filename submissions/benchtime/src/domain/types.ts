// The contract between the data layer, the world, the planners and the evaluation. See DESIGN.md.
// Planners (src/planner) may import this file, src/domain/* and src/data/*; never src/world/*.

export const SEQUENCE = [
  "ADMISSION",
  "DELAY_CONDONATION_HEARING",
  "COGNIZANCE",
  "APPEARANCE",
  "WARRANT",
  "PLEA",
  "EXAMINATION_UNDER_S351_BNSS",
  "EVIDENCE_COMPLAINANT",
  "EVIDENCE_ACCUSED",
  "ARGUMENTS",
  "JUDGEMENT",
] as const;
export const INTERRUPTING = ["BAIL", "REPORTS", "APPLICATION_REVIEW"] as const;
export type SequentialType = (typeof SEQUENCE)[number];
export type InterruptingType = (typeof INTERRUPTING)[number];
export type HearingType = SequentialType | InterruptingType;
export const HEARING_TYPES: HearingType[] = [...SEQUENCE, ...INTERRUPTING];

export const FAILURE_REASONS = [
  "court_admin",
  "court_holiday",
  "respondent_absent", // the accused (respondent) absent or not complying
  "petitioner_absent", // the complainant (petitioner) absent or not complying
  "sought_time",
  "not_ready", // evidence or filing not ready
  "awaiting_process", // summons, notice or warrant not returned
  "external_dependency", // mostly a mediation report not back
  "both_absent",
  "unclear",
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

// ---------------------------------------------------------------------------------------------
// Reference tables (PUCAR's CSVs, parsed)

export interface HearingTypeRef {
  type: HearingType;
  label: string;
  /** PUCAR's estimated minutes when the hearing happens */
  durationMin: number;
  /** PUCAR's "time to next hearing given this is the purpose" (calendar days) */
  gapDays: number;
  hearingsPerCase: { min: number; max: number; mean: number; median: number };
  /** P(substantive), 0..1 */
  pSubstantive: number;
  pSubstantiveSource: "real" | "estimated";
  /** among non-substantive hearings: share by reason, sums to 1 */
  failureShare: Record<FailureReason, number>;
  failureCount: number;
  failureSource: "real" | "estimated";
}
export type RefTables = Record<HearingType, HearingTypeRef>;

export interface CourtCalendar {
  /** ISO dates that are working days */
  workingDays: Set<string>;
  holidays: Map<string, string>;
  /** the judge's personal leave (config), removed from working days */
  judgeLeave: Set<string>;
  first: string;
  last: string;
}

// ---------------------------------------------------------------------------------------------
// The roster (input, immutable)

export type Role = "complainant" | "complainantAdvocate" | "accused" | "accusedAdvocate";

export type ProcessKind = "summons" | "notice" | "warrant_bailable" | "warrant_nonbailable" | "warrant";
export interface ProcessState {
  kind: ProcessKind;
  /** issued and not yet returned, or served/returned */
  status: "issued" | "returned" | "served";
  /** ISO date issued, when known (the last hearing date is not in the roster, so often null) */
  issuedOn: string | null;
}

export interface ParsedSummary {
  raw: string;
  /** who the court recorded as present / absent at the last hearing (null = not recorded) */
  attendance: Record<Role, boolean | null>;
  /** free-text lines other than Present/Absent */
  notes: string[];
  process: ProcessState | null;
  lastChance: boolean;
  mediation: boolean;
  forJudgment: boolean;
  judgmentPronounced: "convicted" | "acquitted" | null;
  witnessToAttend: boolean;
  accusedToAppear: boolean;
  complainantToAppear: boolean;
  objectionsPending: boolean;
  /** anything the parser recognised, as short tags, for explanations */
  tags: string[];
}

export interface CaseRecord {
  caseNumber: string;
  filingNumber: string;
  filingDate: string;
  advocateId: string;
  partyId: string;
  currentStage: HearingType;
  nextPurpose: HearingType;
  hearingCounts: Record<HearingType, number>;
  totalHearings: number;
  summary: ParsedSummary;
}

// ---------------------------------------------------------------------------------------------
// What a planner may see (rule 1)

export type Outcome =
  | "substantive" // moved to the next purpose
  | "failed" // called, did not move the case (reason recorded)
  | "not_reached" // listed, court ran out of time
  | "vacated" // released the day before at check-in, never called
  | "desk" // handled at the desk (process not back): no bench time
  | "deferred" // was due (promised) today, the policy did not list it: a broken promise, not a hearing
  | "court_not_sitting";

export interface ObservedHearing {
  date: string;
  type: HearingType;
  outcome: Outcome;
  /** the reason the court recorded for a failed hearing */
  reason: FailureReason | null;
  minutes: number;
  /** attendance as recorded when the case was called (null when not called) */
  attendance: Record<Role, boolean> | null;
}

export interface CaseView {
  id: string; // case number (filing number when the case number is blank)
  filingNumber: string;
  filingDate: string;
  advocateId: string;
  partyId: string;
  /** the underlying sequential stage */
  stage: SequentialType;
  /** what the next hearing is for (may be an interrupting type) */
  nextPurpose: HearingType;
  hearingCounts: Record<HearingType, number>;
  /** hearings already held at the current purpose (roster count + observed) */
  hearingsAtPurpose: number;
  lastSummary: ParsedSummary;
  history: readonly ObservedHearing[];
  /** process the court knows is out; returnedKnownOn is set from the day after it returns. issuedOn is null
   * for process issued before the horizon (the roster does not date it) */
  process: {
    kind: ProcessKind;
    issuedOn: string | null;
    returnedKnownOn: string | null;
    /** service rounds of this kind the court has sent out in the case (1 = the first attempt; a desk re-issue adds one) */
    round?: number;
  } | null;
  /** mediation report expected; readyKnownOn set once the court is told. since is null for a report ordered
   * before the horizon */
  externalPending: { since: string | null; readyKnownOn: string | null } | null;
  /** the date this case is currently promised (its next date), if any */
  nextDate: string | null;
  firstScheduledOn: string | null;
  firstHeardOn: string | null;
  disposed: boolean;
  disposedOn: string | null;
}

export type CheckinAnswer = "ready" | "not_ready" | "silent";

export interface JudgeConfig {
  /** weights over measures for the value function (normalised internally) */
  weights: { throughput: number; substantiveness: number; fairness: number; predictability: number; trips: number };
  /** expected minutes to fill, as a share of 420 (overbooking appetite) */
  fillTarget: number;
  /** share of minutes offered first to cases 4+ years old; floor 0.15, cannot be lowered */
  ageingFloor: number;
  clusterByAdvocate: boolean;
  /** optional blocks: hearing types allowed per block (Sehgal's fresh-morning / old-afternoon) */
  blocks: { id: string; start: string; end: string; types: HearingType[] | "all"; oldestFirst?: boolean }[];
  /** Sehgal: an unheard case returns the same weekday next week */
  carryForward: boolean;
  processDesk: boolean;
  checkin: boolean;
  standbyShare: number;
  smartNextDate: boolean;
}

export interface PlanContext {
  date: string;
  capacityMinutes: number;
  cases: readonly CaseView[];
  ref: RefTables;
  calendar: CourtCalendar;
  /** day-before answers (only for policies that ask) */
  checkins: ReadonlyMap<string, { complainant: CheckinAnswer; accused: CheckinAnswer }>;
  config: JudgeConfig;
}

export interface Listing {
  caseId: string;
  type: HearingType;
  /** call order within the day, 0-based */
  order: number;
  /** HH:MM, when the policy gives times */
  callTime: string | null;
  window: string | null;
  standby: boolean;
  expectedMinutes: number;
  pSubstantive: number;
  why: string[];
}

export interface DeskAction {
  caseId: string;
  action: "await_return" | "reissue" | "await_report";
  note: string;
}

export interface DayPlan {
  date: string;
  listings: Listing[];
  desk: DeskAction[];
  /** due cases the policy chose not to call today, with the new date it promises (every due case must be listed, on the desk, or here) */
  deferred: { caseId: string; to: string; reason: string }[];
  /** the policy's own expectation, for the console */
  expected: { minutes: number; substantive: number; overrunRisk: number };
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  /** which cases to call today, in what order */
  plan(ctx: PlanContext): DayPlan;
  /** after a hearing, the promised next date for the case (ISO, a working day after `date`) */
  nextDate(ctx: PlanContext, c: CaseView, outcome: Outcome, date: string): string;
  /** the first date for every case at the start of the horizon */
  initialDates(ctx: PlanContext): Map<string, string>;
  /** whether the policy runs a day-before check-in */
  asksCheckin: boolean;
}

// ---------------------------------------------------------------------------------------------
// Results

/** How a case left the active file (logged on the disposing row). */
export type DisposalRoute =
  | "verdict" // judgment pronounced
  | "settlement" // a mediation report came back settled
  | "compounded" // compounded under s.147 NI Act at a hearing
  | "acquitted_default" // accused acquitted for the complainant's default (s.279 BNSS)
  | "dismissed_steps" // complaint dismissed because the complainant took no steps
  | "lp_split" // split up to the long-pending register (absconding accused)
  | "post_judgment"; // the last post-judgment matter was heard

export interface HearingLog extends ObservedHearing {
  caseId: string;
  listedOrder: number;
  standby: boolean;
  /** promised date for this hearing (was it held on it?) */
  promised: string | null;
  /** true on the row whose hearing disposed of the case (judgment, settlement, post-judgment matter). The
   * evaluation needs it to count disposals that the log cannot otherwise show (a REPORTS settlement). */
  disposed?: boolean;
  /** the next date the policy promised at the end of this row (null when disposed); lets the evaluation
   * score next dates that fall beyond the horizon */
  nextDate?: string | null;
  /** on a disposing row: how the case left the file */
  disposalRoute?: DisposalRoute;
  /** a substantive row that moved on because of this event (an absence after service moving APPEARANCE to
   * WARRANT, a default acquittal, a split-up); the court's recorded reason stays null */
  movedBy?: FailureReason;
  /** minute of the day (0 = start of the sitting) a reached hearing started */
  startMinute?: number;
  /** the call time the listing carried, if any */
  callTime?: string | null;
}

export interface Scorecards {
  readme: { utilisation: number; reachRate: number; substantiveness: number; backlog4yHeardShare: number; backlog4ySubstantiveShare: number; predictabilityGapDays: number };
  caseStudy: {
    utilisation: number;
    overrunDays: number;
    idleMinutesShare: number;
    heldAsScheduled: number;
    heldAsScheduledAllDue: number;
    substantiveness: number;
    ageBandsStart: Record<string, number>;
    ageBandsEnd: Record<string, number>;
    nextDateExcessDays: number;
    wastedRelistShare: number;
  };
  siddarth: {
    throughputPerMonth: number;
    judgeTimeUsed: number;
    wastedListings: number;
    heldOnPromisedDate: number;
    oldestPendingAgeYears: number;
    p95PendingAgeYears: number;
    neverHeard: number;
    loadBalanceCv: number;
  };
  extra: {
    listedPerDay: number;
    reachedPerDay: number;
    substantivePerDay: number;
    disposed: number;
    disposed4yPlus: number;
    tripsPerSubstantive: number;
    wastedTripShare: number;
    deskPerDay: number;
    vacatedPerDay: number;
    /** alternative readings of ambiguous definitions and further measures (see src/eval/metrics.ts) */
    [key: string]: number;
  };
}

export interface RunResult {
  policyId: string;
  worldSeed: number;
  rosterId: string;
  scorecards: Scorecards;
  hearings: HearingLog[];
  days: { date: string; minutesUsed: number; listed: number; reached: number; substantive: number; desk: number; vacated: number; overran: boolean }[];
}
