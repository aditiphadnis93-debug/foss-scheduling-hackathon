import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRoster } from "../src/data/roster";
import { DATA_DIR } from "../src/data/reference";
import { parseSummary } from "../src/data/summary";
import {
  estimateBranchProbs,
  initialState,
  isSequential,
  onFailure,
  requiredRoles,
  stageIndex,
  transition,
  type BranchProbs,
} from "../src/domain/lifecycle";
import { HEARING_TYPES, INTERRUPTING, SEQUENCE, type CaseRecord, type HearingType, type Role } from "../src/domain/types";

const sample = loadRoster(join(DATA_DIR, "roster_sample_100.csv"));
const probs = estimateBranchProbs(sample);

const zeroCounts = () => Object.fromEntries(HEARING_TYPES.map((t) => [t, 0])) as Record<HearingType, number>;
function record(currentStage: HearingType, nextPurpose: HearingType, summary: string): CaseRecord {
  return {
    caseNumber: "ST/1/2024",
    filingNumber: "KL-000001-2024",
    filingDate: "2024-01-01",
    advocateId: "ADV-001",
    partyId: "PARTY-00001",
    currentStage,
    nextPurpose,
    hearingCounts: zeroCounts(),
    totalHearings: 0,
    summary: parseSummary(summary),
  };
}
const allPresent: Record<Role, boolean> = { complainant: true, complainantAdvocate: true, accused: true, accusedAdvocate: true };

describe("stages", () => {
  test("stageIndex and isSequential follow the case study's order", () => {
    SEQUENCE.forEach((s, i) => {
      expect(stageIndex(s)).toBe(i);
      expect(isSequential(s)).toBe(true);
    });
    for (const t of INTERRUPTING) {
      expect(stageIndex(t)).toBe(-1);
      expect(isSequential(t)).toBe(false);
    }
  });

  test("requiredRoles covers every type with the roles the stage descriptions call for", () => {
    for (const t of HEARING_TYPES) expect(requiredRoles(t).length).toBeGreaterThan(0);
    for (const t of ["APPEARANCE", "WARRANT", "PLEA", "EXAMINATION_UNDER_S351_BNSS", "JUDGEMENT"] as const)
      expect(requiredRoles(t)).toContain("accused");
    expect(requiredRoles("EVIDENCE_COMPLAINANT").sort()).toEqual(["accusedAdvocate", "complainant"]);
    expect(requiredRoles("ARGUMENTS").sort()).toEqual(["accusedAdvocate", "complainantAdvocate"]);
    expect(requiredRoles("BAIL")).toEqual(["accusedAdvocate"]);
    expect(requiredRoles("REPORTS").sort()).toEqual(["accused", "complainant"]);
    for (const t of ["ADMISSION", "COGNIZANCE", "DELAY_CONDONATION_HEARING"] as const) expect(requiredRoles(t)).toEqual(["complainantAdvocate"]);
    // callers get a copy
    requiredRoles("PLEA").push("complainant");
    expect(requiredRoles("PLEA")).toEqual(["accused"]);
  });
});

