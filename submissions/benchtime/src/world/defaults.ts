// Default world parameters: the fitted values in calibrated.json when present, otherwise a first guess
// read straight off PUCAR's tables (each failure reason's hazard in the resolution order). Behaviour
// responses and the process and report delays are assumptions, named here so experiments can vary them.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { estimateBranchProbs } from "../domain/lifecycle";
import { FAILURE_REASONS, HEARING_TYPES } from "../domain/types";
import type { CaseRecord, FailureReason, HearingType, RefTables, Role } from "../domain/types";
import type { WorldParams } from "./api";
import { DEFAULT_DISPOSAL, DEFAULT_LATENT, DEFAULT_P_DELAY_CONDONATION, DEFAULT_P_WARRANT_ON_ABSENCE, NEUTRAL_TYPE, ROLES, type TypeParams } from "./world";

export const CALIBRATED_PATH = resolve(import.meta.dir, "calibrated.json");

/** Which of PUCAR's conflicting JUDGEMENT figures the world follows (see targetsFor). */
export type JudgementRule = "hearings_per_case" | "table";

/** What calibration aims at per type: P(substantive | reached) and the failure shares among called hearings. */
export interface TypeTarget {
  pSub: number;
  /** failure shares excluding court_holiday (a closure day is never a called hearing), summing to 1 */
  share: Record<FailureReason, number>;
  /** unconditional probability of each reason per called hearing: (1 - pSub) * share */
  q: Record<FailureReason, number>;
  source: string;
}

/**
 * Targets from PUCAR's tables. A court holiday is not a called hearing in the simulator (the whole day is
 * lost and nothing is reached), so its share is dropped and the rest renormalised; closure days come from
 * closureProb instead. JUDGEMENT: the substantiveness table says 100% ("estimated: by definition the final
 * disposal"), but its own failure row lists adjourned judgement hearings and the real hearings-per-case
 * column has a mean of 3.58. With one substantive judgement per case and geometric retries, the mean
 * implies P(substantive) = 1 / 3.58. By default the world follows that (the observed column) and keeps the
 * failure row's shares for the rest; `table` follows the 100%.
 */
export function targetsFor(ref: RefTables, judgement: JudgementRule = "hearings_per_case"): Record<HearingType, TypeTarget> {
  const out = {} as Record<HearingType, TypeTarget>;
  for (const t of HEARING_TYPES) {
    const r = ref[t];
    let pSub = r.pSubstantive;
    let source = `substantiveness table (${r.pSubstantiveSource})`;
    if (t === "JUDGEMENT" && judgement === "hearings_per_case" && r.hearingsPerCase.mean > 1) {
      pSub = 1 / r.hearingsPerCase.mean;
      source = `1 / mean hearings per case (${r.hearingsPerCase.mean}), not the table's ${Math.round(r.pSubstantive * 100)}%`;
    }
    const share = {} as Record<FailureReason, number>;
    const kept = 1 - (r.failureShare.court_holiday ?? 0);
    for (const f of FAILURE_REASONS) share[f] = f === "court_holiday" || kept <= 0 ? 0 : (r.failureShare[f] ?? 0) / kept;
    const q = {} as Record<FailureReason, number>;
    for (const f of FAILURE_REASONS) q[f] = (1 - pSub) * share[f];
    out[t] = { pSub, share, q, source };
  }
  return out;
}

/** The analytic first guess: each directly drawn reason gets its hazard given the earlier steps passed. */
export function initialPerType(targets: Record<HearingType, TypeTarget>): Record<HearingType, TypeParams> {
  const out = {} as Record<HearingType, TypeParams>;
  for (const t of HEARING_TYPES) {
    const q = targets[t].q;
    let left = 1;
    const hazard = (x: number) => {
      const h = left > 1e-9 ? x / left : 0;
      left -= x;
      return Math.min(0.95, Math.max(0, h));
    };
    const admin = hazard(q.court_admin);
    const proc = hazard(q.awaiting_process);
    const ext = hazard(q.external_dependency);
    const att = hazard(q.respondent_absent + q.petitioner_absent + q.both_absent);
    const notReady = hazard(q.not_ready);
    const soughtTime = hazard(q.sought_time);
    const unclear = hazard(q.unclear);
    out[t] = {
      ...NEUTRAL_TYPE,
      admin,
      procP: proc,
      extP: ext,
      absA: att > 0 ? 0.5 : 0,
      absC: att > 0 ? 0.5 : 0,
      both: att > 0 ? att * (q.both_absent / (q.respondent_absent + q.petitioner_absent + q.both_absent)) : 0,
      notReady,
      soughtTime,
      unclear,
    };
  }
  return out;
}

