// How a called hearing turns out, in DESIGN.md's order: court administrative issue, process not back,
// external report not ready, a required party absent, not ready or seeks time, unclear, else substantive.
// Every draw is keyed (seed, roster and case, date) so a policy can only move thresholds (a slot, a reminder,
// being called from standby), never the draw itself. The day-before check-in has draws of its own (whether a
// side foresees tomorrow, is honest about it, raises a false alarm): correlated with the hearing, never a copy.
// Compounding under s.147 NI Act is a small per-hearing hazard once both parties are in court.

import { stageIndex, requiredRoles } from "../domain/lifecycle";
import { u, uLognormal } from "./probe";
import type { CheckinAnswer, FailureReason, HearingType, RefTables, Role } from "../domain/types";
import { ACCUSED_SIDE, COMPLAINANT_SIDE, ROLES, isComplainantSide, processFamily, type Resolved, type WorldCase } from "./world";

/** Conditions of the call that shift thresholds (never draws). */
export interface CallFlags {
  /** the listing carried a fixed call time */
  slot: boolean;
  /** the policy ran a day-before check-in for this case */
  reminder: boolean;
  /** called from the standby list */
  standby: boolean;
}

/** Steps of the resolution order; calibration counts how many hearings reach and fail at each. */
export const STEPS = ["court_admin", "awaiting_process", "external_dependency", "attendance", "not_ready", "sought_time", "unclear", "substantive"] as const;
export type Step = (typeof STEPS)[number];

export interface Resolution {
  outcome: "substantive" | "failed";
  reason: FailureReason | null;
  minutes: number;
  attendance: Record<Role, boolean>;
  /** index into STEPS where the hearing stopped */
  step: number;
  /** for a not ready / sought time failure: whether it sat with the complainant's side */
  complainantSide?: boolean;
  /** the parties compounded the offence at this hearing (the case is disposed) */
  compounded?: boolean;
}

// The accused is a party in court only once summoned: before appearance a missing accused side stops nothing.
const APPEARANCE_IDX = stageIndex("APPEARANCE");
const accusedSummoned = (w: WorldCase): boolean => stageIndex(w.stage) >= APPEARANCE_IDX;

/** Share of preparedness failures that sit with the complainant's side, by purpose (who carries the step). */
function complainantShare(t: HearingType): number {
  switch (t) {
    case "ADMISSION":
    case "DELAY_CONDONATION_HEARING":
    case "COGNIZANCE":
    case "EVIDENCE_COMPLAINANT":
      return 0.9;
    case "APPEARANCE":
    case "WARRANT":
    case "PLEA":
    case "EXAMINATION_UNDER_S351_BNSS":
    case "EVIDENCE_ACCUSED":
    case "BAIL":
      return 0.1;
    default:
      return 0.5;
  }
}

/** Probability this role stays away from this hearing, after the policy's thresholds. */
export function absenceProb(w: WorldCase, role: Role, type: HearingType, date: string, flags: CallFlags, R: Resolved): number {
  const tp = R.type[type];
  const B = R.behaviour;
  let a = (1 - w.propensity[role]) * (isComplainantSide(role) ? tp.absC : tp.absA);
  // an executed warrant means the accused was produced before the court
  if (role === "accused" && w.process && processFamily(w.process.kind) === "warrant" && w.process.forType === type && w.process.returnDay !== null && w.process.returnDay < date) {
    a = Math.min(a, 1 - R.latent.producedPresence);
  }
  // a last-chance order for this purpose also brings the parties in
  if (w.lastChanceFor === type) a *= 1 - R.latent.lastChanceCut;
  if (flags.slot) a *= 1 - B.slotAttendLift;
  if (flags.reminder) a *= 1 - B.reminderAttendLift;
  if (flags.standby) a = 1 - (1 - a) * B.standbyAttendMult;
  if (role === "complainant" || role === "accused") a += B.fatiguePerWastedTrip * w.wastedTrips[role];
  return Math.min(0.98, Math.max(0, a));
}

/** Attendance on the day: present when the role's draw clears its absence threshold. */
export function drawAttendance(seed: number, w: WorldCase, type: HearingType, date: string, flags: CallFlags, R: Resolved): Record<Role, boolean> {
  const out = {} as Record<Role, boolean>;
  for (const role of ROLES) out[role] = u(seed, "attend", w.key, role, date) >= absenceProb(w, role, type, date, flags, R);
  return out;
}

interface SideFailure {
  both: boolean;
  complainant: boolean;
  accused: boolean;
}

/** Which sides stop the hearing: a required role missing, or a whole side missing (an accused side only once summoned). */
function sideFailure(seed: number, w: WorldCase, type: HearingType, date: string, att: Record<Role, boolean>, R: Resolved): SideFailure {
  const shock = u(seed, "both", w.key, date) < R.type[type].both;
  const req = requiredRoles(type);
  const c = req.some((r) => isComplainantSide(r) && !att[r]) || COMPLAINANT_SIDE.every((r) => !att[r]);
  const a = req.some((r) => !isComplainantSide(r) && !att[r]) || (accusedSummoned(w) && ACCUSED_SIDE.every((r) => !att[r]));
  return { both: shock || (c && a), complainant: c, accused: a };
}

