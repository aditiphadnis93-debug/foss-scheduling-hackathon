// Precomputes web-demo/data.json for the pitch demo from the published results, so the page loads
// instantly and every number can be traced to a file. Run from benchtime/: bun run scripts/demo-data.ts
// Facts only: every value below is read from out/*, out/tournament/*, PUCAR's CSVs or the review notes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "out");
const DATA = join(ROOT, "..", "..", "data"); // submission/data (PUCAR's CSVs)
const DEST = join(ROOT, "web-demo");

type Stat = { mean: number; lo: number; hi: number; sd?: number; n?: number };
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// 3 significant figures, trailing zeros dropped (integers >= 1000 stay whole).
function r3(x: number | null | undefined): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  if (x === 0) return 0;
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x);
  const d = Math.max(0, 2 - Math.floor(Math.log10(a)));
  return Number(x.toFixed(Math.min(d, 6)));
}
const tri = (s: Stat | undefined | null, k = 1): [number, number, number] | null =>
  s ? [r3(s.mean * k)!, r3(s.lo * k)!, r3(s.hi * k)!] : null;
const clean = (s: string) => s.replace(/[—–]/g, ", ").replace(/·/g, ",").replace(/→/g, "to");

// ---------- CSV ----------
function csv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/\r/g, "").trim();
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    rows.push(out);
  }
  const head = rows[0]!;
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- court (PUCAR's data) ----------
const TYPE_LABEL: Record<string, string> = {
  ADMISSION: "Admission",
  COGNIZANCE: "Cognizance",
  DELAY_CONDONATION_HEARING: "Delay condonation",
  APPEARANCE: "Appearance",
  WARRANT: "Warrant",
  PLEA: "Plea",
  EXAMINATION_UNDER_S351_BNSS: "Examination u/s 351",
  EVIDENCE_COMPLAINANT: "Evidence (complainant)",
  EVIDENCE_ACCUSED: "Evidence (accused)",
  ARGUMENTS: "Arguments",
  JUDGEMENT: "Judgment",
  BAIL: "Bail",
  REPORTS: "Reports",
  APPLICATION_REVIEW: "Application review",
};
const ref = csv(join(DATA, "hearing_type_reference.csv"));
const minutesOf: Record<string, number> = {};
const gapOf: Record<string, number> = {};
for (const r of ref) {
  minutesOf[r["Hearing Purpose"]!] = Number(r["Time it takes for hearing (mins) - estimated"]);
  gapOf[r["Hearing Purpose"]!] = Number(r["Time to next hearing given this is the purpose (days)"]);
}
const subRows = csv(join(DATA, "substantiveness_by_hearing_type.csv"));
const pSubOf: Record<string, number> = {};
for (const r of subRows) pSubOf[r["hearingType"]!] = Number(r["Substantive Hearings (percentage probability)"]) / 100;

const cl = csv(join(DATA, "sample_causelist_2026-09-22.csv"));
const causelist = cl.map((r) => {
  const type = r["Hearing Type"]!;
  return { case: r["Case Number"]!, type, label: TYPE_LABEL[type] ?? type, minutes: minutesOf[type] ?? null, pSub: r3(pSubOf[type] ?? NaN) };
});
const totalMinutes = causelist.reduce((a, c) => a + (c.minutes ?? 0), 0);
const expectedUseful = causelist.reduce((a, c) => a + (pSubOf[c.type] ?? 0), 0);

const fr = csv(join(DATA, "hearing_failure_reasons.csv"));
const sumCol = (col: string) => fr.reduce((a, r) => a + Number(r[col] || 0), 0);
const failTotal = sumCol("total_no");
const reasonDefs: { key: string; label: string; cols: string[] }[] = [
  { key: "process", label: "Process not returned (summons, notice, warrant)", cols: ["Awaiting Process / Summons / Warrant Return"] },
  { key: "absent", label: "A party absent", cols: ["Respondent Absence / Non-Compliance", "Petitioner Absence / Non-Compliance", "Both Parties Unready / Absent"] },
  { key: "time", label: "Party sought time", cols: ["Party Sought Time / Adjournment"] },
  { key: "notready", label: "Evidence or filing not ready", cols: ["Evidence / Filing Not Ready"] },
  { key: "external", label: "Outside dependency (reports, other courts)", cols: ["External Dependency"] },
  { key: "admin", label: "Court administrative issue", cols: ["Court Administrative Issue"] },
  { key: "holiday", label: "Court holiday or no sitting", cols: ["Court Holiday / No Sitting"] },
  { key: "unclear", label: "Unclear", cols: ["Unclear"] },
];
const reasons = reasonDefs
  .map((d) => {
    const count = d.cols.reduce((a, c) => a + sumCol(c), 0);
    return { key: d.key, label: d.label, count, share: r3(count / failTotal)! };
  })
  .sort((a, b) => b.share - a.share);

const court = {
  source: "data/sample_causelist_2026-09-22.csv (PUCAR's 22 Sep 2026 sample causelist), hearing_type_reference.csv (minutes per hearing, estimated by PUCAR), substantiveness_by_hearing_type.csv, hearing_failure_reasons.csv (PUCAR's pilot, all hearing types)",
  docket: 3000,
  dayMinutes: 420,
  causelist,
  matters: causelist.length,
  totalMinutes,
  expectedUseful: Math.round(expectedUseful * 10) / 10,
  subRateOverall: r3(expectedUseful / causelist.length),
  failures: {
    total: failTotal,
    source: "data/hearing_failure_reasons.csv, summed over every hearing type (a few low-volume rows are PUCAR's estimates); 'A party absent' joins respondent absent, petitioner absent and both parties unready or absent",
    reasons,
  },
  gapDays: gapOf,
};

// ---------- held-out (seeds 31-60) ----------
const heldout = readJson(join(OUT, "heldout.json"));
const policies: Record<string, any> = Object.fromEntries(heldout.policies.map((p: any) => [p.id, p]));
const W = "benchtime_final", T = "status_quo_60";
const perRun: Record<string, Record<number, Record<string, number>>> = {};
for (const r of heldout.perRun) ((perRun[r.policy] ??= {})[r.seed] = r.measures);

const T29 = 2.045; // t, 29 degrees of freedom, as in HEADLINE.md
function paired(a: string, b: string, m: string): Stat | null {
  const A = perRun[a], B = perRun[b];
  if (!A || !B) return null;
  const d: number[] = [];
  for (const s of Object.keys(A)) {
    const x = A[Number(s)]?.[m], y = B[Number(s)]?.[m];
    if (typeof x === "number" && typeof y === "number") d.push(x - y);
  }
  if (d.length < 2) return null;
  const mean = d.reduce((p, c) => p + c, 0) / d.length;
  const sd = Math.sqrt(d.reduce((p, c) => p + (c - mean) ** 2, 0) / (d.length - 1));
  const h = (T29 * sd) / Math.sqrt(d.length);
  return { mean, lo: mean - h, hi: mean + h, sd, n: d.length };
}
const pm = (id: string, m: string): Stat | undefined => policies[id]?.measures?.[m];

const HEAD: { id: string; label: string; m: string; unit: string; better: "higher" | "lower"; share?: boolean }[] = [
  { id: "useful", label: "Useful hearings a day", m: "extra.substantivePerDay", unit: "", better: "higher" },
  { id: "merits", label: "Cases decided on the merits", m: "derived.meritsDisposals", unit: "", better: "higher" },
  { id: "disposals", label: "All headline disposals", m: "extra.disposed", unit: "", better: "higher" },
  { id: "honoured", label: "Dates honoured", m: "extra.promisesHonouredInclDesk", unit: "%", better: "higher", share: true },
  { id: "broken", label: "Dates broken or never given", m: "extra.promisesBroken", unit: "", better: "lower" },
  { id: "neverHeard", label: "Cases never heard", m: "siddarth.neverHeard", unit: "", better: "lower" },
  { id: "oldMoved", label: "Old cases moved on", m: "readme.backlog4ySubstantiveShare", unit: "%", better: "higher", share: true },
  { id: "trips", label: "Trips per useful hearing", m: "extra.tripsPerSubstantive", unit: "", better: "lower" },
  { id: "waited", label: "Minutes waited", m: "extra.minutesWaited", unit: "min", better: "lower" },
  { id: "overshoot", label: "Next-date overshoot (days)", m: "caseStudy.nextDateExcessDays", unit: "days", better: "lower" },
];
const headlineMd = readFileSync(join(OUT, "HEADLINE.md"), "utf8");
const headline = {
  source: "out/heldout.json (policies and perRun; paired t interval, 29 degrees of freedom) = out/HEADLINE.md table; winner g237 (benchtime_final) against today's way (status_quo_60); held-out world seeds 31-60, roster seed 42, 1 Oct to 15 Dec 2026, synthetic data",
  seeds: "31-60",
  period: "1 Oct to 15 Dec 2026",
  rows: HEAD.map((h) => {
    const d = paired(W, T, h.m);
    const k = h.share ? 100 : 1;
    let verdict: "better" | "worse" | "none" = "none";
    if (d && (d.lo > 0 || d.hi < 0)) {
      const up = d.lo > 0;
      verdict = (up && h.better === "higher") || (!up && h.better === "lower") ? "better" : "worse";
    }
    return {
      id: h.id,
      label: h.label,
      winner: tri(pm(W, h.m)),
      today: tri(pm(T, h.m)),
      diff: tri(d, k),
      unit: h.unit,
      diffUnit: h.share ? "pts" : h.unit,
      better: h.better,
      verdict,
    };
  }),
};
// cross-check against the published markdown (means only)
for (const row of headline.rows) {
  const line = headlineMd.split("\n").find((l) => l.includes(`| ${row.label} |`));
  if (!line) console.warn("headline row not found in HEADLINE.md:", row.label);
}

// the judge's dial (held-out operating points)
const DIAL: { label: string; m: string; share?: boolean }[] = [
  { label: "Useful hearings a day", m: "extra.substantivePerDay" },
  { label: "Cases decided on the merits", m: "derived.meritsDisposals" },
  { label: "Dates honoured", m: "extra.promisesHonouredInclDesk", share: true },
  { label: "Dates broken or never given", m: "extra.promisesBroken" },
  { label: "Cases given a date inside the quarter", m: "extra.casesScheduled" },
  { label: "Cases never heard", m: "siddarth.neverHeard" },
  { label: "Old cases heard at all", m: "readme.backlog4yHeardShare", share: true },
  { label: "Old cases moved on", m: "readme.backlog4ySubstantiveShare", share: true },
  { label: "Minutes waited", m: "extra.minutesWaited" },
  { label: "Trips per useful hearing", m: "extra.tripsPerSubstantive" },
];
const dialIds = [T, W, "winner_calltimes", "focused"];
let dialFailed: (number | null)[] = [null, null, null, null];
{
  const line = headlineMd.split("\n").find((l) => l.startsWith("| Guardrails failed"));
  if (line) {
    const cells = line.split("|").slice(2, -1).map((c) => c.trim());
    dialFailed = cells.map((c) => (c === "" ? null : Number((c.match(/^(\d+)/) ?? [])[1] ?? NaN))).map((x) => (x === null || Number.isNaN(x) ? null : x));
  }
}
const dialHeldout = {
  source: "out/heldout.json policies (status_quo_60, benchtime_final, winner_calltimes, focused) = out/HEADLINE.md 'The judge's dial'; seeds 31-60; shares as fractions",
  columns: ["Today's way", "g237 (the pick)", "g237 + call times", "focused (g1121)"],
  ids: dialIds,
  rows: DIAL.map((d) => ({ label: d.label, share: !!d.share, values: dialIds.map((id) => tri(pm(id, d.m))) })),
  guardrailsFailed: dialFailed,
};

// guardrails (pass under criteria.json's own definition; the t-bound reading kept alongside)
const criteria = readJson(join(OUT, "tournament", "criteria.json"));
const critByLabel: Record<string, any> = Object.fromEntries(criteria.guardrails.map((g: any) => [g.label, g]));
const guardrails = {
  source: "out/heldout.json guardrails (paired against status_quo_60, 95% t interval, seeds 31-60); pass follows out/tournament/criteria.json (a guardrail marked on: mean is compared on the mean), passTBound is the stricter paired t-bound reading printed in out/HEADLINE.md",
  seeds: "31-60",
  rows: heldout.guardrails.map((g: any) => {
    const c = critByLabel[g.label];
    let pass = !!g.pass;
    if (c?.on === "mean" && typeof g.candMean === "number" && typeof g.todayMean === "number") {
      const lim = Number(String(g.margin).replace(/[^\d.+-]/g, ""));
      const diff = g.candMean - g.todayMean;
      pass = g.op === "<=" ? diff <= lim : diff >= lim;
    }
    return {
      label: g.label,
      margin: String(g.margin),
      pass,
      passTBound: !!g.pass,
      onMean: c?.on === "mean",
      diff: g.vs === "absolute" ? null : [r3(g.diff), r3(g.lo), r3(g.hi)],
      cand: r3(g.candMean),
      today: r3(g.todayMean),
    };
  }),
};
// pass/fail under criteria.json's own definition (on: mean compared on the mean), used for every guardrail count
function gPass(g: any): boolean {
  const c = critByLabel[g.label];
  if (c?.on === "mean" && typeof g.candMean === "number" && typeof g.todayMean === "number") {
    const lim = Number(String(g.margin).replace(/[^\d.+-]/g, ""));
    const diff = g.candMean - g.todayMean;
    return g.op === "<=" ? diff <= lim : diff >= lim;
  }
  return !!g.pass;
}
const nFailed = (gs: any[] | undefined) => (gs ?? []).filter((g: any) => !gPass(g)).length;
const nFailedT = (gs: any[] | undefined) => (gs ?? []).filter((g: any) => !g.pass).length;
(guardrails as any).failed = guardrails.rows.filter((r: any) => !r.pass).map((r: any) => r.label);

// robustness
const ROB_LABEL: Record<string, string> = {
  baseline: "As calibrated",
  nobehaviour: "People do not react to call times or reminders",
  cv025: "Hearing lengths steadier (spread 0.25)",
  cv100: "Hearing lengths far less predictable (spread 1.0)",
  process15: "Summons come back 1.5 times slower",
  falsealarm2: "Twice the false 'not ready' answers",
  pbias_up: "Planner too hopeful (success chances shown 30% higher)",
  pbias_down: "Planner too gloomy (success chances shown 30% lower)",
  roster1: "A different docket (roster seed 1)",
  roster2: "A different docket (roster seed 2)",
  roster3: "A different docket (roster seed 3)",
  roster4: "A different docket (roster seed 4)",
  roster5: "A different docket (roster seed 5)",
};
const rob = readJson(join(OUT, "robustness.json"));
const robustness = {
  source: "out/robustness.json (winner minus today's way under each changed court, paired 95% t, seeds 31-60)",
  seeds: "31-60",
  rows: rob.conditions.map((c: any) => {
    const u = c.key["extra.substantivePerDay"], m = c.key["derived.meritsDisposals"], h = c.key["extra.promisesHonouredInclDesk"];
    const all3 = u?.lo > 0 && m?.lo > 0 && h?.lo > 0;
    return {
      id: c.id,
      label: ROB_LABEL[c.id] ?? clean(c.label),
      raw: clean(c.label),
      useful: tri(u),
      merits: tri(m),
      honoured: tri(h, 100),
      beatsAll3: all3 ? "yes" : "not clearly",
      guardrailsFailed: nFailed(c.guardrails),
      guardrailsFailedTBound: nFailedT(c.guardrails),
    };
  }),
};

// ablation
const abl = readJson(join(OUT, "ablation.json"));
const ablFields = (p: any) => ({
  useful: tri(p?.["extra.substantivePerDay"]),
  merits: tri(p?.["derived.meritsDisposals"]),
  broken: tri(p?.["extra.promisesBroken"]),
  neverHeard: tri(p?.["siddarth.neverHeard"]),
  trips: tri(p?.["extra.tripsPerSubstantive"]),
  honoured: tri(p?.["extra.promisesHonouredInclDesk"], 100),
  waited: tri(p?.["extra.minutesWaited"]),
});
const ablation = {
  source: "out/ablation.json (each row changes one gene of the winner, paired against the winner on seeds 31-60; 'added' rows add one component to today's way, paired against today's way); honoured in points",
  seeds: "31-60",
  rows: abl.switchedOff.map((a: any) => ({
    id: a.id,
    variant: clean(a.label),
    change: clean(`${a.from} to ${a.to}`),
    diagnostic: /DIAGNOSTIC/.test(a.label),
    guardrailsFailed: nFailed(a.guardrails),
    ...ablFields(a.pairedVsWinner),
  })),
  added: abl.addedToToday.map((a: any) => ({
    id: a.id,
    variant: clean(a.label),
    change: clean(typeof a.change === "string" ? a.change : JSON.stringify(a.change)),
    guardrailsFailed: nFailed(a.guardrails),
    ...ablFields(a.pairedVsToday),
  })),
};

// judge styles
const sty = readJson(join(OUT, "styles.json"));
const styFields = (meas: any) => ({
  useful: tri(meas?.["extra.substantivePerDay"]),
  merits: tri(meas?.["derived.meritsDisposals"]),
  broken: tri(meas?.["extra.promisesBroken"]),
  neverHeard: tri(meas?.["siddarth.neverHeard"]),
  honoured: tri(meas?.["extra.promisesHonouredInclDesk"]),
  waited: tri(meas?.["extra.minutesWaited"]),
  daysLate: tri(meas?.["caseStudy.overrunDays"]),
});
const plainMean = (id: string) => {
  const f = styFields(policies[id]?.measures);
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v ? v[0] : null]));
};
const styles = {
  source: "out/styles.json (each judge's rules laid over the winner, seeds 31-60; 'plain' is the judge's own policy as coded, from out/heldout.json); rules check: 0 violations (out/styles-rules-check.txt)",
  seeds: "31-60",
  rulesCheck: sty.rulesCheck?.sets ?? null,
  rows: sty.styles.map((s: any) => ({
    id: s.cell,
    name: clean(s.style),
    plainId: s.plain,
    how: clean(s.how),
    beatsPlainOn: s.beatsPlainOn,
    losesToPlainOn: s.losesToPlainOn,
    of: s.of,
    guardrailsFailed: nFailed(s.guardrails),
    guardrailsFailedLabels: (s.guardrails ?? []).filter((g: any) => !gPass(g)).map((g: any) => g.label),
    ...styFields(s.measures),
    plain: plainMean(s.plain),
  })),
  winner: styFields(policies[W]?.measures),
  today: styFields(policies[T]?.measures),
};

