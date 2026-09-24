// The Section 138 summary-trial lifecycle (case study, data guide section 1): 11 sequential stages, two of
// them optional, and three interrupting hearing types that return the case to its underlying stage.
// Pure functions only: the world supplies the stateless draws (src/domain/hash.ts) and applies them.

import {
  INTERRUPTING,
  SEQUENCE,
  type CaseRecord,
  type DisposalRoute,
  type FailureReason,
  type HearingType,
  type InterruptingType,
  type ProcessKind,
  type ProcessState,
  type Role,
  type SequentialType,
} from "./types";

/** Position in the fixed sequence (0 = ADMISSION ... 10 = JUDGEMENT); -1 for an interrupting type. */
export function stageIndex(t: HearingType): number {
  return (SEQUENCE as readonly string[]).indexOf(t);
}

export function isSequential(t: HearingType): t is SequentialType {
  return stageIndex(t) >= 0;
}

const EVIDENCE_START = stageIndex("EVIDENCE_COMPLAINANT");

// Who must attend for a hearing of each type to proceed. Each line cites the case study's description
// of the stage; the sample's Present/Absent records are consistent with it (for example the admission
// hearings in the sample went ahead with only the complainant's advocate present).
const REQUIRED: Record<HearingType, Role[]> = {
  // "The court examines the complaint (affidavit under s.225 BNSS) ... decides if there is sufficient
  // ground": the complainant's own filing, presented by the complainant's advocate
  ADMISSION: ["complainantAdvocate"],
  // "the court hears the accused's objections and decides whether to excuse the delay": the delay is
  // the complainant's to explain; once notice is served the accused's objections can be heard or closed
  DELAY_CONDONATION_HEARING: ["complainantAdvocate"],
  // "The court formally takes cognizance ... satisfied there's sufficient ground": complainant side only
  COGNIZANCE: ["complainantAdvocate"],
  // "the court tracks whether the accused has appeared": the hearing's whole point is the accused
  APPEARANCE: ["accused"],
  // "a warrant ... to compel appearance": proceeds when the accused is produced or appears
  WARRANT: ["accused"],
  // "the particulars of the offence are read out and explained, and the accused pleads": in person
  PLEA: ["accused"],
  // "The court examines the accused directly": in person
  EXAMINATION_UNDER_S351_BNSS: ["accused"],
  // "examination-in-chief and cross-examination": the complainant is the witness (chief is by proof
  // affidavit under s.145 NI Act), and the accused's advocate must be there to cross-examine
  EVIDENCE_COMPLAINANT: ["complainant", "accusedAdvocate"],
  // "The defence presents its evidence in the same way": the accused as DW1, led by the accused's
  // advocate (no affidavit shortcut for the defence), cross-examined by the complainant's advocate
  EVIDENCE_ACCUSED: ["accused", "accusedAdvocate", "complainantAdvocate"],
  // "both sides make their final oral arguments"
  ARGUMENTS: ["complainantAdvocate", "accusedAdvocate"],
  // "The court pronounces its verdict ... and, on conviction, sentence": the accused must be present
  // for pronouncement (the sample's "Accused shall be present. For judgment.")
  JUDGEMENT: ["accused"],
  // "The accused's application to be released on bail": argued by the accused's advocate
  BAIL: ["accusedAdvocate"],
  // "Progress updates, most commonly mediation referrals reporting back": the parties themselves
  // confirm a settlement or its failure
  REPORTS: ["complainant", "accused"],
  // "Miscellaneous/interlocutory applications filed by either party: objections, extensions,
  // procedural requests": argued by the advocates of both sides
  APPLICATION_REVIEW: ["complainantAdvocate", "accusedAdvocate"],
};

/** Who must attend for a hearing of this type to proceed (a fresh copy). */
export function requiredRoles(type: HearingType): Role[] {
  return [...REQUIRED[type]];
}

// ---------------------------------------------------------------------------------------------
// Branch probabilities, estimated from the roster's hearing counts

/** A proportion with the counts behind it, so reports can show the evidence. */
export interface Estimate {
  p: number;
  k: number;
  n: number;
}

