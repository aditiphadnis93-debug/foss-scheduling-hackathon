// The data layer: CSV reader, PUCAR's reference tables, the court calendar and the roster.

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { FAILURE_REASONS, HEARING_TYPES } from "../src/domain/types";
import {
  addDays,
  ageYears,
  daysBetween,
  fromMinutes,
  isIsoDate,
  isWorkingDay,
  loadCalendar,
  nextWorkingDayAfter,
  nextWorkingDayOnOrAfter,
  parseCalendar,
  toMinutes,
  weekday,
  workingDays,
  workingDaysBetween,
} from "../src/data/calendar";
import { parseCsv, parseCsvRows } from "../src/data/csv";
import { DATA_DIR, loadRefTables, parseRefTables } from "../src/data/reference";
import { caseIdOf, loadRoster, normaliseType, parseRoster } from "../src/data/roster";
import { readFileSync } from "node:fs";

const PKG_DATA = resolve(import.meta.dir, "../data");

describe("csv", () => {
  test("quoted fields, doubled quotes and newlines inside quotes", () => {
    const rows = parseCsv('a,b,c\n1,"x, y","say ""hi"""\n2,"line one\nline two",\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: 'say "hi"' },
      { a: "2", b: "line one\nline two", c: "" },
    ]);
  });

  test("CRLF line ends, CRLF inside quotes normalised, BOM stripped, header names trimmed", () => {
    const rows = parseCsv('﻿ a , b \r\n1,"p\r\nq"\r\n3,4');
    expect(rows).toEqual([
      { a: "1", b: "p\nq" },
      { a: "3", b: "4" },
    ]);
  });

  test("blank lines are skipped; an empty quoted cell is still a cell", () => {
    expect(parseCsv("a\n\n1\n\n")).toEqual([{ a: "1" }]);
    expect(parseCsv('a,b\n"",""\n')).toEqual([{ a: "", b: "" }]);
    expect(parseCsv("")).toEqual([]);
  });

  test("ragged rows throw with the line the row starts on", () => {
    expect(() => parseCsv('a,b\n1,2\n"multi\nline",2,3\n')).toThrow("CSV line 3: expected 2 fields, found 3");
    expect(() => parseCsv("a,b\n1\n")).toThrow("CSV line 2");
  });

  test("unclosed quote and duplicate headers throw", () => {
    expect(() => parseCsv('a\n"open\n')).toThrow("never closed");
    expect(() => parseCsv("a,a\n1,2\n")).toThrow("duplicate header");
  });

  test("parseCsvRows records the starting line of each row", () => {
    const rows = parseCsvRows('h\n"a\nb"\nc\n');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  test("the 100-case sample parses to 100 rows with multi-line summaries intact", () => {
    const rows = parseCsv(readFileSync(join(DATA_DIR, "roster_sample_100.csv"), "utf8"));
    expect(rows.length).toBe(100);
    expect(rows[0]!["last_hearing_summary"]!.split("\n").length).toBe(3);
    expect(rows[0]!["purpose_of_next_hearing"]).toBe("Evidence Accused");
  });
});

describe("reference tables", () => {
  const ref = loadRefTables();

  test("DATA_DIR holds PUCAR's files", () => {
    expect(DATA_DIR.endsWith("data")).toBe(true);
    expect(() => readFileSync(join(DATA_DIR, "court_calendar.csv"))).not.toThrow();
  });

  test("all 14 types, merged from the three tables", () => {
    expect(Object.keys(ref).sort()).toEqual([...HEARING_TYPES].sort());
    const a = ref.ADMISSION;
    expect(a.durationMin).toBe(5);
    expect(a.gapDays).toBe(5);
    expect(a.hearingsPerCase).toEqual({ min: 1, max: 16, mean: 2.12, median: 1 });
    expect(a.pSubstantive).toBeCloseTo(0.486, 10);
    expect(a.pSubstantiveSource).toBe("real");
    expect(a.failureCount).toBe(57);
    expect(a.failureShare.awaiting_process).toBeCloseTo(29 / 57, 10);
    expect(a.failureShare.court_holiday).toBeCloseTo(2 / 57, 10);
    expect(ref.EXAMINATION_UNDER_S351_BNSS.label).toBe("Examination Under S351 Bnss");
    expect(ref.REPORTS.gapDays).toBe(45);
    expect(ref.REPORTS.failureShare.external_dependency).toBeCloseTo(41 / 55, 10);
    expect(ref.WARRANT.failureShare.awaiting_process).toBeCloseTo(196 / 293, 10);
  });

  test("sources: estimated rows are marked from the source column", () => {
    expect(ref.JUDGEMENT.pSubstantiveSource).toBe("estimated");
    expect(ref.APPLICATION_REVIEW.pSubstantiveSource).toBe("estimated");
    expect(ref.JUDGEMENT.pSubstantive).toBe(1);
    const estFail = HEARING_TYPES.filter((t) => ref[t].failureSource === "estimated").sort();
    expect(estFail).toEqual(["APPLICATION_REVIEW", "ARGUMENTS", "COGNIZANCE", "JUDGEMENT", "PLEA"]);
    const estSub = HEARING_TYPES.filter((t) => ref[t].pSubstantiveSource === "estimated").sort();
    expect(estSub).toEqual(["APPLICATION_REVIEW", "JUDGEMENT"]);
  });

  test("failure shares sum to 1 over the ten reasons for every type", () => {
    for (const t of HEARING_TYPES) {
      const s = ref[t].failureShare;
      expect(Object.keys(s).sort()).toEqual([...FAILURE_REASONS].sort());
      expect(FAILURE_REASONS.reduce((a, r) => a + s[r], 0)).toBeCloseTo(1, 10);
    }
  });

  test("validation: a missing type and a bad row sum are rejected", () => {
    const text = (f: string) => readFileSync(join(DATA_DIR, f), "utf8");
    const r = text("hearing_type_reference.csv");
    const s = text("substantiveness_by_hearing_type.csv");
    const f = text("hearing_failure_reasons.csv");
    const noBail = r.split("\n").filter((l) => !l.startsWith("BAIL,")).join("\n");
    expect(() => parseRefTables(noBail, s, f)).toThrow("missing hearing types BAIL");
    const badSum = f.replace("ADMISSION,57,", "ADMISSION,58,");
    expect(() => parseRefTables(r, s, badSum)).toThrow("ADMISSION: reason counts sum to 57, total_no is 58");
    const unknown = s.replace("PLEA,90.0", "PLEAD,90.0");
    expect(() => parseRefTables(r, unknown, f)).toThrow('unknown hearing type "PLEAD"');
  });
});

describe("calendar", () => {
  const cal = loadCalendar();

  test("covers 1 Sep to 31 Dec 2026 with its holidays", () => {
    expect(cal.first).toBe("2026-09-01");
    expect(cal.last).toBe("2026-12-31");
    expect(cal.holidays.get("2026-09-04")).toBe("Janmashtami (Shravan Vad-8)");
    expect(cal.workingDays.has("2026-09-04")).toBe(false);
    expect(cal.workingDays.has("2026-09-05")).toBe(false); // Saturday
    expect(cal.workingDays.has("2026-09-07")).toBe(true);
    const counted = readFileSync(join(DATA_DIR, "court_calendar.csv"), "utf8").split("\n").filter((l) => l.endsWith(",Yes")).length;
    expect(cal.workingDays.size).toBe(counted);
  });

  test("the horizon 1 Oct to 15 Dec has a plausible number of sittings", () => {
    const days = workingDays("2026-10-01", "2026-12-15", cal);
    expect(days.length).toBeGreaterThan(40);
    expect(days.length).toBeLessThan(56);
    expect(days.every((d) => weekday(d) !== 0 && weekday(d) !== 6)).toBe(true);
  });

  test("judge leave removes working days", () => {
    const withLeave = loadCalendar(DATA_DIR, ["2026-10-05", "2026-10-06"]);
    expect(withLeave.workingDays.size).toBe(cal.workingDays.size - 2);
    expect(isWorkingDay("2026-10-05", withLeave)).toBe(false);
    expect(nextWorkingDayOnOrAfter("2026-10-05", withLeave)).toBe("2026-10-07");
    expect(() => loadCalendar(DATA_DIR, ["5 Oct 2026"])).toThrow("not an ISO date");
  });

  test("date arithmetic is UTC and exact across months and leap days", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-10-01", "2026-12-15")).toBe(75);
    expect(daysBetween("2026-12-15", "2026-10-01")).toBe(-75);
    expect(weekday("2026-09-24")).toBe(4); // Thursday
    expect(weekday("2026-09-06")).toBe(0); // Sunday
    expect(weekday("1969-12-31")).toBe(3);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(() => addDays("01/10/2026", 1)).toThrow("Not an ISO date");
  });

  test("next working day, on or after and strictly after", () => {
    expect(nextWorkingDayOnOrAfter("2026-09-04", cal)).toBe("2026-09-07"); // holiday Fri -> Mon
    expect(nextWorkingDayOnOrAfter("2026-09-07", cal)).toBe("2026-09-07");
    expect(nextWorkingDayAfter("2026-09-07", cal)).toBe("2026-09-08");
    expect(nextWorkingDayAfter("2026-09-14", cal)).toBe("2026-09-16"); // 15th is a holiday
  });

  test("beyond the calendar, weekdays count", () => {
    expect(isWorkingDay("2027-01-04", cal)).toBe(true); // Monday
    expect(isWorkingDay("2027-01-02", cal)).toBe(false); // Saturday
    expect(nextWorkingDayAfter("2026-12-31", cal)).toBe("2027-01-01");
  });

  test("working days between is signed and counts (a, b]", () => {
    expect(workingDaysBetween("2026-09-07", "2026-09-07", cal)).toBe(0);
    expect(workingDaysBetween("2026-09-03", "2026-09-07", cal)).toBe(1); // Fri holiday, weekend
    expect(workingDaysBetween("2026-09-07", "2026-09-11", cal)).toBe(4);
    expect(workingDaysBetween("2026-09-11", "2026-09-07", cal)).toBe(-4);
    expect(workingDays("2026-09-11", "2026-09-07", cal)).toEqual([]);
  });

  test("age in years and clock times", () => {
    expect(ageYears("2022-10-01", "2026-10-01")).toBeCloseTo(4, 2);
    expect(ageYears("2026-10-01", "2026-10-01")).toBe(0);
    expect(toMinutes("10:30")).toBe(630);
    expect(toMinutes("9:05")).toBe(545);
    expect(fromMinutes(630)).toBe("10:30");
    expect(fromMinutes(545.9)).toBe("09:05");
    expect(() => toMinutes("10:75")).toThrow();
  });

  test("a calendar whose working flag contradicts its own columns is rejected", () => {
    const head = "date,day_of_week,is_weekly_off,is_holiday,holiday_name,is_working_day\n";
    expect(() => parseCalendar(head + "2026-09-05,Saturday,Yes,No,,Yes\n")).toThrow("contradicts");
    expect(() => parseCalendar(head + "2026-09-05,Friday,Yes,No,,No\n")).toThrow("is a Saturday");
    expect(() => parseCalendar(head + "2026-09-01,Tuesday,No,No,,Yes\n2026-09-03,Thursday,No,No,,Yes\n")).toThrow("gaps");
  });
});