describe("estimateBranchProbs on the 100-case sample", () => {
  test("prints the estimates", () => {
    const e = probs.evidence;
    const pct = (x: number) => (100 * x).toFixed(1) + "%";
    console.log("Branch probabilities from roster_sample_100.csv (k / n raw, p Jeffreys-smoothed)");
    console.log(`  delay condonation | past admission: ${e.delayCondonation.k}/${e.delayCondonation.n} -> ${pct(probs.pDelayCondonation)}`);
    console.log(`  warrant | past appearance:          ${e.warrant.k}/${e.warrant.n} -> ${pct(probs.pWarrant)}`);
    for (const t of INTERRUPTING)
      console.log(`  ${t.padEnd(18)} per stage visit:  ${e.interrupt[t].k}/${e.interrupt[t].n} -> ${pct(e.interrupt[t].p)}`);
    console.log(`  post-judgment matter | judgment:    ${e.postJudgment.k}/${e.postJudgment.n} -> ${pct(probs.pPostJudgment)}`);
    console.log(`  post-judgment mix: ${INTERRUPTING.map((t) => `${t} ${pct(probs.postJudgmentMix[t])}`).join(", ")}`);
    expect(e.delayCondonation.n).toBeGreaterThan(80);
  });

  test("estimates are proper probabilities and respect the lifecycle", () => {
    for (const p of [probs.pDelayCondonation, probs.pWarrant, probs.pPostJudgment]) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
    // the sample routes almost every case through both optional stages
    expect(probs.pDelayCondonation).toBeGreaterThan(0.9);
    expect(probs.pWarrant).toBeGreaterThan(0.9);
    // bail cannot recur once trial starts
    for (const s of SEQUENCE) {
      const h = probs.interruptHazard[s];
      expect(h.BAIL).toBe(stageIndex(s) < stageIndex("EVIDENCE_COMPLAINANT") ? probs.evidence.interrupt.BAIL.p : 0);
      expect(h.BAIL + h.REPORTS + h.APPLICATION_REVIEW).toBeLessThan(0.2);
    }
    const mix = probs.postJudgmentMix;
    expect(mix.BAIL + mix.REPORTS + mix.APPLICATION_REVIEW).toBeCloseTo(1, 9);
  });

  test("works on the shared 3,000-case roster too", () => {
    const big = estimateBranchProbs(loadRoster(join(import.meta.dir, "../data/roster_3000_seed42.csv")));
    expect(big.evidence.delayCondonation.n).toBeGreaterThan(2500);
    expect(Math.abs(big.pWarrant - probs.pWarrant)).toBeLessThan(0.1);
  });
});

describe("transition after a substantive hearing", () => {
  const noInterrupt = [0.5, 0.999, 0.5];
  test("walks the sequence to judgment, issuing notice and summons on the way; a substantive appearance goes to plea", () => {
    let state = { stage: "ADMISSION" as (typeof SEQUENCE)[number], nextPurpose: "ADMISSION" as HearingType };
    const seen: string[] = [];
    const issued: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = transition(state, [0, 0.999, 0.5], probs, 0.3);
      if (r.issues) issued.push(`${r.stage}:${r.issues}`);
      if (r.disposed) {
        seen.push("disposed");
        break;
      }
      seen.push(r.stage);
      state = r;
    }
    // WARRANT is never entered by a substantive hearing: only through onFailure (the accused away after service)
    expect(seen).toEqual([...SEQUENCE.slice(1).filter((s) => s !== "WARRANT"), "disposed"]);
    expect(issued).toEqual(["DELAY_CONDONATION_HEARING:notice", "APPEARANCE:summons"]);
  });

  test("a substantive appearance or warrant hearing goes to plea whatever the branch draw", () => {
    const always: BranchProbs = { ...probs, pWarrant: 1 };
    for (const u0 of [0, 0.5, 0.99]) {
      expect(transition({ stage: "APPEARANCE", nextPurpose: "APPEARANCE" }, [u0, 0.999, 0.5], always, 0)).toMatchObject({ stage: "PLEA", nextPurpose: "PLEA", issues: null });
      expect(transition({ stage: "WARRANT", nextPurpose: "WARRANT" }, [u0, 0.999, 0.5], always, 0)).toMatchObject({ stage: "PLEA", nextPurpose: "PLEA" });
    }
  });

  test("every disposal carries its route", () => {
    expect(transition({ stage: "JUDGEMENT", nextPurpose: "JUDGEMENT" }, [0.5, 1, 0.5], probs, 0).route).toBe("verdict");
    expect(transition({ stage: "EVIDENCE_ACCUSED", nextPurpose: "REPORTS" }, [0.5, 1, 0.1], probs, 0.3).route).toBe("settlement");
    expect(transition({ stage: "JUDGEMENT", nextPurpose: "REPORTS", postJudgment: true }, [0.5, 1, 0.9], probs, 0.3).route).toBe("post_judgment");
    expect(transition({ stage: "PLEA", nextPurpose: "PLEA" }, [0.5, 1, 0.5], probs, 0).route).toBeUndefined();
  });

  test("skips optional stages when the draw is above the branch probability", () => {
    const always: BranchProbs = { ...probs, pDelayCondonation: 0.2, pWarrant: 0.2 };
    expect(transition({ stage: "ADMISSION", nextPurpose: "ADMISSION" }, noInterrupt, always, 0).stage).toBe("COGNIZANCE");
    const a = transition({ stage: "APPEARANCE", nextPurpose: "APPEARANCE" }, noInterrupt, always, 0);
    expect(a.stage).toBe("PLEA");
    expect(a.issues).toBeNull();
    expect(transition({ stage: "COGNIZANCE", nextPurpose: "COGNIZANCE" }, noInterrupt, always, 0).issues).toBe("summons");
  });

  test("interrupting hearings are inserted by hazard and return to the underlying stage", () => {
    const hazards: BranchProbs = {
      ...probs,
      interruptHazard: { ...probs.interruptHazard, PLEA: { BAIL: 0.1, REPORTS: 0.1, APPLICATION_REVIEW: 0.1 } },
    };
    const at = (u1: number) => transition({ stage: "WARRANT", nextPurpose: "WARRANT" }, [0.5, u1, 0.5], hazards, 0);
    expect(at(0.05)).toMatchObject({ stage: "PLEA", nextPurpose: "BAIL", disposed: false });
    expect(at(0.15).nextPurpose).toBe("REPORTS");
    expect(at(0.25).nextPurpose).toBe("APPLICATION_REVIEW");
    expect(at(0.35).nextPurpose).toBe("PLEA");
    for (const t of INTERRUPTING)
      expect(transition({ stage: "PLEA", nextPurpose: t }, [0.5, 0, 0.99], probs, 0.5)).toEqual({ stage: "PLEA", nextPurpose: "PLEA", disposed: false, issues: null });
  });

  test("a substantive report settles with probability settleOnReport; judgment and post-judgment matters dispose", () => {
    expect(transition({ stage: "EVIDENCE_ACCUSED", nextPurpose: "REPORTS" }, [0.5, 1, 0.2], probs, 0.3).disposed).toBe(true);
    expect(transition({ stage: "EVIDENCE_ACCUSED", nextPurpose: "REPORTS" }, [0.5, 1, 0.4], probs, 0.3).disposed).toBe(false);
    expect(transition({ stage: "JUDGEMENT", nextPurpose: "JUDGEMENT" }, [0.5, 0, 0.5], probs, 0).disposed).toBe(true);
    expect(transition({ stage: "JUDGEMENT", nextPurpose: "APPLICATION_REVIEW", postJudgment: true }, [0.5, 0, 0.99], probs, 0).disposed).toBe(true);
    // before the verdict, an application at the judgment stage returns to judgment
    expect(transition({ stage: "JUDGEMENT", nextPurpose: "APPLICATION_REVIEW" }, [0.5, 0, 0.99], probs, 0).nextPurpose).toBe("JUDGEMENT");
  });
});

