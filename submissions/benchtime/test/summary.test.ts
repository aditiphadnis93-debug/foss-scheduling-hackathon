// The summary parser against PUCAR's real notes: every distinct note in the 100-case sample must be
// recognised (at least one tag) unless it is on the explicit allow-list, and 15+ notes carry hand-written
// expectations. The seed-42 court is resampled from the sample, so it must add no unseen note.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseCsv } from "../src/data/csv";
import { parseSummary } from "../src/data/summary";
import type { ParsedSummary, ProcessKind, ProcessState, Role } from "../src/domain/types";

const DATA = join(import.meta.dir, "..", "..", "..", "data");
const PKG_DATA = join(import.meta.dir, "..", "data");

async function distinctNotes(path: string): Promise<string[]> {
  const rows = parseCsv(await Bun.file(path).text());
  return [...new Set(rows.map((r) => r.last_hearing_summary ?? ""))];
}

const sampleNotes = await distinctNotes(join(DATA, "roster_sample_100.csv"));
const seed42Notes = await distinctNotes(join(PKG_DATA, "roster_3000_seed42.csv"));

// Purely descriptive notes that may legitimately yield no tag. Empty today: every sample note is recognised.
const ALLOW_UNTAGGED = new Set<string>([]);

const P = true;
const A = false;
function att(complainant: boolean | null, complainantAdvocate: boolean | null, accused: boolean | null, accusedAdvocate: boolean | null): Record<Role, boolean | null> {
  return { complainant, complainantAdvocate, accused, accusedAdvocate };
}
function proc(kind: ProcessKind, status: ProcessState["status"]): ProcessState {
  return { kind, status, issuedOn: null };
}

type Expect = Partial<Omit<ParsedSummary, "raw" | "notes" | "tags">> & { tags?: string[] };

// Hand-written expectations, keyed by a distinctive fragment of the free text. Flags not named are false/null.
const CASES: [string, Expect][] = [
  ["For defence evidence, last chance.", { attendance: att(P, P, A, P), lastChance: true, tags: ["defence_evidence", "last_chance"] }],
  ["Application taken up for review; other side to file objections.", { attendance: att(A, P, A, A), objectionsPending: true, tags: ["application_review", "objections_pending"] }],
  ["Await warrant. For return of warrant.", { process: proc("warrant", "issued"), tags: ["warrant_awaited"] }],
  ["Accused's counsel not ready for cross-examination", { attendance: att(P, P, A, A), tags: ["chief_examination", "proof_affidavit", "exhibits_marked", "cross_not_ready"] }],
  ["Issue NBW to accused. Take steps. For return of warrant.", { process: proc("warrant_nonbailable", "issued"), tags: ["nbw_issued", "take_steps"] }],
  ["Complainant is continuously absent.", { attendance: att(A, A, A, A), complainantToAppear: true, tags: ["complainant_repeatedly_absent", "steps_not_taken"] }],
  ["on a last-chance basis", { lastChance: true, tags: ["complainant_evidence", "complainant_repeatedly_absent"] }],
  ["Witness shall be present.", { witnessToAttend: true, tags: ["witness_to_attend"] }],
  ["Notice served against accused. For objection and hearing.", { process: proc("notice", "served"), objectionsPending: true, tags: ["notice_served"] }],
  ["Heard from the side of the complainant.", { attendance: att(A, P, A, P), tags: ["complainant_heard", "accused_to_be_heard"] }],
  ["Accused found guilty and convicted", { attendance: att(A, A, P, P), judgmentPronounced: "convicted", tags: ["convicted", "sentenced", "sentence_suspended"] }],
  ["Accused is examined in chief as DW1.", { tags: ["defence_evidence", "exhibits_marked"] }],
  ["Accused pleaded not guilty and claimed trial.", { tags: ["pleaded_not_guilty", "particulars_explained", "sureties", "summons_case"] }],
  ["Produce the order of the Hon'ble District Court, if any.", { attendance: att(A, A, A, P), tags: ["produce_order"] }],
  ["Accused shall be present. For judgment.", { forJudgment: true, accusedToAppear: true, tags: ["accused_to_appear", "for_judgment"] }],
  ["For reporting progress in mediation, last chance.", { mediation: true, lastChance: true, tags: ["mediation_report_due"] }],
  ["Await summons. For return of summons.", { attendance: att(A, A, A, A), process: proc("summons", "issued"), tags: ["summons_awaited"] }],
  ["Judgment pronounced; accused acquitted", { judgmentPronounced: "acquitted", tags: ["judgment_pronounced", "acquitted"] }],
  ["For the appearance of the parties.", { accusedToAppear: true, complainantToAppear: true, tags: ["parties_to_appear"] }],
  ["225 affidavit filed.", { process: proc("summons", "issued"), tags: ["s225_affidavit", "s225_enquiry", "cognizance_taken", "summons_issued"] }],
  ["Issue DCA notice to accused.", { process: proc("notice", "issued"), tags: ["notice_issued"] }],
  ["Notice is returned as addressee out of India.", { process: proc("notice", "served"), objectionsPending: true, tags: ["notice_deemed_served", "addressee_abroad"] }],
  ["Delay condonation application allowed.", { process: proc("summons", "issued"), tags: ["delay_condoned", "s225_enquiry_dispensed", "cognizance_taken"] }],
  ["Summons served. For the appearance of the accused.", { process: proc("summons", "served"), accusedToAppear: true, tags: ["summons_served"] }],
  // a summons to a defence witness is not process against the accused
  ["Power of attorney holder for the complainant present.", { attendance: att(P, P, P, P), process: null, witnessToAttend: true, tags: ["poa_holder", "s351_examination", "witness_schedule", "witness_summons"] }],
  ["Await notice. For return of notice.", { process: proc("notice", "issued"), tags: ["notice_awaited"] }],
  ["parties referred for mediation.", { attendance: att(P, A, P, A), mediation: true, tags: ["mediation_referred"] }],
  ["CMP allowed. Issue by hand warrant to accused.", { process: proc("warrant", "issued"), tags: ["cmp_allowed", "warrant_issued"] }],
  ["Heard. For further hearing.", { tags: ["heard", "further_hearing"] }],
];

