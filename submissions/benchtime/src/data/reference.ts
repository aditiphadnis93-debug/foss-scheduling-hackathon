// PUCAR's three per-hearing-type tables, merged into one record per type. These are the only numbers
// the planners are allowed to trust about the court; the world is calibrated to them. Everything is
// validated on load because a silently missing type or a mistyped count would skew every policy alike.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FAILURE_REASONS, HEARING_TYPES } from "../domain/types";
import type { FailureReason, HearingType, HearingTypeRef, RefTables } from "../domain/types";
import { parseCsv } from "./csv";

/**
 * PUCAR's data folder. The package's own data/ wins when it carries the reference tables (a self-contained
 * checkout); otherwise the shared submission/data folder three levels above the package.
 */
export const DATA_DIR: string = (() => {
  const local = resolve(import.meta.dir, "../../data");
  if (existsSync(join(local, "hearing_type_reference.csv"))) return local;
  return resolve(import.meta.dir, "../../../../data");
})();

/** The CSV's ten reason columns, in file order, and the FailureReason each one maps to. */
export const FAILURE_COLUMNS: readonly [string, FailureReason][] = [
  ["Court Administrative Issue", "court_admin"],
  ["Court Holiday / No Sitting", "court_holiday"],
  ["Respondent Absence / Non-Compliance", "respondent_absent"],
  ["Petitioner Absence / Non-Compliance", "petitioner_absent"],
  ["Party Sought Time / Adjournment", "sought_time"],
  ["Evidence / Filing Not Ready", "not_ready"],
  ["Awaiting Process / Summons / Warrant Return", "awaiting_process"],
  ["External Dependency", "external_dependency"],
  ["Both Parties Unready / Absent", "both_absent"],
  ["Unclear", "unclear"],
];

/** "EXAMINATION_UNDER_S351_BNSS" -> "Examination Under S351 Bnss", the form the roster uses. */
export function labelOf(type: HearingType): string {
  return type
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function num(v: string | undefined, what: string): number {
  const s = (v ?? "").trim();
  const n = Number(s);
  if (s === "" || !Number.isFinite(n)) throw new Error(`${what}: expected a number, found "${v ?? ""}"`);
  return n;
}

function count(v: string | undefined, what: string): number {
  const n = num(v, what);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what}: expected a non-negative integer, found "${v}"`);
  return n;
}

/** Index rows by a type column, rejecting unknown or repeated types and requiring all 14. */
function byType(rows: Record<string, string>[], col: string, file: string): Map<HearingType, Record<string, string>> {
  const known = new Set<string>(HEARING_TYPES);
  const out = new Map<HearingType, Record<string, string>>();
  for (const r of rows) {
    const t = (r[col] ?? "").trim();
    if (!known.has(t)) throw new Error(`${file}: unknown hearing type "${t}"`);
    if (out.has(t as HearingType)) throw new Error(`${file}: hearing type ${t} appears twice`);
    out.set(t as HearingType, r);
  }
  const missing = HEARING_TYPES.filter((t) => !out.has(t));
  if (missing.length) throw new Error(`${file}: missing hearing types ${missing.join(", ")}`);
  return out;
}

const sourceOf = (s: string | undefined): "real" | "estimated" =>
  (s ?? "").trim().toLowerCase().startsWith("estimated") ? "estimated" : "real";

/** Parse the three tables from their CSV text (split out from the loader so tests can feed variants). */
export function parseRefTables(referenceCsv: string, substantivenessCsv: string, failureCsv: string): RefTables {
  const REF = "hearing_type_reference.csv";
  const SUB = "substantiveness_by_hearing_type.csv";
  const FAIL = "hearing_failure_reasons.csv";
  const ref = byType(parseCsv(referenceCsv), "Hearing Purpose", REF);
  const sub = byType(parseCsv(substantivenessCsv), "hearingType", SUB);
  const fail = byType(parseCsv(failureCsv), "hearingType", FAIL);

  const out = {} as RefTables;
  for (const type of HEARING_TYPES) {
    const r = ref.get(type)!;
    const s = sub.get(type)!;
    const f = fail.get(type)!;

    const pct = num(s["Substantive Hearings (percentage probability)"], `${SUB} ${type}`);
    if (pct < 0 || pct > 100) throw new Error(`${SUB} ${type}: percentage ${pct} is outside 0..100`);

    const total = count(f["total_no"], `${FAIL} ${type} total_no`);
    const counts = {} as Record<FailureReason, number>;
    let sum = 0;
    for (const [col, reason] of FAILURE_COLUMNS) {
      if (!(col in f)) throw new Error(`${FAIL}: missing column "${col}"`);
      counts[reason] = count(f[col], `${FAIL} ${type} ${col}`);
      sum += counts[reason];
    }
    if (sum !== total) throw new Error(`${FAIL} ${type}: reason counts sum to ${sum}, total_no is ${total}`);
    const failureShare = {} as Record<FailureReason, number>;
    // a type with no recorded failures gets all-zero shares rather than NaN
    for (const reason of FAILURE_REASONS) failureShare[reason] = total > 0 ? counts[reason] / total : 0;

    const hearingsPerCase = {
      min: num(r["Min Hearings per Case"], `${REF} ${type} min`),
      max: num(r["Max Hearings per Case"], `${REF} ${type} max`),
      mean: num(r["Mean Hearings per Case"], `${REF} ${type} mean`),
      median: num(r["Median Hearings per Case"], `${REF} ${type} median`),
    };
    const durationMin = num(r["Time it takes for hearing (mins) - estimated"], `${REF} ${type} duration`);
    const gapDays = num(r["Time to next hearing given this is the purpose (days)"], `${REF} ${type} gap`);
    if (durationMin <= 0 || gapDays <= 0) throw new Error(`${REF} ${type}: duration and gap must be positive`);

    const row: HearingTypeRef = {
      type,
      label: labelOf(type),
      durationMin,
      gapDays,
      hearingsPerCase,
      pSubstantive: pct / 100,
      pSubstantiveSource: sourceOf(s["source"]),
      failureShare,
      failureCount: total,
      failureSource: sourceOf(f["source"]),
    };
    out[type] = row;
  }
  return out;
}

/** Load and merge hearing_type_reference, substantiveness_by_hearing_type and hearing_failure_reasons. */
export function loadRefTables(dataDir: string = DATA_DIR): RefTables {
  const read = (f: string) => {
    const p = join(dataDir, f);
    if (!existsSync(p)) throw new Error(`Reference table not found: ${p}`);
    return readFileSync(p, "utf8");
  };
  return parseRefTables(
    read("hearing_type_reference.csv"),
    read("substantiveness_by_hearing_type.csv"),
    read("hearing_failure_reasons.csv"),
  );
}