describe("onFailure", () => {
  const absentAccused = { ...allPresent, accused: false };
  test("appearance with the accused away after service moves to warrant and issues one (by the warrant branch draw)", () => {
    const served = { kind: "summons" as const, status: "served" as const, issuedOn: null };
    expect(onFailure({ stage: "APPEARANCE", nextPurpose: "APPEARANCE", process: served }, "respondent_absent", absentAccused)).toEqual({
      nextPurpose: "WARRANT",
      issues: "warrant_nonbailable",
    });
    const st = { stage: "APPEARANCE" as const, nextPurpose: "APPEARANCE" as const, process: served };
    expect(onFailure(st, "respondent_absent", absentAccused, { uWarrant: 0.3, pWarrant: 0.6 }).nextPurpose).toBe("WARRANT");
    // above the branch probability the accused gets another chance at appearance
    expect(onFailure(st, "respondent_absent", absentAccused, { uWarrant: 0.7, pWarrant: 0.6 })).toEqual({ nextPurpose: "APPEARANCE", issues: null });
    // summons still out: nothing is proved yet
    const out = { kind: "summons" as const, status: "issued" as const, issuedOn: null };
    expect(onFailure({ stage: "APPEARANCE", nextPurpose: "APPEARANCE", process: out }, "respondent_absent", absentAccused)).toEqual({ nextPurpose: "APPEARANCE", issues: null });
    expect(onFailure({ stage: "APPEARANCE", nextPurpose: "APPEARANCE" }, "awaiting_process", null)).toEqual({ nextPurpose: "APPEARANCE", issues: null });
  });

  test("warrant with the accused still away reissues; other failures keep the purpose", () => {
    expect(onFailure({ stage: "WARRANT", nextPurpose: "WARRANT", process: null }, "respondent_absent", absentAccused).issues).toBe("warrant_nonbailable");
    // judgment: a warrant only after the accused stays away, and only once the last one is back
    expect(onFailure({ stage: "JUDGEMENT", nextPurpose: "JUDGEMENT", process: null }, "respondent_absent", absentAccused)).toEqual({ nextPurpose: "JUDGEMENT", issues: "warrant_nonbailable" });
    const out = { kind: "warrant_nonbailable" as const, status: "issued" as const, issuedOn: null };
    expect(onFailure({ stage: "JUDGEMENT", nextPurpose: "JUDGEMENT", process: out }, "respondent_absent", absentAccused).issues).toBeNull();
    expect(onFailure({ stage: "JUDGEMENT", nextPurpose: "JUDGEMENT", process: null }, "court_admin", allPresent).issues).toBeNull();
    expect(onFailure({ stage: "PLEA", nextPurpose: "PLEA" }, "respondent_absent", absentAccused)).toEqual({ nextPurpose: "PLEA", issues: null });
    expect(onFailure({ stage: "APPEARANCE", nextPurpose: "APPEARANCE" }, "court_admin", allPresent)).toEqual({ nextPurpose: "APPEARANCE", issues: null });
    expect(onFailure({ stage: "ARGUMENTS", nextPurpose: "ARGUMENTS" }, "sought_time", allPresent)).toEqual({ nextPurpose: "ARGUMENTS", issues: null });
  });
});