/** Present share per role in the roster's last-hearing records: the attendance prior before heterogeneity. */
export function attendancePriorFrom(records: readonly CaseRecord[]): Record<Role, number> {
  const out = { ...DEFAULT_LATENT.attendancePrior };
  for (const role of ROLES) {
    let yes = 0;
    let n = 0;
    for (const r of records) {
      const v = r.summary.attendance[role];
      if (v === null) continue;
      n++;
      if (v) yes++;
    }
    if (n > 0) out[role] = (yes + 1) / (n + 2);
  }
  return out;
}

/** Share of listed hearings lost to a no-sitting day in PUCAR's failure table (holiday count over all hearings). */
export function closureProbFrom(ref: RefTables): number {
  let holidays = 0;
  let hearings = 0;
  for (const t of HEARING_TYPES) {
    const r = ref[t];
    if (r.pSubstantive >= 1) continue; // total hearings not recoverable from failures alone
    holidays += (r.failureShare.court_holiday ?? 0) * r.failureCount;
    hearings += r.failureCount / (1 - r.pSubstantive);
  }
  return hearings > 0 ? holidays / hearings : 0;
}

export const DEFAULT_BEHAVIOUR: WorldParams["behaviour"] = {
  // a fixed call time cuts a party's chance of staying away by 30% (assumption; swept in experiments)
  slotAttendLift: 0.3,
  // a day-before reminder cuts it by 20%
  reminderAttendLift: 0.2,
  // a side that will not be ready or will not come says so 70% of the time when asked
  checkinHonesty: 0.7,
  // someone asked to wait on standby is 15% less likely to still be there when called
  standbyAttendMult: 0.85,
  // each wasted trip adds 2 points to a party's chance of staying away next time
  fatiguePerWastedTrip: 0.02,
};

interface CalibratedFile {
  perType: Record<string, Record<string, number>>;
  latent?: WorldParams["latent"];
  callMinutes?: number;
  durationCv?: number;
  closureProb?: number;
  abscondShare?: number;
  settleOnReport?: number;
  behaviour?: WorldParams["behaviour"];
  judgement?: JudgementRule;
  pDelayCondonation?: number;
  pWarrantOnAbsence?: number;
  disposal?: WorldParams["disposal"];
}

/** Load the calibrated per-type parameters, or null when calibration has not been run. */
export function loadCalibrated(path = CALIBRATED_PATH): CalibratedFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CalibratedFile;
}

/**
 * The world's defaults. With `records`, the lifecycle branch probabilities are estimated from them (else
 * simulate estimates them from the roster it runs) and, when uncalibrated, so is the attendance prior.
 */
export function defaultParams(ref: RefTables, records?: readonly CaseRecord[], opts: { useCalibrated?: boolean } = {}): WorldParams {
  const cal = opts.useCalibrated === false ? null : loadCalibrated();
  const latent = { ...DEFAULT_LATENT, ...(cal?.latent ?? {}) };
  if (!cal?.latent && records) latent.attendancePrior = attendancePriorFrom(records);
  const perType: Record<string, Record<string, number>> = {};
  const guess = initialPerType(targetsFor(ref, cal?.judgement));
  for (const t of HEARING_TYPES) perType[t] = { ...guess[t], ...(cal?.perType[t] ?? {}) };
  const params: WorldParams = {
    callMinutes: cal?.callMinutes ?? 2,
    durationCv: cal?.durationCv ?? 0.5,
    closureProb: cal?.closureProb ?? closureProbFrom(ref),
    perType,
    behaviour: { ...DEFAULT_BEHAVIOUR, ...(cal?.behaviour ?? {}) },
    // assumption: one warrant in six is never executed inside the horizon (the accused has absconded)
    abscondShare: cal?.abscondShare ?? 0.15,
    // assumption: a mediation report that comes back substantive ends the case in settlement 40% of the time
    settleOnReport: cal?.settleOnReport ?? 0.4,
    latent,
    // branch assumptions PUCAR's hearing counts cannot identify (see world.ts)
    pDelayCondonation: cal?.pDelayCondonation ?? DEFAULT_P_DELAY_CONDONATION,
    pWarrantOnAbsence: cal?.pWarrantOnAbsence ?? DEFAULT_P_WARRANT_ON_ABSENCE,
    disposal: { ...DEFAULT_DISPOSAL, ...(cal?.disposal ?? {}) },
  };
  if (records) params.branch = estimateBranchProbs(records);
  return params;
}