// settlement add-on
let settlement: any = null;
try {
  const st = readJson(join(OUT, "settlement.json"));
  settlement = {
    source: "out/settlement.json (winner plus a settlement sitting, minus the winner alone, paired 95% t, seeds 31-60; the world's settlement hazards do not respond to the sitting)",
    rows: st.setups.map((s: any) => ({
      id: s.id,
      label: clean(s.label),
      useful: tri(s.pairedVsWinner?.["extra.substantivePerDay"]),
      merits: tri(s.pairedVsWinner?.["derived.meritsDisposals"]),
      guardrailsFailed: nFailed(s.guardrails),
    })),
  };
} catch { settlement = null; }

// ---------- tournament ----------
const lines = readFileSync(join(OUT, "tournament", "candidates.jsonl"), "utf8").split("\n").filter((l) => l.trim());
const recs = lines.map((l) => JSON.parse(l));
const firstFinal = recs.findIndex((r) => r.stage === "final-rule-start");
const seedsKey = (r: any) => (Array.isArray(r.seeds) ? `${r.seeds[0]}-${r.seeds[r.seeds.length - 1]}` : "");

function finalGen(stage: string): number {
  if (stage === "final-reference" || stage === "final-entry") return 0;
  const m = stage.match(/^final-gen(\d+)$/);
  if (m) return Number(m[1]);
  return 13;
}
const fm = (r: any) => ({
  useful: r3(r.mean["extra.substantivePerDay"]),
  neverHeard: r3(r.mean["siddarth.neverHeard"]),
  honoured: r3(r.mean["extra.promisesHonouredInclDesk"]),
  broken: r3(r.mean["extra.promisesBroken"]),
  merits: r3(r.mean["derived.meritsDisposals"]),
});
const winnerJson = readJson(join(OUT, "tournament", "winner.json"));
const finalRecs = recs.slice(firstFinal).filter((r) => r.mean && seedsKey(r) === "1-6");
const seenF = new Set<string>();
const finalPts: number[][] = [];
for (const r of finalRecs) {
  const k = r.key ?? r.name;
  if (seenF.has(k)) continue;
  seenF.add(k);
  const f = fm(r);
  finalPts.push([f.useful!, f.neverHeard!, f.honoured!, f.broken!, f.merits!, finalGen(r.stage)]);
}
const fToday = recs.slice(firstFinal).find((r) => r.mean && r.name === T && r.stage === "final-reference" && seedsKey(r) === "1-6");
const fWin = recs.slice(firstFinal).find((r) => r.mean && r.key === winnerJson.key && seedsKey(r) === "1-6") ??
  recs.slice(firstFinal).find((r) => r.mean && r.name === "g237" && seedsKey(r) === "1-6");