/** Preparedness draws for the hearing: which failure, if any, and which side it sits with. */
function preparedness(seed: number, w: WorldCase, type: HearingType, date: string, R: Resolved): { reason: "not_ready" | "sought_time" | null; complainantSide: boolean } {
  const tp = R.type[type];
  const cut = w.lastChanceFor === type ? 1 - R.latent.lastChanceCut : 1;
  const complainantSide = u(seed, "prepside", w.key, date) < complainantShare(type);
  if (u(seed, "notready", w.key, date) < tp.notReady * cut) return { reason: "not_ready", complainantSide };
  if (u(seed, "time", w.key, date) < tp.soughtTime * cut) return { reason: "sought_time", complainantSide };
  return { reason: null, complainantSide };
}

/** Resolve a hearing the bench has called. Pure in the world state; the caller applies the consequences. */
export function resolveHearing(seed: number, w: WorldCase, type: HearingType, date: string, flags: CallFlags, R: Resolved, ref: RefTables): Resolution {
  const tp = R.type[type];
  const attendance = drawAttendance(seed, w, type, date, flags, R);
  const fail = (reason: FailureReason, step: number): Resolution => ({ outcome: "failed", reason, minutes: R.callMinutes, attendance, step });

  if (u(seed, "admin", w.key, date) < tp.admin) return fail("court_admin", 0);
  // both parties in court: they may compound the offence (s.147 NI Act) whatever else the day held
  if (!w.postJudgment && attendance.complainant && attendance.accused && u(seed, "compound", w.key, date) < R.disposal.compoundingHazard) {
    return { outcome: "substantive", reason: null, minutes: R.callMinutes, attendance, step: 7, compounded: true };
  }
  const p = w.process;
  if (p && p.forType === type && (p.returnDay === null || p.returnDay >= date)) return fail("awaiting_process", 1);
  const e = w.external;
  if (e && e.forType === type && e.readyDay >= date) return fail("external_dependency", 2);

  const sides = sideFailure(seed, w, type, date, attendance, R);
  if (sides.both) {
    // a joint shock keeps both parties away whatever their own draws said
    attendance.complainant = false;
    attendance.accused = false;
    return fail("both_absent", 3);
  }
  if (sides.accused) return fail("respondent_absent", 3);
  if (sides.complainant) return fail("petitioner_absent", 3);

  const prep = preparedness(seed, w, type, date, R);
  if (prep.reason === "not_ready") return { ...fail("not_ready", 4), complainantSide: prep.complainantSide };
  if (prep.reason === "sought_time") return { ...fail("sought_time", 5), complainantSide: prep.complainantSide };
  if (u(seed, "unclear", w.key, date) < tp.unclear) return fail("unclear", 6);

  // keyed on the case's k-th substantive hearing: failed or unreached calls before it never re-roll it
  const minutes = uLognormal(ref[type].durationMin, R.durationCv, seed, "duration", w.key, type, w.substantiveCount);
  return { outcome: "substantive", reason: null, minutes, attendance, step: 7 };
}

/**
 * The day-before check-in for a case due tomorrow: each side answers, or stays silent. The answer has its
 * own draws, tied to the hearing's but not a copy of them:
 * - a side that will fail tomorrow (its attendance draw, with the reminder the check-in itself is, or its
 *   preparedness draw) foresees it only with probability 1 - checkinUnforeseen (a sudden absence, a witness
 *   who drops out overnight), and then says so with probability checkinHonesty;
 * - a side that would have gone ahead still says "not ready" with probability checkinFalseAlarm.
 * So a "not ready" is evidence, never proof, and a "ready" never guarantees the day.
 */
export function checkinAnswers(seed: number, w: WorldCase, type: HearingType, date: string, R: Resolved): { complainant: CheckinAnswer; accused: CheckinAnswer } {
  const flags: CallFlags = { slot: false, reminder: true, standby: false };
  const att = drawAttendance(seed, w, type, date, flags, R);
  const sides = sideFailure(seed, w, type, date, att, R);
  const prep = preparedness(seed, w, type, date, R);
  const L = R.latent;
  const answer = (side: "complainant" | "accused"): CheckinAnswer => {
    if (u(seed, "checkin", w.key, side, date) >= L.checkinResponse) return "silent";
    const absent = sides.both || (side === "complainant" ? sides.complainant : sides.accused);
    const unready = prep.reason !== null && prep.complainantSide === (side === "complainant");
    if (absent || unready) {
      const foresees = u(seed, "foresee", w.key, side, date) >= L.checkinUnforeseen;
      if (foresees && u(seed, "honest", w.key, side, date) < R.behaviour.checkinHonesty) return "not_ready";
      return "ready";
    }
    return u(seed, "falsealarm", w.key, side, date) < L.checkinFalseAlarm ? "not_ready" : "ready";
  };
  return { complainant: answer("complainant"), accused: answer("accused") };
}
