// The roster: one row per pending case, as PUCAR's generator writes it. It is the only input a run
// starts from, so it is validated strictly and every problem is reported at once (first 20 rows), rather
// than failing on the first or, worse, quietly dropping rows and scheduling a smaller court.

import { readFileSync } from "node:fs";
import { HEARING_TYPES } from "../domain/types";
import type { CaseRecord, HearingType } from "../domain/types";
import { isIsoDate } from "./calendar";
import { parseCsv } from "./csv";
import { parseSummary } from "./summary";

const KNOWN = new Set<string>(HEARING_TYPES);
// spellings seen in court registries for the same purposes
const ALIASES: Record<string, HearingType> = {
  JUDGMENT: "JUDGEMENT",
  DELAY_CONDONATION: "DELAY_CONDONATION_HEARING",
  EXAMINATION_UNDER_S351: "EXAMINATION_UNDER_S351_BNSS",
};

/**
 * Map a hearing-type label to its code. Accepts the roster's title case ("Examination Under S351 Bnss"),
 * the reference tables' upper-case codes ("EXAMINATION_UNDER_S351_BNSS"), and any mix of case, spaces,
 * hyphens and underscores between words. Throws naming the label when it is not one of the 14 types.
 */
export function normaliseType(label: string): HearingType {
  const code = label.trim().toUpperCase().replace(/[\s_-]+/g, "_");
  if (KNOWN.has(code)) return code as HearingType;
  const alias = ALIASES[code];
  if (alias) return alias;
  throw new Error(`Unknown hearing type "${label}"`);
}

/** The id a case goes by: its case number, or its filing number while no case number is assigned. */
export function caseIdOf(rec: { caseNumber: string; filingNumber: string }): string {
  return rec.caseNumber.trim() || rec.filingNumber.trim();
}

/** Roster column holding the hearing count for a type: hearings_examination_under_s351_bnss. */
export const countColumn = (t: HearingType): string => `hearings_${t.toLowerCase()}`;

const REQUIRED = [
  "case_number",
  "filing_number",
  "filing_date",
  "advocate_id",
  "party_id",
  "current_stage",
  "last_hearing_summary",
  "purpose_of_next_hearing",
  ...HEARING_TYPES.map(countColumn),
  "total_hearings_held",
];

const MAX_LISTED = 20;

/** Parse roster CSV text. `source` names the file in error messages. */
export function parseRoster(text: string, source = "roster"): CaseRecord[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error(`${source}: no cases`);
  const missing = REQUIRED.filter((c) => !(c in rows[0]!));
  if (missing.length) throw new Error(`${source}: missing columns ${missing.join(", ")}`);

  const errors: string[] = [];
  const out: CaseRecord[] = [];
  const ids = new Map<string, number>();
  rows.forEach((r, i) => {
    const rowNo = i + 1; // data row, 1-based, header excluded
    const problems: string[] = [];
    const caseNumber = r["case_number"]!.trim();
    const filingNumber = r["filing_number"]!.trim();
    const id = caseNumber || filingNumber;
    if (!id) problems.push("case number and filing number are both blank");
    else if (ids.has(id)) problems.push(`duplicate id ${id} (first seen in row ${ids.get(id)})`);
    else ids.set(id, rowNo);

    const filingDate = r["filing_date"]!.trim();
    if (!isIsoDate(filingDate)) problems.push(`filing date "${filingDate}" is not an ISO date`);

    const typeOf = (col: string): HearingType | null => {
      try {
        return normaliseType(r[col]!);
      } catch {
        problems.push(`${col} "${r[col]}" is not a known hearing type`);
        return null;
      }
    };
    const currentStage = typeOf("current_stage");
    const nextPurpose = typeOf("purpose_of_next_hearing");

    const hearingCounts = {} as Record<HearingType, number>;
    let sum = 0;
    for (const t of HEARING_TYPES) {
      const v = r[countColumn(t)]!.trim();
      if (!/^\d+$/.test(v)) problems.push(`${countColumn(t)} "${v}" is not a non-negative integer`);
      hearingCounts[t] = Number(v);
      sum += Number(v);
    }
    const totalRaw = r["total_hearings_held"]!.trim();
    if (!/^\d+$/.test(totalRaw)) problems.push(`total_hearings_held "${totalRaw}" is not a non-negative integer`);
    else if (Number(totalRaw) !== sum && problems.length === 0) {
      problems.push(`total_hearings_held ${totalRaw} is not the sum of the per-type counts (${sum})`);
    }

    if (problems.length || !currentStage || !nextPurpose) {
      errors.push(`row ${rowNo}${id ? ` (${id})` : ""}: ${problems.join("; ")}`);
      return;
    }
    out.push({
      caseNumber,
      filingNumber,
      filingDate,
      advocateId: r["advocate_id"]!.trim(),
      partyId: r["party_id"]!.trim(),
      currentStage,
      nextPurpose,
      hearingCounts,
      totalHearings: Number(totalRaw),
      summary: parseSummary(r["last_hearing_summary"]!),
    });
  });

  if (errors.length) {
    const more = errors.length > MAX_LISTED ? `\n  ... and ${errors.length - MAX_LISTED} more` : "";
    throw new Error(`${source}: ${errors.length} bad row(s)\n  ${errors.slice(0, MAX_LISTED).join("\n  ")}${more}`);
  }
  return out;
}

/** Load and validate a roster CSV (PUCAR's format). */
export function loadRoster(path: string): CaseRecord[] {
  return parseRoster(readFileSync(path, "utf8"), path);
}
