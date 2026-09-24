// A profile of PUCAR's data for the submission write-up: what the court looks like before any policy runs.
//
//   bun run scripts/profile-data.ts                      -> the 100-case sample and the seed-42 court
//   bun run scripts/profile-data.ts path/to/roster.csv   -> any roster(s) in PUCAR's format
//
// Prints hearing types (stage and next purpose), filing ages, attendance at the last hearing, the notes
// the parser recognised, and PUCAR's per-type substantiveness and failure shares.

import { join, resolve } from "node:path";
import { ageYears, loadCalendar, workingDays } from "../src/data/calendar";
import { DATA_DIR, loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { FAILURE_REASONS, HEARING_TYPES } from "../src/domain/types";
import type { CaseRecord, HearingType, Role } from "../src/domain/types";

const HORIZON_START = "2026-10-01";
const HORIZON_END = "2026-12-15";
const ROLES: Role[] = ["complainant", "complainantAdvocate", "accused", "accusedAdvocate"];
const AGE_BANDS: [string, number, number][] = [
  ["under 1 year", 0, 1],
  ["1 to 2 years", 1, 2],
  ["2 to 4 years", 2, 4],
  ["4 years and over", 4, Infinity],
];

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function countBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

function profile(name: string, recs: CaseRecord[]): void {
  const n = recs.length;
  console.log(`\n=== ${name}: ${n} cases ===`);

  console.log("\nHearing types (current stage, next purpose, mean hearings held at that type)");
  const stage = countBy(recs, (r) => r.currentStage);
  const purpose = countBy(recs, (r) => r.nextPurpose);
  console.log(`  ${pad("type", 30)}${lpad("stage", 8)}${lpad("purpose", 9)}${lpad("held", 8)}`);
  for (const t of HEARING_TYPES) {
    const held = recs.reduce((a, r) => a + r.hearingCounts[t], 0) / n;
    console.log(`  ${pad(t, 30)}${lpad(stage.get(t) ?? 0, 8)}${lpad(purpose.get(t) ?? 0, 9)}${lpad(held.toFixed(2), 8)}`);
  }
  const moved = recs.filter((r) => r.nextPurpose !== r.currentStage).length;
  console.log(`  next purpose differs from current stage: ${moved} (${pct(moved / n)})`);
  const totals = recs.map((r) => r.totalHearings).sort((a, b) => a - b);
  console.log(`  hearings held per case: median ${quantile(totals, 0.5)}, p90 ${quantile(totals, 0.9)}, max ${totals.at(-1)}`);

  console.log(`\nFiling age on ${HORIZON_START}`);
  const ages = recs.map((r) => ageYears(r.filingDate, HORIZON_START)).sort((a, b) => a - b);
  for (const [label, lo, hi] of AGE_BANDS) {
    const k = ages.filter((a) => a >= lo && a < hi).length;
    console.log(`  ${pad(label, 18)}${lpad(k, 6)}  ${pct(k / n)}`);
  }
  console.log(`  median ${quantile(ages, 0.5).toFixed(2)} y, p95 ${quantile(ages, 0.95).toFixed(2)} y, oldest ${ages.at(-1)!.toFixed(2)} y`);
  const advocates = countBy(recs, (r) => r.advocateId);
  const perAdv = [...advocates.values()].sort((a, b) => a - b);
  console.log(`  advocates: ${advocates.size}, cases per advocate median ${quantile(perAdv, 0.5)}, max ${perAdv.at(-1)}`);

  console.log("\nAttendance recorded at the last hearing (present / absent / not recorded)");
  for (const role of ROLES) {
    const p = recs.filter((r) => r.summary.attendance[role] === true).length;
    const a = recs.filter((r) => r.summary.attendance[role] === false).length;
    console.log(`  ${pad(role, 22)}${lpad(pct(p / n), 7)}${lpad(pct(a / n), 8)}${lpad(pct((n - p - a) / n), 8)}`);
  }

  console.log("\nLast-hearing notes");
  const notes = countBy(recs.flatMap((r) => r.summary.notes), (x) => x);
  const untagged = recs.filter((r) => r.summary.tags.length === 0).length;
  console.log(`  distinct notes: ${notes.size}; cases with no recognised tag: ${untagged} (${pct(untagged / n)})`);
  const flags: [string, (r: CaseRecord) => boolean][] = [
    ["process out (issued, not back)", (r) => r.summary.process?.status === "issued"],
    ["process served", (r) => r.summary.process?.status === "served"],
    ["last chance", (r) => r.summary.lastChance],
    ["mediation", (r) => r.summary.mediation],
    ["for judgment", (r) => r.summary.forJudgment],
    ["judgment pronounced", (r) => r.summary.judgmentPronounced !== null],
    ["witness to attend", (r) => r.summary.witnessToAttend],
    ["accused to appear", (r) => r.summary.accusedToAppear],
    ["complainant to appear", (r) => r.summary.complainantToAppear],
    ["objections pending", (r) => r.summary.objectionsPending],
  ];
  for (const [label, f] of flags) {
    const k = recs.filter(f).length;
    console.log(`  ${pad(label, 32)}${lpad(k, 6)}  ${pct(k / n)}`);
  }
  const tags = [...countBy(recs.flatMap((r) => r.summary.tags), (x) => x)].sort((a, b) => b[1] - a[1]);
  console.log(`  tags: ${tags.map(([t, k]) => `${t} ${k}`).join(", ")}`);
  console.log("  most common notes:");
  for (const [note, k] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${lpad(k, 5)}  ${note.length > 110 ? note.slice(0, 107) + "..." : note}`);
  }
}

const ref = loadRefTables();
const cal = loadCalendar();
const sittings = workingDays(HORIZON_START, HORIZON_END, cal);
console.log(`Data folder: ${DATA_DIR}`);
console.log(`Calendar ${cal.first} to ${cal.last}: ${cal.workingDays.size} working days, ${cal.holidays.size} holidays`);
console.log(`Horizon ${HORIZON_START} to ${HORIZON_END}: ${sittings.length} sittings, ${sittings.length * 420} bench minutes at 420 a day`);

console.log("\nPUCAR per-type tables (minutes, days to next hearing, P(substantive), recorded failures, top failure reasons)");
for (const t of HEARING_TYPES) {
  const r = ref[t as HearingType];
  const top = FAILURE_REASONS.filter((x) => r.failureShare[x] > 0)
    .sort((a, b) => r.failureShare[b] - r.failureShare[a])
    .slice(0, 3)
    .map((x) => `${x} ${pct(r.failureShare[x])}`)
    .join(", ");
  const src = r.pSubstantiveSource === "estimated" || r.failureSource === "estimated" ? " (partly estimated)" : "";
  console.log(`  ${pad(t, 30)}${lpad(r.durationMin, 4)}m${lpad(r.gapDays, 4)}d${lpad(pct(r.pSubstantive), 8)}${lpad(r.failureCount, 5)}  ${top}${src}`);
}

const args = process.argv.slice(2);
const paths = args.length
  ? args.map((p) => resolve(p))
  : [join(DATA_DIR, "roster_sample_100.csv"), resolve(import.meta.dir, "../data/roster_3000_seed42.csv")];
for (const p of paths) profile(p.split("/").at(-1)!, loadRoster(p));
