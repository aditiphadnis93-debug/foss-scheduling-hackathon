// Writes web/fixtures/*.json: one example response per endpoint in web/API.md, from PUCAR's seed-42 roster and
// the sample-data stand-ins in web/mock. Run: bun run web/fixtures/build.ts
// The engine does not read these; they are the console's sample data and the contract's worked examples.

import { caseById, health, meta } from "../mock/index";
import { planDay } from "../mock/planner";
import { compare, evidence, simulate, startState } from "../mock/model";
import { loadRoster } from "../mock/roster";
import { PRESETS } from "../mock/planner";

const dir = new URL(".", import.meta.url).pathname;
const write = async (name: string, x: unknown) => {
  const s = JSON.stringify(x, null, 1);
  await Bun.write(dir + name + ".json", s);
  console.log(`${name}.json  ${(s.length / 1024).toFixed(0)} KB`);
};

const rows = await loadRoster();
const byId = new Map(rows.map((r) => [r.id, r]));
const start = startState(rows);
const date = "2026-10-01";

await write("meta", meta());
const plan = planDay(rows, byId, { date, policy: "benchtime" });
await write("plan", { ...plan, unconstrained: null, delta: null });
// the same day with two overrides: pin the oldest deferred case, drop the last listed matter
const pinId = [...plan.deferred].sort((a, b) => b.case.ageYears - a.case.ageYears)[0]!.caseId;
const dropId = plan.listings.filter((l) => !l.standby).slice(-1)[0]!.caseId;
const over = planDay(rows, byId, { date, policy: "benchtime", pin: [pinId], drop: [dropId] });
const e = over.expected, f = plan.expected;
await write("plan-overrides", {
  ...over,
  unconstrained: f,
  delta: { listed: e.listed - f.listed, substantive: +(e.substantive - f.substantive).toFixed(1), minutes: +(e.minutes - f.minutes).toFixed(1), utilisation: +(e.utilisation - f.utilisation).toFixed(3), overrunRisk: +(e.overrunRisk - f.overrunRisk).toFixed(3), minutes4yPlus: +(e.minutes4yPlus - f.minutes4yPlus).toFixed(1) },
});
await write("simulate", simulate(rows, start, { policy: "benchtime" }));
await write("compare", compare(rows, start, { a: { policy: "benchtime" }, b: { policy: "benchtime", config: PRESETS.find((p) => p.id === "sehgal")!.config } }));
await write("health", await health(date, "benchtime"));
await write("evidence", evidence(rows, start));
await write("case", await caseById(plan.listings[0]!.caseId, date));
