// The simulator's public surface. The evaluation (src/eval) and the CLI import from here and from
// ./simulate; planners never import anything under src/world (rule 1 in DESIGN.md).

import type { BranchProbs } from "../domain/lifecycle";
import type { CaseRecord, CourtCalendar, JudgeConfig, Policy, RefTables, Role, RunResult } from "../domain/types";

/** The world's remaining latent settings (assumptions, documented in world.ts). Optional in WorldParams; missing values take world.ts defaults. */
export interface WorldLatent {
  /** mean calendar days from issue to return, per process family (lognormal) */
  processMeanDays: { summons: number; notice: number; warrant: number };
  processCv: number;
  /** mean calendar days until an external report (mostly mediation) is ready (lognormal) */
  externalMeanDays: number;
  externalCv: number;
  /** prior mean attendance per role before the roster's Present/Absent record is folded in */
  attendancePrior: Record<Role, number>;
  /** Beta concentration of the prior (lower = more heterogeneous actors) */
  attendanceKappa: number;
  /** weight of the roster's one recorded Present/Absent observation */
  attendanceObsWeight: number;
  /** probability a side answers the day-before check-in at all */
  checkinResponse: number;
  /** relative cut in not-ready and seeks-time rates at the hearing a "last chance" order was made for */
  lastChanceCut: number;
  /** probability the accused is present once a warrant has been executed (produced before the court) */
  producedPresence: number;
  /** extra days between a process coming back and the court being told (hidden; default 0: told the working day after) */
  returnReportDelayDays: number;
  /** probability a side that would have gone ahead still answers "not ready" at the check-in (a false alarm) */
  checkinFalseAlarm: number;
  /** share of a side's day-of failures (absence, not ready, time sought) it cannot foresee the day before */
  checkinUnforeseen: number;
  /** service rounds per process family the complainant prepaid at filing (DRISTI handover 19.3): these start at once */
  prepaidRounds: { summons: number; notice: number; warrant: number };
  /** days to pay for a round beyond the prepaid ones before the attempt starts */
  unpaidRoundDelayDays: number;
}

/**
 * Disposal routes besides the verdict and a mediation settlement (assumptions, named and switchable: set a
 * probability to 0 to switch its route off). See world.ts for when each applies.
 */
export interface DisposalParams {
  /** P(acquittal for the complainant's default, s.279 BNSS) at a hearing the complainant misses again, for a case
   * whose summary records repeated absence or a last-chance order */
  acquittalOnDefault: number;
  /** P(dismissal because steps were not taken) at a pre-trial hearing that fails on the complainant's side, for a
   * case whose summary orders steps */
  dismissalForSteps: number;
  /** per called hearing with both parties present: P(the offence is compounded under s.147 NI Act) */
  compoundingHazard: number;
  /** P(split-up to the long-pending register) at a WARRANT hearing whose warrant is still unexecuted for an
   * absconding accused, once the case has had lpAfterWarrantHearings warrant hearings */
  lpSplit: number;
  lpAfterWarrantHearings: number;
}

/** Every latent parameter of the simulated court. Defaults come from calibration to PUCAR's tables. */
export interface WorldParams {
  /** minutes a called-but-failed hearing takes */
  callMinutes: number;
  /** coefficient of variation of hearing duration (lognormal around PUCAR's estimate) */
  durationCv: number;
  /** probability an announced working day is lost (court did not sit) */
  closureProb: number;
  /** per hearing type: calibrated latent parameters (attendance, process, readiness, residual), filled by calibration */
  perType: Record<string, Record<string, number>>;
  /** behaviour responses (assumptions; noBehaviour sets the lifts, honesty and fatigue to 0 and the standby multiplier to 1) */
  behaviour: { slotAttendLift: number; reminderAttendLift: number; checkinHonesty: number; standbyAttendMult: number; fatiguePerWastedTrip: number };
  /** share of warrants at the WARRANT stage never executed inside the horizon (absconding accused) */
  abscondShare: number;
  /** probability a substantive mediation report ends the case in settlement */
  settleOnReport: number;
  /** the world's other latent settings; world.ts fills any that are missing */
  latent?: WorldLatent;
  /** lifecycle branch probabilities; estimated from the simulated roster when absent (interrupting hazards) */
  branch?: BranchProbs;
  /** assumption: P(a case past admission needs a delay condonation hearing); overrides branch.pDelayCondonation.
   * PUCAR's hearing counts cannot identify it (the generator puts hearings at every stage) */
  pDelayCondonation?: number;
  /** assumption: P(the court issues a warrant when the accused stays away from APPEARANCE after service); overrides
   * branch.pWarrant. Not identified by PUCAR's counts either */
  pWarrantOnAbsence?: number;
  /** disposal routes other than the verdict and settlement; world.ts defaults fill any that are missing */
  disposal?: DisposalParams;
  /** anything else the world needs; documented in world.ts */
  [key: string]: unknown;
}

export interface SimulateOptions {
  records: readonly CaseRecord[];
  rosterId: string;
  policy: Policy;
  config: JudgeConfig;
  /** the tables the world is calibrated to (truth) */
  ref: RefTables;
  /** the tables the planner is shown; defaults to `ref`. Robustness studies pass a perturbed copy. */
  plannerRef?: RefTables;
  calendar: CourtCalendar;
  worldSeed: number;
  start: string;
  end: string;
  params: WorldParams;
  capacityMinutes?: number; // default 420
  noBehaviour?: boolean;
  /** compute the scorecards (default true); calibration turns it off for speed and gets zeroed cards */
  scorecards?: boolean;
}

export type Simulate = (opts: SimulateOptions) => RunResult;
