// The hidden court: what each case, party and process will do, drawn per seed and never shown to a
// planner. Everything here is a pure function of (seed, semantic key) through src/domain/hash.ts, so two
// policies facing the same case on the same day face the same people (rule 2). The simulator
// (simulate.ts) owns the clock; resolve.ts decides a called hearing; this file holds the latent state and
// the parameters that shape it.
//
// Per-type parameters (WorldParams.perType[type], all fitted by calibrate.ts):
//   admin       P(court administrative loss | called)
//   procP       P(the court has process out for this purpose when a case comes to it without any)
//   procScale   multiplier on the return delay of process issued for this purpose
//   extP        P(an external report, mostly mediation, is awaited for this purpose)
//   extScale    multiplier on the external report's delay
//   absA, absC  multipliers on the accused side's and the complainant side's absence probability
//   both        rate of a common shock that keeps both parties away (settlement talks, joint unreadiness)
//   notReady    P(evidence or filing not ready | everyone came)
//   soughtTime  P(a side seeks time | ready)
//   unclear     residual failure no policy can influence
//
// Keys: every per-case draw is keyed on WorldCase.key = roster id + case id, so two rosters that reuse a
// case number never share draws, and a case's k-th event draws the same under any policy.
//
// What the court knows: process and reports ordered at the roster's last hearing but not recorded in its
// summary are drawn (the court's own residual share) but kept hidden: the court learns such a process is out
// only when a hearing fails for it ("reported unserved"). Nothing issued before the horizon carries a date
// in a view: the roster has no hearing dates.
//
// Service rounds (DRISTI handover 19.3): each process family counts its rounds in the case; the court sees
// the round, never the latent return day. A desk re-issue starts the next round, keyed on (case, kind,
// round); prepaid rounds start at once, later ones after a payment delay. An absconding accused's warrant
// never executes, whatever the round (the long-pending split-up still applies).
//
// Disposal routes besides the verdict and a mediation settlement (DEFAULT_DISPOSAL, each 0 = off): compounding
// (resolve.ts), default acquittal, dismissal for steps not taken and the long-pending split-up (simulate.ts).

import { addDays, nextWorkingDayAfter } from "../data/calendar";
import { LEAK, u, uBeta, uLognormal } from "./probe";
import { estimateBranchProbs, initialState, isSequential, type BranchProbs } from "../domain/lifecycle";
import { HEARING_TYPES } from "../domain/types";
import type { CaseRecord, CourtCalendar, HearingType, ObservedHearing, ProcessKind, Role, SequentialType } from "../domain/types";
import type { DisposalParams, WorldLatent, WorldParams } from "./api";

export const ROLES: readonly Role[] = ["complainant", "complainantAdvocate", "accused", "accusedAdvocate"];
export const COMPLAINANT_SIDE: readonly Role[] = ["complainant", "complainantAdvocate"];
export const ACCUSED_SIDE: readonly Role[] = ["accused", "accusedAdvocate"];
export const isComplainantSide = (r: Role): boolean => r === "complainant" || r === "complainantAdvocate";

export const PER_TYPE_KEYS = ["admin", "procP", "procScale", "extP", "extScale", "absA", "absC", "both", "notReady", "soughtTime", "unclear"] as const;
export type PerTypeKey = (typeof PER_TYPE_KEYS)[number];
export type TypeParams = Record<PerTypeKey, number>;

// Assumptions, not data. Process delays are round numbers in the range Kerala magistrate courts report for
// service (a month for summons, a little less for a DCA notice, six weeks for a warrant); calibration
// then scales them per purpose, so only their shape matters. The attendance priors are replaced by the
// roster's own present shares in defaults.ts.
export const DEFAULT_LATENT: WorldLatent = {
  processMeanDays: { summons: 30, notice: 25, warrant: 45 },
  processCv: 0.8,
  externalMeanDays: 60,
  externalCv: 0.6,
  attendancePrior: { complainant: 0.5, complainantAdvocate: 0.8, accused: 0.4, accusedAdvocate: 0.7 },
  attendanceKappa: 4,
  attendanceObsWeight: 1,
  checkinResponse: 0.7,
  lastChanceCut: 0.5,
  producedPresence: 0.9,
  // the court is told of a return the working day after it comes back; experiments may add a lag
  returnReportDelayDays: 0,
  // assumption: one side in twenty that would have gone ahead still says "not ready" the day before
  checkinFalseAlarm: 0.05,
  // assumption: a third of day-of failures (a sudden absence, a witness who drops out) cannot be foreseen
  checkinUnforeseen: 0.35,
  // DRISTI e-filing (handover 19.3): up to 4 summons and 4 warrant rounds and 1 notice round can be prepaid
  // at filing; we assume the maximum (PUCAR's defaults are 1 each, a less generous setting to sweep)
  prepaidRounds: { summons: 4, notice: 1, warrant: 4 },
  // assumption: a round the court orders beyond the prepaid ones waits two weeks for the fee to be paid
  unpaidRoundDelayDays: 14,
};