describe("roster", () => {
  const sample = loadRoster(join(DATA_DIR, "roster_sample_100.csv"));

  test("normaliseType accepts roster labels and codes, and names an unknown label", () => {
    expect(normaliseType("Examination Under S351 Bnss")).toBe("EXAMINATION_UNDER_S351_BNSS");
    expect(normaliseType("EXAMINATION_UNDER_S351_BNSS")).toBe("EXAMINATION_UNDER_S351_BNSS");
    expect(normaliseType(" Delay Condonation Hearing ")).toBe("DELAY_CONDONATION_HEARING");
    expect(normaliseType("Application Review")).toBe("APPLICATION_REVIEW");
    expect(normaliseType("application-review")).toBe("APPLICATION_REVIEW");
    expect(normaliseType("Judgment")).toBe("JUDGEMENT");
    for (const t of HEARING_TYPES) expect(normaliseType(t)).toBe(t);
    expect(() => normaliseType("Framing Of Charges")).toThrow('Unknown hearing type "Framing Of Charges"');
  });

  test("caseIdOf falls back to the filing number", () => {
    expect(caseIdOf({ caseNumber: "ST/1/2026", filingNumber: "KL-1" })).toBe("ST/1/2026");
    expect(caseIdOf({ caseNumber: " ", filingNumber: "KL-1" })).toBe("KL-1");
  });

  test("the 100-case sample loads: first record in full", () => {
    expect(sample.length).toBe(100);
    const r = sample[0]!;
    expect(r.caseNumber).toBe("ST/819/2023");
    expect(r.filingNumber).toBe("KL-000761-2023");
    expect(r.filingDate).toBe("2023-01-09");
    expect(r.advocateId).toBe("ADV-005");
    expect(r.partyId).toBe("PARTY-00001");
    expect(r.currentStage).toBe("EVIDENCE_ACCUSED");
    expect(r.nextPurpose).toBe("EVIDENCE_ACCUSED");
    expect(r.hearingCounts.ADMISSION).toBe(2);
    expect(r.hearingCounts.EVIDENCE_COMPLAINANT).toBe(9);
    expect(r.hearingCounts.APPLICATION_REVIEW).toBe(0);
    expect(r.totalHearings).toBe(35);
    expect(r.summary.raw).toContain("For defence evidence, last chance.");
    expect(r.summary.lastChance).toBe(true);
    expect(r.summary.attendance.accused).toBe(false);
    expect(r.summary.attendance.complainant).toBe(true);
  });

  test("every current stage in the sample is sequential; purposes include the interrupting types", () => {
    const seq = new Set<string>(HEARING_TYPES.slice(0, 11));
    expect(sample.every((r) => seq.has(r.currentStage))).toBe(true);
    const purposes = new Set(sample.map((r) => r.nextPurpose));
    for (const t of ["BAIL", "REPORTS", "APPLICATION_REVIEW"] as const) expect(purposes.has(t)).toBe(true);
    expect(new Set(sample.map(caseIdOf)).size).toBe(100);
  });

  test("the shared 3,000-case court and the five robustness rosters load cleanly", () => {
    for (const s of [42, 1, 2, 3, 4, 5]) {
      const recs = loadRoster(join(PKG_DATA, `roster_3000_seed${s}.csv`));
      expect(recs.length).toBe(3000);
      expect(new Set(recs.map(caseIdOf)).size).toBe(3000);
    }
  });

  const HEAD = readFileSync(join(DATA_DIR, "roster_sample_100.csv"), "utf8").split("\n")[0]!;
  const row = (over: Partial<Record<string, string>>): string => {
    const base: Record<string, string> = {
      case_number: "ST/1/2026",
      filing_number: "KL-1-2026",
      filing_date: "2026-01-05",
      advocate_id: "ADV-1",
      party_id: "PARTY-1",
      current_stage: "Appearance",
      last_hearing_summary: '"Present: Complainant\'s Advocate\nAbsent: Accused\nAwait summons."',
      purpose_of_next_hearing: "Appearance",
      total_hearings_held: "3",
    };
    for (const t of HEARING_TYPES) base[`hearings_${t.toLowerCase()}`] = "0";
    base["hearings_admission"] = "2";
    base["hearings_cognizance"] = "1";
    const merged = { ...base, ...over };
    return HEAD.split(",").map((h) => merged[h] ?? "").join(",");
  };

  test("a well-formed synthetic roster parses, with the filing number as id when the case number is blank", () => {
    const recs = parseRoster([HEAD, row({}), row({ case_number: "", filing_number: "KL-2-2026" })].join("\n"));
    expect(recs.length).toBe(2);
    expect(caseIdOf(recs[1]!)).toBe("KL-2-2026");
    expect(recs[0]!.summary.attendance.accused).toBe(false);
  });

  test("strict validation lists every bad row in one error", () => {
    const text = [
      HEAD,
      row({}),
      row({ case_number: "ST/1/2026" }), // duplicate id
      row({ case_number: "ST/3/2026", filing_date: "05/01/2026" }),
      row({ case_number: "ST/4/2026", current_stage: "Framing" }),
      row({ case_number: "ST/5/2026", hearings_bail: "-1" }),
      row({ case_number: "ST/6/2026", hearings_plea: "1.5" }),
      row({ case_number: "ST/7/2026", total_hearings_held: "4" }),
      row({ case_number: "", filing_number: "" }),
    ].join("\n");
    let msg = "";
    try {
      parseRoster(text, "test.csv");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("test.csv: 7 bad row(s)");
    expect(msg).toContain("row 2 (ST/1/2026): duplicate id ST/1/2026 (first seen in row 1)");
    expect(msg).toContain('row 3 (ST/3/2026): filing date "05/01/2026" is not an ISO date');
    expect(msg).toContain('current_stage "Framing" is not a known hearing type');
    expect(msg).toContain('hearings_bail "-1" is not a non-negative integer');
    expect(msg).toContain('hearings_plea "1.5" is not a non-negative integer');
    expect(msg).toContain("total_hearings_held 4 is not the sum of the per-type counts (3)");
    expect(msg).toContain("row 8: case number and filing number are both blank");
  });

  test("more than 20 bad rows: the first 20 are listed and the rest counted", () => {
    const bad = Array.from({ length: 25 }, (_, i) => row({ case_number: `ST/${i}/2026`, filing_date: "bad" }));
    expect(() => parseRoster([HEAD, ...bad].join("\n"))).toThrow("... and 5 more");
  });

  test("a missing column is reported before any row", () => {
    expect(() => parseRoster("case_number,filing_number\nST/1,KL-1\n")).toThrow("missing columns filing_date");
  });
});