export interface BranchProbs {
  /** P(delay condonation hearing needed | the case got past admission) */
  pDelayCondonation: number;
  /** P(the court issues a warrant | the accused stayed away from an APPEARANCE hearing after service); otherwise
   * the accused gets another chance. WARRANT is entered only this way (onFailure), never by a substantive hearing */
  pWarrant: number;
  /** per sequential stage: P(an interrupting hearing of each type is inserted on entering the stage) */
  interruptHazard: Record<SequentialType, Record<InterruptingType, number>>;
  /** P(a post-judgment application or report | judgment) */
  pPostJudgment: number;
  /** among post-judgment matters, the share that are each interrupting type (sums to 1) */
  postJudgmentMix: Record<InterruptingType, number>;
  /** the counts behind every estimate (raw k / n; p is smoothed) */
  evidence: {
    delayCondonation: Estimate;
    warrant: Estimate;
    interrupt: Record<InterruptingType, Estimate>;
    postJudgment: Estimate;
  };
}

// Jeffreys smoothing: the sample puts a delay condonation and a warrant in almost every case, and an
// exact 0 or 1 would make a branch impossible in the simulated court.
const jeffreys = (k: number, n: number): number => (k + 0.5) / (n + 1);

/**
 * Estimate the branch probabilities from a roster (PUCAR's 100-case sample or a generated one).
 * The roster has per-type hearing counts but no dates, so:
 * - a case "got past" a stage when its underlying stage (next purpose if sequential, else current stage)
 *   is later; it "needed" an optional stage when it had hearings there or is there now;
 * - an interrupting episode is a case with hearings of that type, or a next purpose of that type not yet
 *   heard; its stage is unknown, so the hazard is pooled over the stage visits where the type can occur
 *   (BAIL only before trial: "once the case reaches Evidence Complainant ... it can't recur");
 * - post-judgment: among cases whose current stage is JUDGEMENT (judgment hearings held), the share whose
 *   next purpose is an interrupting type. Those episodes are counted there, not in the stage hazard.
 */