// Branch assumptions PUCAR's counts cannot identify (its generator puts hearings at every stage): about a
// quarter of complaints are filed late and need condonation; a served accused who stays away gets a warrant
// six times in ten, another chance otherwise.
export const DEFAULT_P_DELAY_CONDONATION = 0.25;
export const DEFAULT_P_WARRANT_ON_ABSENCE = 0.6;

// Disposal routes (assumptions, swept in experiments; 0 switches a route off).
export const DEFAULT_DISPOSAL: DisposalParams = {
  // s.279 BNSS: a complainant already warned (repeated absence or a last-chance order) who misses again
  acquittalOnDefault: 0.3,
  // steps (process fee, addresses) ordered and not taken: the complaint is dismissed now and then
  dismissalForSteps: 0.15,
  // s.147 NI Act: with both parties in court, one hearing in a hundred ends in compounding
  compoundingHazard: 0.01,
  // an absconding accused: after four unexecuted warrant hearings, a quarter of calls split the case up
  lpSplit: 0.25,
  lpAfterWarrantHearings: 4,
};

export const NEUTRAL_TYPE: TypeParams = {
  admin: 0,
  procP: 0,
  procScale: 1,
  extP: 0,
  extScale: 1,
  absA: 1,
  absC: 1,
  both: 0,
  notReady: 0,
  soughtTime: 0,
  unclear: 0,
};

/** Parameters with every optional part filled and behaviour switched off when asked. */
export interface Resolved {
  callMinutes: number;
  durationCv: number;
  closureProb: number;
  abscondShare: number;
  settleOnReport: number;
  behaviour: WorldParams["behaviour"];
  latent: WorldLatent;
  branch: BranchProbs;
  disposal: DisposalParams;
  type: Record<HearingType, TypeParams>;
}

export function resolveParams(p: WorldParams, records: readonly CaseRecord[], noBehaviour = false): Resolved {
  const type = {} as Record<HearingType, TypeParams>;
  for (const t of HEARING_TYPES) type[t] = { ...NEUTRAL_TYPE, ...(p.perType[t] ?? {}) } as TypeParams;
  const behaviour = noBehaviour
    ? { slotAttendLift: 0, reminderAttendLift: 0, checkinHonesty: 0, standbyAttendMult: 1, fatiguePerWastedTrip: 0 }
    : { ...p.behaviour };
  const latent = { ...DEFAULT_LATENT, ...(p.latent ?? {}) };
  // without behaviour the check-in carries neither signal nor noise
  if (noBehaviour) latent.checkinFalseAlarm = 0;
  const branch = { ...(p.branch ?? estimateBranchProbs(records)) };
  branch.pDelayCondonation = p.pDelayCondonation ?? DEFAULT_P_DELAY_CONDONATION;
  branch.pWarrant = p.pWarrantOnAbsence ?? DEFAULT_P_WARRANT_ON_ABSENCE;
  return {
    callMinutes: p.callMinutes,
    durationCv: p.durationCv,
    closureProb: p.closureProb,
    abscondShare: p.abscondShare,
    settleOnReport: p.settleOnReport,
    behaviour,
    latent,
    branch,
    disposal: { ...DEFAULT_DISPOSAL, ...(p.disposal ?? {}) },
    type,
  };
}

// ---------------------------------------------------------------------------------------------
// Latent case state