// named rivals on the same seeds, for labels on the scatter
const namedIds = ["sehgal", "dimakar", "joshi", "bin_packing", "fifo_capped", "oldest_first", "benchtime", "adp", "status_quo_ref"];
const named: Record<string, any> = {};
for (const id of namedIds) {
  const r = recs.slice(firstFinal).find((x) => x.mean && x.name === id && x.stage === "final-reference" && seedsKey(x) === "1-6");
  if (r) named[id] = { name: id, origin: r.origin, ...fm(r) };
}

function oldGen(stage: string): number {
  if (stage === "stage1") return 0;
  if (stage === "stage2-init") return 1;
  let m = stage.match(/^stage2-gen(\d+)$/);
  if (m) return 1 + Number(m[1]);
  if (stage === "stage3" || stage === "stage4") return 17;
  if (stage === "stage2b-inject") return 18;
  m = stage.match(/^stage2b-gen(\d+)$/);
  if (m) return 18 + Number(m[1]);
  return 17;
}
const om = (r: any) => ({
  useful: r3(r.mean["extra.substantivePerDay"]),
  neverHeard: r3(r.mean["siddarth.neverHeard"]),
  heldOnPromised: r3(r.mean["siddarth.heldOnPromisedDate"]),
  casesScheduled: r3(r.mean["extra.casesScheduled"]),
  neverActedOn: r3(r.mean["extra.neverActedOn"]),
});
const oldRecs = recs.slice(0, firstFinal).filter((r) => r.mean && r.stage !== "reference");
const seenO = new Set<string>();
const oldPts: number[][] = [];
const oldSeedCount: Record<string, number> = {};
for (const r of oldRecs) {
  const k = r.key ?? r.name;
  if (seenO.has(k)) continue;
  seenO.add(k);
  const o = om(r);
  oldSeedCount[seedsKey(r)] = (oldSeedCount[seedsKey(r)] ?? 0) + 1;
  oldPts.push([o.useful!, o.neverHeard!, o.heldOnPromised!, o.casesScheduled!, oldGen(r.stage)]);
}
const oldWinnerRec = oldRecs.find((r) => r.name === "g921" && seedsKey(r) === "1-6");
const oldTodayRec = recs.slice(0, firstFinal).find((r) => r.mean && r.name === T && seedsKey(r) === "1-6") ??
  recs.slice(0, firstFinal).find((r) => r.mean && r.name === T && r.stage === "stage1");