describe("initialState", () => {
  test("takes the next purpose as the stage when it is sequential, and keeps the process", () => {
    const r = record("APPEARANCE", "WARRANT", "Present: Complainant's Advocate\nAbsent: Complainant, Accused, Accused Advocate\nIssue NBW to accused. Take steps. For return of warrant.");
    const s = initialState(r);
    expect(s.stage).toBe("WARRANT");
    expect(s.nextPurpose).toBe("WARRANT");
    expect(s.postJudgment).toBe(false);
    expect(s.process).toMatchObject({ kind: "warrant_nonbailable", status: "issued" });
  });

  test("keeps the current stage under an interrupting purpose", () => {
    const s = initialState(record("EVIDENCE_COMPLAINANT", "REPORTS", "Present: Complainant, Complainant's Advocate\nAbsent: Accused, Accused Advocate\nFor reporting progress in mediation."));
    expect(s).toMatchObject({ stage: "EVIDENCE_COMPLAINANT", nextPurpose: "REPORTS", postJudgment: false });
  });

  test("a pronounced verdict makes the case post-judgment", () => {
    const acquitted = record("JUDGEMENT", "APPLICATION_REVIEW", "Present: Complainant's Advocate, Accused Advocate\nAbsent: Complainant, Accused\nJudgment pronounced; accused acquitted, benefit of doubt given.");
    expect(initialState(acquitted)).toMatchObject({ stage: "JUDGEMENT", nextPurpose: "APPLICATION_REVIEW", postJudgment: true });
    const convicted = record("JUDGEMENT", "REPORTS", "Present: Accused, Accused Advocate\nAbsent: Complainant, Complainant's Advocate\nAccused found guilty and convicted u/s.138 of the NI Act.");
    const s = initialState(convicted);
    expect(s.postJudgment).toBe(true);
    // one substantive hearing on the remaining matter disposes it
    expect(transition(s, [0.5, 0, 0.99], probs, 0).disposed).toBe(true);
  });

  test("an order to produce the District Court's order marks the case post-judgment (awaiting the appellate court)", () => {
    const r = record("JUDGEMENT", "JUDGEMENT", "Present: Complainant's Advocate\nAbsent: Complainant, Accused, Accused Advocate\nProduce the order of the Hon'ble District Court, if any.");
    expect(r.summary.tags).toContain("produce_order");
    const s = initialState(r);
    expect(s.postJudgment).toBe(true);
    expect(transition(s, [0.5, 1, 0.5], probs, 0)).toMatchObject({ disposed: true, route: "post_judgment" });
  });

  test("every sample case gets a sequential stage no earlier than its current stage", () => {
    for (const r of sample) {
      const s = initialState(r);
      expect(isSequential(s.stage)).toBe(true);
      expect(stageIndex(s.stage)).toBeGreaterThanOrEqual(stageIndex(r.currentStage));
    }
    const pj = sample.filter((r) => initialState(r).postJudgment).length;
    console.log(`Post-judgment cases in the sample: ${pj}`);
  });
});