/** A process the court issued. The return day is latent; the court learns of it the working day after. */
export interface LatentProcess {
  kind: ProcessKind;
  /** the purpose it must be back for (the underlying stage for summons and warrants) */
  forType: HearingType;
  issuedOn: string;
  /** latent: the day it comes back served or executed; null = never inside any horizon (absconding) */
  returnDay: string | null;
  /** the court knows it is out (issued in the horizon, recorded in the roster summary, or reported unserved) */
  courtKnows: boolean;
  /** service round of this process family in the case (court-visible) */
  round: number;
}

export interface LatentExternal {
  forType: HearingType;
  since: string;
  readyDay: string;
  /** the court knows the report is awaited (ordered in the horizon, recorded in the summary, or a hearing failed for it) */
  courtKnows: boolean;
}

export interface WorldCase {
  id: string;
  /** roster id + case id: the key of every per-case draw */
  key: string;
  rec: CaseRecord;
  stage: SequentialType;
  nextPurpose: HearingType;
  postJudgment: boolean;
  /** latent attendance propensity per role, from a Beta seeded by the roster's Present/Absent record */
  propensity: Record<Role, number>;
  /** trips a party made that did not move the case (fatigue) */
  wastedTrips: Record<Role, number>;
  process: LatentProcess | null;
  /** service rounds sent out per process family (the roster's recorded process counts as round 1) */
  rounds: Record<"summons" | "notice" | "warrant", number>;
  external: LatentExternal | null;
  /** the purpose a roster "last chance" order was made for (cleared once that purpose is left) */
  lastChanceFor: HearingType | null;
  /** roster counts plus hearings called in the simulation */
  hearingCounts: Record<HearingType, number>;
  history: ObservedHearing[];
  /** counters that key the stateless draws (so a case's k-th event draws the same under any policy) */
  substantiveCount: number;
  processesIssued: number;
  externalsIssued: number;
  nextDate: string | null;
  firstScheduledOn: string | null;
  firstHeardOn: string | null;
  disposed: boolean;
  disposedOn: string | null;
}

/** Return family used for delays: bailable, non-bailable and by-hand warrants share the warrant delay. */
export const processFamily = (k: ProcessKind): "summons" | "notice" | "warrant" =>
  k === "summons" ? "summons" : k === "notice" ? "notice" : "warrant";

// The roster is a snapshot taken some time after each case's last hearing (its next dates are ignored).
// Process and reports ordered at that hearing were issued up to the case study's default 60-day gap before
// the start, so some have already come back by then.
const START_ELAPSED_MAX_DAYS = 60;

/**
 * Draw a process the court issues on `on` (the k-th this case has had). With `outAtStart`, the process was
 * ordered at the last hearing before the horizon: its latent issue date lies 1 to 60 days before `on`, and
 * its return day follows from that (possibly already past, in which case the court knows from the working
 * day after it).
 */
export function drawProcess(
  seed: number,
  caseKey: string,
  kind: ProcessKind,
  forType: HearingType,
  on: string,
  round: number,
  R: Resolved,
  outAtStart = false,
  courtKnows = true,
  startDelayDays = 0,
): LatentProcess {
  const fam = processFamily(kind);
  const mean = R.latent.processMeanDays[fam] * R.type[forType].procScale;
  // keyed on (case, kind, round): the k-th attempt of a kind draws the same under any policy
  const delay = Math.max(1, Math.round(uLognormal(mean, R.latent.processCv, seed, "return", caseKey, kind, round)));
  const elapsed = outAtStart ? 1 + Math.floor(u(seed, "elapsed", caseKey, round) * START_ELAPSED_MAX_DAYS) : 0;
  const issuedOn = addDays(on, -elapsed);
  // An absconding accused: the warrant is never executed inside the horizon. Absconding is a trait of the
  // case (one draw per case, so every warrant for it fails alike under any policy), and it bites at the
  // WARRANT stage, whose whole purpose is compelling appearance; a warrant at a later purpose (plea,
  // examination, judgment) is for an accused already in the trial and comes back on its fitted delay.
  const never = fam === "warrant" && forType === "WARRANT" && absconds(seed, caseKey, R);
  // an unpaid round starts only once its fee is paid
  let returnDay: string | null = never ? null : addDays(issuedOn, startDelayDays + delay);
  // rule 1 probe (inactive unless a test sets it): every return after the divergence day changes
  if (LEAK.after !== null) {
    if (returnDay === null) returnDay = addDays(LEAK.after, 20);
    else if (returnDay > LEAK.after) returnDay = null;
  }
  return { kind, forType, issuedOn, returnDay, courtKnows, round };
}