const oldTodayVal = recs.slice(0, firstFinal).find((r) => r.mean && r.name === T && r.stage === "stage4" && seedsKey(r) === "21-30");
const amendRec = oldRecs.find((r) => r.name === "g869");
const oldWinnerVal = oldRecs.find((r) => r.name === "g921" && r.stage === "stage4" && seedsKey(r) === "21-30");
const oldWinnerJson = readJson(join(OUT, "tournament", "old-rule", "winner.json"));
const ov = oldWinnerJson.validation ?? {};
const ovm = (m: string) => r3(ov[m]?.mean);

const PRESET_IDS: [string, string][] = [
  ["status_quo_60", "Today's way"],
  ["sehgal", "Justice Sehgal"],
  ["dimakar", "Justice Dimakar"],
  ["joshi", "Justice Joshi"],
  ["bin_packing", "Bin packing (an operations-research rule)"],
];
const flatten = (g: any) => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(g ?? {})) {
    if (k === "weights" && v && typeof v === "object") for (const [wk, wv] of Object.entries(v as any)) out[`weights.${wk}`] = typeof wv === "number" ? r3(wv) : wv;
    else if (typeof v === "number") out[k] = r3(v);
    else out[k] = v;
  }
  return out;
};
const genomes: any[] = [];
for (const [id, name] of PRESET_IDS) {
  const r = recs.find((x) => x.origin === "preset" && x.name === id && x.genome);
  genomes.push({ name, id, genes: r ? flatten(r.genome) : null });
}
genomes.push({ name: "Our pick (g237)", id: "g237", genes: flatten(winnerJson.genome) });
const geneNames: string[] = [];
for (const g of genomes) for (const k of Object.keys(g.genes ?? {})) if (!geneNames.includes(k)) geneNames.push(k);