export function estimateBranchProbs(records: readonly CaseRecord[]): BranchProbs {
  const DCH = stageIndex("DELAY_CONDONATION_HEARING");
  const WAR = stageIndex("WARRANT");
  const JUD = stageIndex("JUDGEMENT");
  let dchK = 0;
  let dchN = 0;
  let warK = 0;
  let warN = 0;
  let pjK = 0;
  let pjN = 0;
  const pjMix: Record<InterruptingType, number> = { BAIL: 0, REPORTS: 0, APPLICATION_REVIEW: 0 };
  const episodes: Record<InterruptingType, number> = { BAIL: 0, REPORTS: 0, APPLICATION_REVIEW: 0 };
  const exposure: Record<InterruptingType, number> = { BAIL: 0, REPORTS: 0, APPLICATION_REVIEW: 0 };

  for (const r of records) {
    const cur = stageIndex(r.currentStage);
    const underlying = isSequential(r.nextPurpose) ? stageIndex(r.nextPurpose) : cur;
    if (underlying < 0) continue; // no sequential anchor: nothing to learn from
    const at = (t: SequentialType) => (r.hearingCounts[t] ?? 0) > 0 || cur === stageIndex(t) || r.nextPurpose === t;

    if (underlying >= DCH) {
      // past admission: at delay condonation now, or beyond it
      dchN++;
      if (at("DELAY_CONDONATION_HEARING")) dchK++;
    }
    if (underlying >= WAR) {
      warN++;
      if (at("WARRANT")) warK++;
    }

    // stage visits so far (the stage the case is at counts as visited)
    const visits = underlying + 1;
    const preTrialVisits = Math.min(visits, EVIDENCE_START);
    const postJudgmentPending = cur === JUD && !isSequential(r.nextPurpose);
    for (const t of INTERRUPTING) {
      exposure[t] += t === "BAIL" ? preTrialVisits : visits;
      const heard = (r.hearingCounts[t] ?? 0) > 0;
      const pending = r.nextPurpose === t && !heard && !postJudgmentPending;
      if (heard || pending) episodes[t]++;
    }

    if (cur === JUD) {
      pjN++;
      if (!isSequential(r.nextPurpose)) {
        pjK++;
        pjMix[r.nextPurpose]++;
      }
    }
  }

  const rate: Record<InterruptingType, Estimate> = {
    BAIL: { k: episodes.BAIL, n: exposure.BAIL, p: jeffreys(episodes.BAIL, exposure.BAIL) },
    REPORTS: { k: episodes.REPORTS, n: exposure.REPORTS, p: jeffreys(episodes.REPORTS, exposure.REPORTS) },
    APPLICATION_REVIEW: {
      k: episodes.APPLICATION_REVIEW,
      n: exposure.APPLICATION_REVIEW,
      p: jeffreys(episodes.APPLICATION_REVIEW, exposure.APPLICATION_REVIEW),
    },
  };
  const interruptHazard = {} as Record<SequentialType, Record<InterruptingType, number>>;
  for (const s of SEQUENCE) {
    const i = stageIndex(s);
    interruptHazard[s] = {
      BAIL: i < EVIDENCE_START ? rate.BAIL.p : 0,
      REPORTS: rate.REPORTS.p,
      APPLICATION_REVIEW: rate.APPLICATION_REVIEW.p,
    };
  }
  const mixTotal = pjMix.BAIL + pjMix.REPORTS + pjMix.APPLICATION_REVIEW;
  const postJudgmentMix: Record<InterruptingType, number> =
    mixTotal > 0
      ? { BAIL: pjMix.BAIL / mixTotal, REPORTS: pjMix.REPORTS / mixTotal, APPLICATION_REVIEW: pjMix.APPLICATION_REVIEW / mixTotal }
      : { BAIL: 0, REPORTS: 0.5, APPLICATION_REVIEW: 0.5 };

  return {
    pDelayCondonation: jeffreys(dchK, dchN),
    pWarrant: jeffreys(warK, warN),
    interruptHazard,
    pPostJudgment: jeffreys(pjK, pjN),
    postJudgmentMix,
    evidence: {
      delayCondonation: { k: dchK, n: dchN, p: jeffreys(dchK, dchN) },
      warrant: { k: warK, n: warN, p: jeffreys(warK, warN) },
      interrupt: rate,
      postJudgment: { k: pjK, n: pjN, p: jeffreys(pjK, pjN) },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Transitions

export interface LifecycleState {
  stage: SequentialType;
  nextPurpose: HearingType;
  /** the verdict is already pronounced: the remaining matter is heard once more, then the case is disposed */
  postJudgment?: boolean;
}

export interface TransitionResult {
  stage: SequentialType;
  nextPurpose: HearingType;
  disposed: boolean;
  /** process the court issues with this order (the world gives it a latent return day) */
  issues: ProcessKind | null;
  /** how the case left the file, when disposed */
  route?: DisposalRoute;
}

// The sample's orders at appearance are "Issue NBW to accused"; the world may map kinds to return delays.
const WARRANT_KIND: ProcessKind = "warrant_nonbailable";

/** What the court issues on moving a case into a stage by a substantive hearing (a warrant comes only from onFailure). */
function issuedOnEntering(stage: SequentialType): ProcessKind | null {
  if (stage === "DELAY_CONDONATION_HEARING") return "notice"; // "Issue DCA notice to accused"
  if (stage === "APPEARANCE") return "summons"; // "Summons are issued" after cognizance
  return null;
}

/**
 * Apply a SUBSTANTIVE hearing held for `state.nextPurpose`. `u` supplies stateless draws in [0,1):
 * u[0] decides the optional delay condonation stage after admission, u[1] decides whether an interrupting
 * hearing is inserted before the new stage (one draw, partitioned by the stage's hazards), u[2] decides
 * whether a mediation report ends in settlement. Missing draws count as 0.5 for u[0] and u[2] and as 1 (no
 * interruption) for u[1]. A substantive APPEARANCE means the accused appeared: the case goes to PLEA. WARRANT
 * is optional and entered only through onFailure, when the accused stays away after service.
 */
export function transition(state: LifecycleState, u: readonly number[], probs: BranchProbs, settleOnReport: number): TransitionResult {
  const { stage, nextPurpose } = state;
  const uOptional = u[0] ?? 0.5;
  const uInterrupt = u[1] ?? 1;
  const uSettle = u[2] ?? 0.5;

  // A post-judgment matter (application or report after the verdict) is the case's last hearing here
  if (state.postJudgment) return { stage, nextPurpose, disposed: true, issues: null, route: "post_judgment" };

  if (!isSequential(nextPurpose)) {
    // A mediation report that comes back substantive can end the case in settlement ("the parties can
    // also withdraw the case if they reach a settlement ... through alternate dispute resolution")
    if (nextPurpose === "REPORTS" && uSettle < settleOnReport) return { stage, nextPurpose, disposed: true, issues: null, route: "settlement" };
    // Otherwise every interrupting type returns the case to its underlying stage
    return { stage, nextPurpose: stage, disposed: false, issues: null };
  }

  // The verdict disposes the case
  if (nextPurpose === "JUDGEMENT") return { stage: "JUDGEMENT", nextPurpose: "JUDGEMENT", disposed: true, issues: null, route: "verdict" };

  let i = stageIndex(nextPurpose) + 1;
  let next = SEQUENCE[i]!;
  if (next === "DELAY_CONDONATION_HEARING" && uOptional >= probs.pDelayCondonation) next = SEQUENCE[++i]!;
  // the accused appeared (at APPEARANCE) or was produced (at WARRANT): on to the plea
  if (next === "WARRANT") next = SEQUENCE[++i]!;
  const issues = issuedOnEntering(next);

  // An interrupting hearing may come in before the new stage is heard; the stage still advances
  const h = probs.interruptHazard[next];
  let acc = 0;
  for (const t of INTERRUPTING) {
    acc += h[t];
    if (uInterrupt < acc) return { stage: next, nextPurpose: t, disposed: false, issues };
  }
  return { stage: next, nextPurpose: next, disposed: false, issues };
}

/**
 * The failure paths that change purpose or issue process. APPEARANCE failed because the accused stayed
 * away after the summons was served: with probability `pWarrant` (draw `uWarrant`) the court issues a
 * warrant and the case moves to WARRANT ("If the accused still doesn't appear despite summons, the court
 * issues a warrant"); otherwise the accused gets another chance at APPEARANCE. WARRANT failed with the
 * accused still absent once the last warrant came back: a fresh warrant issues. JUDGEMENT with the accused
 * absent: a non-bailable warrant issues so the accused is produced for pronouncement (never on entry). A
 * failure while process is still out, or for any other reason, keeps the purpose and issues nothing. The
 * world counts a failure that changes the purpose as substantive (it moved to the next purpose).
 */
export function onFailure(
  state: LifecycleState & { process?: ProcessState | null },
  reason: FailureReason,
  attendance: Readonly<Record<Role, boolean>> | null,
  branch: { uWarrant?: number; pWarrant?: number } = {},
): { nextPurpose: HearingType; issues: ProcessKind | null } {
  const keep = { nextPurpose: state.nextPurpose, issues: null };
  const accusedAway = reason === "respondent_absent" || reason === "both_absent" || (attendance !== null && attendance.accused === false && reason !== "awaiting_process");
  if (!accusedAway || reason === "court_admin" || reason === "court_holiday") return keep;
  // Process still out and not reported back: the absence proves nothing yet
  if (state.process && state.process.status === "issued") return keep;
  if (state.nextPurpose === "APPEARANCE") {
    if ((branch.uWarrant ?? 0) < (branch.pWarrant ?? 1)) return { nextPurpose: "WARRANT", issues: WARRANT_KIND };
    return keep;
  }
  if (state.nextPurpose === "WARRANT" || state.nextPurpose === "JUDGEMENT") return { nextPurpose: state.nextPurpose, issues: WARRANT_KIND };
  return keep;
}

/**
 * The lifecycle state a roster record starts the horizon in. The underlying stage is the next purpose
 * when that is sequential (a case at APPEARANCE whose next hearing is for WARRANT has moved on), else
 * the current stage. A case whose last summary records the verdict ("convicted" / "acquitted") is
 * post-judgment: its remaining purpose is the application or report shown, then it is disposed. So is a
 * case told to "Produce the order of the Hon'ble District Court, if any": it was decided here and waits on
 * the appellate court's order.
 */
export function initialState(rec: CaseRecord): {
  stage: SequentialType;
  nextPurpose: HearingType;
  process: ProcessState | null;
  postJudgment: boolean;
} {
  const postJudgment = rec.summary.judgmentPronounced !== null || rec.summary.tags.includes("produce_order");
  let stage: SequentialType;
  if (postJudgment) stage = "JUDGEMENT";
  else if (isSequential(rec.nextPurpose)) stage = rec.nextPurpose;
  else if (isSequential(rec.currentStage)) stage = rec.currentStage;
  else {
    // Fallback for a record anchored on an interrupting type: the latest stage it has hearings at
    stage = "ADMISSION";
    for (const s of SEQUENCE) if ((rec.hearingCounts[s] ?? 0) > 0) stage = s;
  }
  const p = rec.summary.process;
  return { stage, nextPurpose: rec.nextPurpose, process: p ? { ...p } : null, postJudgment };
}