/**
 * The court sends out the next service round of a process family: prepaid rounds start at once, later ones
 * after the payment delay. An absconding accused's warrant stays unexecutable whatever the round.
 */
export function issueRound(seed: number, w: WorldCase, kind: ProcessKind, forType: HearingType, on: string, R: Resolved, outAtStart = false, courtKnows = true): LatentProcess {
  const fam = processFamily(kind);
  const round = ++w.rounds[fam];
  const wait = round > R.latent.prepaidRounds[fam] ? R.latent.unpaidRoundDelayDays : 0;
  w.process = drawProcess(seed, w.key, kind, forType, on, round, R, outAtStart, courtKnows, wait);
  w.processesIssued++;
  return w.process;
}

/** The accused of this case has absconded (a per-case latent trait). */
export const absconds = (seed: number, caseKey: string, R: Resolved): boolean => u(seed, "abscond", caseKey) < R.abscondShare;

/** A process the last summary records as served or returned: issued a delay before the start, back the day before it. */
export function servedBeforeStart(seed: number, caseKey: string, kind: ProcessKind, forType: HearingType, start: string, R: Resolved): LatentProcess {
  const mean = R.latent.processMeanDays[processFamily(kind)];
  const delay = Math.max(1, Math.round(uLognormal(mean, R.latent.processCv, seed, "return", caseKey, kind, 0)));
  const returnDay = addDays(start, -1);
  return { kind, forType, issuedOn: addDays(returnDay, -delay), returnDay, courtKnows: true, round: 1 };
}

export function drawExternal(seed: number, caseKey: string, forType: HearingType, on: string, k: number, R: Resolved, outAtStart = false, courtKnows = true): LatentExternal {
  const mean = R.latent.externalMeanDays * R.type[forType].extScale;
  const delay = Math.max(1, Math.round(uLognormal(mean, R.latent.externalCv, seed, "ready", caseKey, k)));
  const elapsed = outAtStart ? 1 + Math.floor(u(seed, "extelapsed", caseKey, k) * START_ELAPSED_MAX_DAYS) : 0;
  const since = addDays(on, -elapsed);
  let readyDay = addDays(since, delay);
  if (LEAK.after !== null && readyDay > LEAK.after) readyDay = addDays(readyDay, 30); // rule 1 probe
  return { forType, since, readyDay, courtKnows };
}

/** The purpose a structural process (summons, warrant, notice from the lifecycle) must be back for. */
export const processTarget = (stage: SequentialType, nextPurpose: HearingType): HearingType => (isSequential(nextPurpose) ? nextPurpose : stage);

/** When the court learns a latent day has passed: the working day after it plus any reporting lag (null while not yet known on `today`). */
export function knownOn(day: string | null, today: string, cal: CourtCalendar, lagDays = 0): string | null {
  if (day === null) return null;
  const told = lagDays > 0 ? addDays(day, lagDays) : day;
  if (told >= today) return null;
  return nextWorkingDayAfter(told, cal);
}

/** Process the court believes is still out on `today` (issued, return not yet reported). */
export const processOut = (w: WorldCase, today: string): boolean => w.process !== null && (w.process.returnDay === null || w.process.returnDay >= today);

/**
 * A case has come to a purpose (at the start, or after its purpose changed): with the calibrated
 * probability the court has process out for it (a notice, summons or warrant) and an external report
 * awaited. One of each per visit to a purpose; the lifecycle's own issues (summons after cognizance, a
 * fresh warrant after an absence) come on top. Keyed on the purpose's hearing count, so the k-th visit
 * draws the same under any policy.
 */