const tournament = {
  distinctGenomes: 2587,
  distinctSource: "out/tournament/summary.md: 'about 2587 distinct genomes of the zoo meta-policy over the whole tournament'",
  source: "out/tournament/candidates.jsonl",
  final: {
    note: "Final rule: fresh runs on the shared court (roster_3000_seed42), criteria of 14:40, tuning world seeds 1-6, 1 Oct to 15 Dec 2026; one point per distinct genome (first run kept); gen 0 = entry pool and references, 1-12 = NSGA-II generations under the final rule",
    seeds: "1-6",
    cols: ["useful", "neverHeard", "honoured", "broken", "merits", "gen"],
    points: finalPts,
    today: fToday ? { name: "status_quo_60", ...fm(fToday) } : null,
    winner: fWin ? { name: "g237", gen: finalGen(fWin.stage), ...fm(fWin) } : null,
    named,
    generations: finalPts.reduce((a, p) => Math.max(a, p[5]!), 0),
  },
  old: {
    note: "First rule (most useful hearings behind 7 guardrails): an earlier court copy keyed seed42, not comparable point for point with the final court; mostly tuning seeds 1-6 (stage 1 used seeds 1-4); one point per distinct genome",
    seedCounts: oldSeedCount,
    cols: ["useful", "neverHeard", "heldOnPromised", "casesScheduled", "gen"],
    points: oldPts,
    today: oldTodayRec ? { name: "status_quo_60", seeds: seedsKey(oldTodayRec), ...om(oldTodayRec) } : null,
    todayValidation: oldTodayVal ? { name: "status_quo_60", seeds: "21-30", ...om(oldTodayVal) } : null,
    winner: {
      name: "g921",
      seeds: "1-6",
      ...(oldWinnerRec ? om(oldWinnerRec) : {}),
      validation: {
        seeds: "21-30",
        source: "out/tournament/old-rule/winner.json validation",
        useful: ovm("extra.substantivePerDay"),
        neverHeard: ovm("siddarth.neverHeard"),
        heldOnPromised: ovm("siddarth.heldOnPromisedDate"),
        casesScheduled: ovm("extra.casesScheduled") ?? (oldWinnerVal ? r3(oldWinnerVal.mean["extra.casesScheduled"]) : null),
        neverActedOn: ovm("extra.neverActedOn") ?? (oldWinnerVal ? r3(oldWinnerVal.mean["extra.neverActedOn"]) : null),
        casesScheduledSource: "candidates.jsonl stage4 record of g921 (seeds 21-30)",
      },
      description: clean(oldWinnerJson.description ?? ""),
    },
    amendLeader: amendRec ? { name: "g869", seeds: seedsKey(amendRec), note: "leader under the 14:00 amendment (10 guardrails)", ...om(amendRec) } : null,
  },
  genomes,
  geneNames,
  winnerDescription: clean(winnerJson.description ?? ""),
};