const DEFAULTS: Omit<Expect, "attendance" | "tags"> = {
  process: null,
  lastChance: false,
  mediation: false,
  forJudgment: false,
  judgmentPronounced: null,
  witnessToAttend: false,
  accusedToAppear: false,
  complainantToAppear: false,
  objectionsPending: false,
};

function noteContaining(fragment: string): string {
  const hits = sampleNotes.filter((n) => n.includes(fragment));
  if (hits.length === 0) throw new Error(`no sample note contains "${fragment}"`);
  return hits[0]!;
}

describe("real notes", () => {
  test("the sample has the 38 distinct notes the expectations were written against", () => {
    expect(sampleNotes.length).toBe(38);
  });

  test("the seed-42 court adds no note beyond the sample", () => {
    const sample = new Set(sampleNotes);
    expect(seed42Notes.filter((n) => !sample.has(n))).toEqual([]);
  });

  test("every distinct note yields a tag or is on the allow-list", () => {
    const untagged = sampleNotes.filter((n) => parseSummary(n).tags.length === 0 && !ALLOW_UNTAGGED.has(n));
    expect(untagged).toEqual([]);
  });

  test("every distinct note records attendance for all four roles", () => {
    for (const n of sampleNotes) {
      const s = parseSummary(n);
      for (const [role, v] of Object.entries(s.attendance)) {
        if (v === null) throw new Error(`${role} not recorded in ${JSON.stringify(n)}`);
      }
      expect(s.raw).toBe(n);
      expect(s.notes.length).toBeGreaterThan(0);
      expect(s.notes.some((l) => /^(present|absent)\s*:/i.test(l))).toBe(false);
    }
  });

  test("at least 15 hand-written expectations", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });

  for (const [fragment, want] of CASES) {
    test(`note: ${fragment}`, () => {
      const s = parseSummary(noteContaining(fragment));
      const { attendance, tags, ...flags } = { ...DEFAULTS, ...want };
      if (attendance) expect(s.attendance).toEqual(attendance);
      for (const [k, v] of Object.entries(flags)) expect([k, s[k as keyof ParsedSummary]]).toEqual([k, v]);
      for (const t of tags ?? []) expect(s.tags).toContain(t);
    });
  }
});

describe("parser details", () => {
  test("the last strong process statement wins over an earlier one", () => {
    const s = parseSummary("Present: Complainant's Advocate\nAbsent: Accused\nSummons served. Accused absent. Issue NBW to accused.");
    expect(s.process).toEqual(proc("warrant_nonbailable", "issued"));
  });

  test("a weak 'for return of' names the kind only when nothing stronger is said", () => {
    expect(parseSummary("For return of warrant.").process).toEqual(proc("warrant", "issued"));
    expect(parseSummary("Issue NBW to accused. For return of warrant.").process?.kind).toBe("warrant_nonbailable");
  });

  test("CRLF, blank lines and curly apostrophes are tolerated; unknown roles are ignored", () => {
    const s = parseSummary("Present: Complainant’s Advocate, Clerk\r\n\r\nAbsent: Accused\r\nFor judgment.");
    expect(s.attendance).toEqual(att(null, P, A, null));
    expect(s.forJudgment).toBe(true);
    expect(s.notes).toEqual(["For judgment."]);
  });

  test("an empty or unrecognised note yields nothing and does not throw", () => {
    const e = parseSummary("");
    expect(e.tags).toEqual([]);
    expect(e.process).toBeNull();
    expect(e.attendance).toEqual(att(null, null, null, null));
    expect(parseSummary("Called. Adjourned.").tags).toEqual([]);
  });

  test("'not guilty' at plea is not a judgment", () => {
    expect(parseSummary(noteContaining("pleaded not guilty")).judgmentPronounced).toBeNull();
  });
});