export function onEnterPurpose(seed: number, w: WorldCase, on: string, R: Resolved, residual = false): void {
  const t = w.nextPurpose;
  const tp = R.type[t];
  const k = w.hearingCounts[t];
  // A warrant for judgment issues only after the accused stays away (onFailure), never on entry
  if (t !== "JUDGEMENT" && (w.process === null || (w.process.forType !== t && !processOut(w, on)))) {
    if (tp.procP > 0 && u(seed, "issue", w.key, t, k) < tp.procP) {
      // residual process at the start was ordered at an unrecorded last hearing: hidden until reported unserved
      issueRound(seed, w, defaultKind(t), t, on, R, residual, !residual);
    }
  }
  if (w.external === null || w.external.forType !== t) {
    if (tp.extP > 0 && u(seed, "extneed", w.key, t, k) < tp.extP) {
      w.external = drawExternal(seed, w.key, t, on, w.externalsIssued, R, residual, !residual);
      w.externalsIssued++;
    }
  }
}

/** Drop process and reports that belonged to a purpose the case has left. */
export function clearStale(w: WorldCase): void {
  const live = (t: HearingType) => t === w.stage || t === w.nextPurpose;
  if (w.process && !live(w.process.forType)) w.process = null;
  if (w.external && !live(w.external.forType)) w.external = null;
  if (w.lastChanceFor !== null && w.lastChanceFor !== w.nextPurpose) w.lastChanceFor = null;
}

/** The process a court issues for a purpose when the lifecycle does not say (the sample's own orders). */
export function defaultKind(t: HearingType): ProcessKind {
  if (t === "WARRANT" || t === "PLEA" || t === "EXAMINATION_UNDER_S351_BNSS" || t === "JUDGEMENT") return "warrant_nonbailable";
  if (t === "APPEARANCE" || t === "ADMISSION" || t === "EVIDENCE_COMPLAINANT" || t === "EVIDENCE_ACCUSED") return "summons";
  return "notice";
}

/** Build the latent world for one roster under one seed. */
export function buildWorld(records: readonly CaseRecord[], ids: readonly string[], seed: number, start: string, R: Resolved, rosterId = ""): WorldCase[] {
  const L = R.latent;
  const out: WorldCase[] = [];
  records.forEach((rec, i) => {
    const id = ids[i]!;
    const key = rosterId ? `${rosterId}|${id}` : id;
    const st = initialState(rec);
    const propensity = {} as Record<Role, number>;
    for (const role of ROLES) {
      const m = Math.min(0.98, Math.max(0.02, L.attendancePrior[role]));
      let a = m * L.attendanceKappa;
      let b = (1 - m) * L.attendanceKappa;
      const seen = rec.summary.attendance[role];
      if (seen === true) a += L.attendanceObsWeight;
      else if (seen === false) b += L.attendanceObsWeight;
      propensity[role] = uBeta(a, b, seed, "propensity", key, role);
    }
    const w: WorldCase = {
      id,
      key,
      rec,
      stage: st.stage,
      nextPurpose: st.nextPurpose,
      postJudgment: st.postJudgment,
      propensity,
      wastedTrips: { complainant: 0, complainantAdvocate: 0, accused: 0, accusedAdvocate: 0 },
      process: null,
      rounds: { summons: 0, notice: 0, warrant: 0 },
      external: null,
      lastChanceFor: rec.summary.lastChance ? st.nextPurpose : null,
      hearingCounts: { ...rec.hearingCounts },
      history: [],
      substantiveCount: 0,
      processesIssued: 0,
      externalsIssued: 0,
      nextDate: null,
      firstScheduledOn: null,
      firstHeardOn: null,
      disposed: false,
      disposedOn: null,
    };
    // Process recorded in the last summary: one still out was issued an unknown time ago and returns on or
    // after the start; a served one came back before it
    if (st.process) {
      const forType = processTarget(st.stage, st.nextPurpose);
      if (st.process.status === "issued") issueRound(seed, w, st.process.kind, forType, start, R, true, true);
      else {
        w.process = servedBeforeStart(seed, key, st.process.kind, forType, start, R);
        w.rounds[processFamily(st.process.kind)] = 1;
        w.processesIssued = 1;
      }
    }
    // A mediation referral the summary records: the report is awaited for the next purpose, and the court knows
    if (rec.summary.mediation) {
      w.external = drawExternal(seed, key, st.nextPurpose, start, 0, R, true, true);
      w.externalsIssued = 1;
    }
    onEnterPurpose(seed, w, start, R, true);
    out.push(w);
  });
  return out;
}