// ---------- reviews (quoted from /tmp/review/*.md) ----------
const reviews = [
  {
    lens: "A magistrate's eye",
    file: "/tmp/review/judge.md",
    finding: "I would not sign lists made by the winner of the 10-guardrail rule. The leading candidates keep 94-98% of promised dates only because they made about 45% fewer promises: roughly 1,340 cases that already have dates in their order sheets were quietly moved to January, without being called and without any order.",
  },
  {
    lens: "PUCAR's scorecards",
    file: "/tmp/review/scorecards.md",
    finding: "It guards 9 of about 30 scorecard readings. Utilisation, reach rate, substantiveness, load balance and minutes waited are not guarded at all, and trips are measured against bin_packing, which keeps 7% of promised dates.",
  },
  {
    lens: "Loopholes",
    file: "/tmp/review/gaming.md",
    finding: "The search found the cheap way to match 91%: never give 40-47% of the docket a date inside the horizon. A case given a first date after 15 Dec produces no row, so it drops out of the promise measures.",
  },
  {
    lens: "Statistics",
    file: "/tmp/review/statistics.md",
    finding: "Every guardrail is a point comparison of two 6-seed means with a tolerance that sits well inside the seed noise. A pass or fail on seeds 1-6 is close to a coin toss for any candidate near the boundary.",
  },
];
// verify each quote's anchor phrase still exists in its file
for (const r of reviews) {
  try {
    const t = readFileSync(r.file, "utf8");
    const anchor = r.finding.split(/[.:]/)[0]!.slice(0, 40);
    if (!t.includes(anchor)) console.warn("review anchor not found verbatim:", r.file, anchor);
  } catch { console.warn("review file missing:", r.file); }
}

// ---------- calibration ----------
const calText = readFileSync(join(OUT, "calibration-fit.md"), "utf8");
const mae = calText.match(/mean absolute error in P\(substantive\): ([\d.]+)%/);
const calRows: any[] = [];
{
  const sec = calText.split("## P(substantive | reached)")[1]?.split("\n## ")[0] ?? "";
  for (const line of sec.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    if (c.length < 11 || !/^[A-Z_0-9]+$/.test(c[1] ?? "")) continue;
    const pct = (x: string) => r3(Number(x.replace("%", "")) / 100);
    const within = c[10] ?? "";
    calRows.push({
      type: c[1],
      label: TYPE_LABEL[c[1]!] ?? c[1],
      calledHearings: Number(c[2]),
      target: pct(c[3]!),
      simulated: pct(c[4]!),
      pucarHearings: /estimated/.test(c[6]!) ? null : Number((c[6]!.match(/^(\d+)/) ?? [])[1] ?? NaN),
      judged: /^yes/.test(within) ? "yes" : /too little/.test(within) ? "too little evidence" : /estimated/.test(within) ? "estimated" : within,
      judgedText: within,
    });
  }
}
const calibration = {
  source: "out/calibration-fit.md",
  rows: calRows,
  maePSub: mae ? r3(Number(mae[1]) / 100) : null,
  note: "Fitted on world seeds 1-20 with the full 3,000-case seed-42 roster, 10 iterations of proportional fitting; the simulated court's chance of a useful hearing per type matches PUCAR's table to within 0.2 points on average (weighted by hearings reached), and the failure shares per type within PUCAR's own error where its evidence is real.",
};

// ---------- write ----------
const data = {
  generated: new Date().toISOString(),
  court,
  headline,
  dialHeldout,
  aims: readJson(join(OUT, "aims.json")),
  guardrails,
  robustness,
  ablation,
  styles,
  settlement,
  tournament,
  reviews,
  calibration,
};
if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });
const text = JSON.stringify(data);
if (/[—–·→]/.test(text)) console.warn("banned character present in data.json");
writeFileSync(join(DEST, "data.json"), text);
console.log(`wrote web-demo/data.json ${(text.length / 1024).toFixed(0)} KB; final points ${finalPts.length}, old points ${oldPts.length}; matters ${causelist.length}, minutes ${totalMinutes}`);
