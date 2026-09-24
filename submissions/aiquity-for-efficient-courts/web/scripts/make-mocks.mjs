#!/usr/bin/env node
/**
 * Deterministic generator for the demo mocks used by /world and /people until the
 * engine exports land:
 *   public/data/world_demo.json   (shape of causelist.world.export.export_world)
 *   public/data/agents_demo.json  (shape of causelist.agents.export.export_agents)
 *
 * Everything here is synthetic: invented town, invented people, template rationales.
 * Run:  node scripts/make-mocks.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "public", "data");

// ---------- deterministic rng ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260928);
const rand = (a = 0, b = 1) => a + (b - a) * rng();
const randint = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const pad = (n, w = 3) => String(n).padStart(w, "0");

// ---------- calendar: reuse the sitting days of the precomputed run ----------
let days = [];
const runPath = join(dataDir, "run_100_baseline.json");
if (existsSync(runPath)) {
  try {
    days = JSON.parse(readFileSync(runPath, "utf8")).days.map((d) => d.date);
  } catch {
    days = [];
  }
}
if (days.length < 20) {
  const d = new Date("2026-09-28T00:00:00Z");
  while (days.length < 52) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
}
const N = days.length;

// ---------- the town ----------
const COURT = { x: 500, y: 500 };
const HOODS = [
  { id: "N1", name: "Riverbend", angle: -0.35, r: 300 },
  { id: "N2", name: "Old Market", angle: 0.75, r: 270 },
  { id: "N3", name: "Mill Colony", angle: 1.8, r: 330 },
  { id: "N4", name: "Hilltop", angle: 2.75, r: 290 },
  { id: "N5", name: "Lakeside", angle: 3.85, r: 320 },
  { id: "N6", name: "Station Row", angle: 4.95, r: 280 },
].map((h) => ({
  ...h,
  x: round(COURT.x + Math.cos(h.angle) * h.r, 0),
  y: round(COURT.y + Math.sin(h.angle) * h.r, 0),
}));

const GIVEN = [
  "Asha", "Bharat", "Chitra", "Devan", "Esha", "Farid", "Gauri", "Hari", "Ila", "Jai",
  "Kavya", "Lalit", "Mira", "Nikhil", "Oma", "Pranav", "Rhea", "Sameer", "Tara", "Uday",
  "Vani", "Yash", "Zoya", "Arjun", "Bela", "Chetan", "Diya", "Ekam", "Hema", "Ishan",
  "Juhi", "Kiran", "Lata", "Manav", "Neel", "Pooja", "Ravi", "Sana", "Tanvi", "Varun",
];
const FAMILY = ["Amberkar", "Brightwell", "Coralwala", "Dunewal", "Emberly", "Fernhall", "Glenmoor",
  "Harrowby", "Ivorik", "Juniper", "Kestrel", "Larkspur", "Marlowe", "Northam", "Oakhurst",
  "Pebblewood", "Quillon", "Rowntree", "Saltmarsh", "Thornby", "Umberfield", "Vellacott",
  "Willowmere", "Yarrowby"];
const OCC = [
  ["weaver", 520], ["grocer", 700], ["mason", 650], ["tailor", 560], ["driver", 600],
  ["farm hand", 450], ["teacher", 900], ["mechanic", 720], ["vendor", 480], ["clerk", 800],
  ["carpenter", 680], ["potter", 500], ["nurse", 850], ["baker", 600], ["electrician", 760],
];

const people = [];
const households = [];
const places = [{ id: "COURT", kind: "court", name: "District Court", x: COURT.x, y: COURT.y }];
let pid = 0;
for (const h of HOODS) {
  places.push({ id: `C-${h.id}`, kind: "neighbourhood", name: h.name, x: h.x, y: h.y, neighbourhood: h.id });
  const nHouse = randint(8, 10);
  for (let k = 0; k < nHouse; k++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(35, 115);
    const hx = round(h.x + Math.cos(a) * r, 0);
    const hy = round(h.y + Math.sin(a) * r, 0);
    const hid = `H${pad(households.length + 1)}`;
    const fam = pick(FAMILY);
    households.push({ id: hid, x: hx, y: hy, neighbourhood: h.id });
    const size = randint(2, 4);
    for (let m = 0; m < size; m++) {
      pid++;
      const [occupation, wage] = pick(OCC);
      people.push({
        id: `P${pad(pid)}`,
        name: `${pick(GIVEN)} ${fam}`,
        x: round(hx + rand(-6, 6), 0),
        y: round(hy + rand(-6, 6), 0),
        neighbourhood: h.id,
        occupation,
        household: hid,
        daily_wage: wage + randint(-60, 60),
      });
    }
  }
  const nBiz = randint(3, 5);
  const BIZ = ["tea stall", "hardware store", "textile shop", "pharmacy", "grain depot", "print shop", "bakery", "cycle repair"];
  for (let b = 0; b < nBiz; b++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(12, 40);
    places.push({
      id: `B-${h.id}-${b + 1}`,
      kind: "business",
      name: `${h.name} ${pick(BIZ)}`,
      x: round(h.x + Math.cos(a) * r, 0),
      y: round(h.y + Math.sin(a) * r, 0),
      neighbourhood: h.id,
    });
  }
}
for (const hh of households) places.push({ id: hh.id, kind: "home", name: `Home ${hh.id}`, x: hh.x, y: hh.y, neighbourhood: hh.neighbourhood });

const ADV_GIVEN = ["Adv. Nair-Vale", "Adv. Oakes", "Adv. Pemberton", "Adv. Quartermain", "Adv. Rao-Linden",
  "Adv. Sterling", "Adv. Tamsin", "Adv. Umber", "Adv. Vasquez-Hale", "Adv. Wren", "Adv. Xavier-Moor", "Adv. Yardley"];
const advocates = ADV_GIVEN.map((name, i) => {
  const a = (i / ADV_GIVEN.length) * Math.PI * 2 + 0.2;
  const r = rand(85, 140);
  return { id: `A${pad(i + 1, 2)}`, name, x: round(COURT.x + Math.cos(a) * r, 0), y: round(COURT.y + Math.sin(a) * r, 0) };
});
for (const a of advocates) places.push({ id: `O-${a.id}`, kind: "chambers", name: `${a.name} chambers`, x: a.x, y: a.y });

// ---------- relationships ----------
const byHood = Object.fromEntries(HOODS.map((h) => [h.id, people.filter((p) => p.neighbourhood === h.id)]));
const edges = [];
const edgeKey = new Set();
function addEdge(a, b, kind, amount) {
  if (a.id === b.id || a.household === b.household) return false;
  const k = [a.id, b.id].sort().join("|");
  if (edgeKey.has(k)) return false;
  edgeKey.add(k);
  edges.push({ from: a.id, to: b.id, kind, ...(amount ? { amount } : {}) });
  return true;
}
for (let i = 0; i < 170; i++) {
  const a = pick(people);
  const cross = chance(0.25);
  const b = cross ? pick(people) : pick(byHood[a.neighbourhood]);
  const kind = chance(0.62) ? "owes" : pick(["trade", "tenant", "employs"]);
  addEdge(a, b, kind, kind === "owes" ? randint(8, 180) * 500 : undefined);
}

// ---------- dispute lifecycle ----------
const KINDS = {
  owes: ["cheque_bounce", "unpaid_loan"],
  trade: ["supplier_dues", "cheque_bounce"],
  tenant: ["rent_arrears"],
  employs: ["wage_dues"],
};
const KIND_TEXT = {
  cheque_bounce: "a cheque that bounced",
  unpaid_loan: "a loan not repaid",
  supplier_dues: "unpaid supplier dues",
  rent_arrears: "months of unpaid rent",
  wage_dues: "wages held back",
};
const PURPOSES = ["ADMISSION", "COGNIZANCE", "APPEARANCE", "PLEA", "EXAMINATION_UNDER_S351_BNSS",
  "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"];
const PRETTY = (p) => p.toLowerCase().replace(/_/g, " ").replace("s351 bnss", "S351 BNSS");
const REASONS = {
  adjourned: ["Respondent Absence / Non-Compliance", "Petitioner Absence / Non-Compliance",
    "Party Sought Time / Adjournment", "Both Parties Unready / Absent"],
  not_ready: ["Awaiting Process / Summons / Warrant Return", "Evidence / Filing Not Ready"],
  not_reached: [null],
};
const WINDOWS = ["10:30-11:15", "11:15-12:00", "12:00-12:45", "14:15-15:00", "15:00-15:45", "15:45-16:30"];

const personById = Object.fromEntries(people.map((p) => [p.id, p]));
const owesEdges = edges.filter((e) => e.kind !== undefined);
const disputeEdges = [...owesEdges].sort(() => rng() - 0.5).slice(0, 38);

const disputes = [];
const events = Array.from({ length: N }, () => []);
const stateByDay = Array.from({ length: N }, () => ({}));
const hearingsByDay = Array.from({ length: N }, () => []);
let caseSeq = 0;

function nameOf(id) {
  return personById[id]?.name ?? id;
}

disputeEdges.forEach((e, idx) => {
  const hero = idx < 3; // a few disputes run the whole road inside the window (for the director)
  const [a, b] = chance(0.5) ? [e.from, e.to] : [e.to, e.from];
  const kind = pick(KINDS[e.kind] ?? ["unpaid_loan"]);
  const d0 = hero ? idx * 2 : randint(0, Math.floor(N * 0.6));
  const id = `D${pad(idx + 1)}`;
  const amount = e.amount ?? randint(10, 120) * 500;
  const tl = [];
  const dispute = { id, parties: [a, b], complainant: a, respondent: b, kind, amount, start_day: days[d0], timeline: tl };
  const push = (di, ev) => {
    tl.push({ day: days[di], ...ev });
    events[di].push({ ...ev, dispute_id: id, case_id: dispute.case_id ?? null, person_ids: ev.person_ids ?? [a, b] });
  };
  const mark = (from, to, st) => {
    for (let d = from; d < Math.min(N, to); d++) for (const p of [a, b]) stateByDay[d][p] = st;
  };

  push(d0, { type: "quarrel", text: `${nameOf(a)} and ${nameOf(b)} fall out over ${KIND_TEXT[kind]} (Rs ${amount.toLocaleString("en-IN")}).` });
  let resolved = null;

  const escalate = hero || chance(0.72);
  if (!escalate) {
    const dr = Math.min(N - 1, d0 + randint(3, 12));
    mark(d0, dr, "in_dispute");
    if (chance(0.7) && dr < N - 1) {
      push(dr, { type: "resolved", resolution: "settled_privately", text: `${nameOf(b)} pays up; the neighbours make peace without a lawyer.` });
      resolved = dr;
    }
  } else {
    const dn = Math.min(N - 1, d0 + randint(2, 5));
    mark(d0, dn, "in_dispute");
    push(dn, { type: "notice", text: `${nameOf(a)} sends a legal notice to ${nameOf(b)}: pay within 15 days.` });
    const settleAfterNotice = !hero && chance(0.2);
    if (settleAfterNotice) {
      const dr = Math.min(N - 1, dn + randint(3, 8));
      mark(dn, dr, "in_dispute");
      push(dr, { type: "resolved", resolution: "paid_after_notice", text: `The notice works: ${nameOf(b)} pays and the matter ends.` });
      resolved = dr;
    } else {
      const df = Math.min(N - 1, dn + (hero ? 3 : randint(4, 9)));
      mark(dn, df, "in_dispute");
      caseSeq++;
      dispute.case_id = `W-${pad(caseSeq)}`;
      const advC = pick(advocates).id;
      let advR = pick(advocates).id;
      if (advR === advC) advR = advocates[(advocates.findIndex((x) => x.id === advC) + 3) % advocates.length].id;
      dispute.advocate_ids = [advC, advR];
      dispute.filed_day = days[df];
      push(df, { type: "filed", text: `${nameOf(a)} files case ${dispute.case_id} against ${nameOf(b)} at the District Court.`, advocate_ids: [advC] });
      let stage = 0;
      let d = Math.min(N - 1, df + randint(2, 4));
      let last = df;
      let absentStreak = 0;
      while (d < N && resolved === null) {
        mark(last + 1, d, "in_dispute");
        const purpose = PURPOSES[stage];
        // who turns up?
        const pRespAbsent = 0.18 + absentStreak * 0.1;
        const respAbsent = !hero || stage > 1 ? chance(pRespAbsent) : chance(0.25);
        const compAbsent = chance(0.08);
        let kindO;
        let reason = null;
        const u = rng();
        if (u < 0.1) { kindO = "not_ready"; reason = pick(REASONS.not_ready); }
        else if (u < 0.2) { kindO = "not_reached"; }
        else if (respAbsent || compAbsent) {
          kindO = "adjourned";
          reason = respAbsent && compAbsent ? "Both Parties Unready / Absent" : respAbsent ? "Respondent Absence / Non-Compliance" : "Petitioner Absence / Non-Compliance";
        } else if (u < (hero ? 0.28 : 0.38)) { kindO = "adjourned"; reason = "Party Sought Time / Adjournment"; }
        else kindO = "substantive";
        if (hero && stage >= 2 && kindO !== "substantive" && chance(0.45)) { kindO = "substantive"; reason = null; }
        absentStreak = respAbsent ? absentStreak + 1 : 0;

        const gap = kindO === "substantive" ? randint(hero ? 2 : 4, hero ? 4 : 9) : randint(hero ? 2 : 3, hero ? 5 : 10);
        const isJudgment = purpose === "JUDGEMENT" && kindO === "substantive";
        const compounded = !isJudgment && kindO === "substantive" && stage >= 3 && !hero && chance(0.18);
        const nextDi = d + gap;
        const nextDay = isJudgment || compounded ? null : nextDi < N ? days[nextDi] : null;
        const nextPurpose = kindO === "substantive" ? PURPOSES[Math.min(stage + 1, PURPOSES.length - 1)] : purpose;
        const attended = [];
        const absent = [];
        (compAbsent ? absent : attended).push(a);
        (respAbsent ? absent : attended).push(b);
        const window = pick(WINDOWS);
        const minutes = kindO === "not_reached" ? 0 : kindO === "substantive" ? randint(8, 30) : randint(2, 6);
        const outcomeText = {
          substantive: isJudgment ? "Judgment delivered." : compounded ? "The parties compound the offence before the judge." : `Heard. Moves to ${PRETTY(nextPurpose)}.`,
          adjourned: `Adjourned: ${String(reason).toLowerCase()}.`,
          not_reached: "The day ran out before the case was called.",
          not_ready: `Not ready: ${String(reason).toLowerCase()}.`,
        }[kindO];
        const hearing = {
          type: isJudgment ? "judgment" : "hearing",
          purpose,
          outcome: kindO,
          reason,
          minutes,
          listed_window: window,
          next_date: nextDay,
          next_purpose: nextDay ? nextPurpose : null,
          attended,
          absent,
          advocate_ids: [advC, advR],
          text: `${dispute.case_id} ${PRETTY(purpose)}: ${outcomeText}${nextDay ? ` Next date ${nextDay}.` : ""}`,
        };
        push(d, hearing);
        hearingsByDay[d].push({ dispute, hearing, a, b, advC, advR });
        for (const p of attended) stateByDay[d][p] = "in_court";
        for (const p of absent) stateByDay[d][p] = "in_dispute";
        if (isJudgment || compounded) {
          const convicted = isJudgment ? chance(0.6) : false;
          dispute.judgment = isJudgment ? (convicted ? "convicted_compensation" : "acquitted") : "compounded";
          const res = isJudgment
            ? convicted ? `${nameOf(b)} is ordered to pay compensation to ${nameOf(a)}.` : `${nameOf(b)} is acquitted; the matter is closed.`
            : `${nameOf(a)} and ${nameOf(b)} settle in court.`;
          const dr = Math.min(N - 1, d + 1);
          if (dr > d) push(dr, { type: "resolved", resolution: dispute.judgment, text: `Resolved. ${res}` });
          resolved = dr;
          break;
        }
        if (kindO === "substantive") stage++;
        last = d;
        d = nextDi;
      }
      if (resolved === null) mark(last + 1, N, "in_dispute");
    }
  }
  if (resolved !== null) {
    dispute.resolved_day = days[resolved];
    mark(resolved, N, "resolved");
  }
  dispute.state_end = resolved !== null ? "resolved" : dispute.case_id ? "in_court" : "in_dispute";
  disputes.push(dispute);
});

// ---------- per-day timeline ----------
const timeline = [];
const funnel = [];
let cum = { disputes: 0, notices: 0, filed: 0, resolved: 0 };
for (let d = 0; d < N; d++) {
  const ps = {};
  for (const p of people) ps[p.id] = stateByDay[d][p.id] ?? "calm";
  let trips = 0;
  let wages = 0;
  for (const h of hearingsByDay[d]) {
    trips += h.hearing.attended.length + 2;
    if (h.hearing.outcome !== "substantive") {
      for (const p of h.hearing.attended) wages += personById[p].daily_wage;
    }
  }
  for (const ev of events[d]) {
    if (ev.type === "quarrel") cum.disputes++;
    if (ev.type === "notice") cum.notices++;
    if (ev.type === "filed") cum.filed++;
    if (ev.type === "resolved") cum.resolved++;
  }
  const inCourt = disputes.filter((x) => x.filed_day && x.filed_day <= days[d] && (!x.resolved_day || x.resolved_day > days[d])).length;
  const f = { day: days[d], ...cum, in_court: inCourt };
  funnel.push(f);
  const active = disputes
    .filter((x) => x.start_day <= days[d] && (!x.resolved_day || x.resolved_day >= days[d]))
    .map((x) => ({
      id: x.id,
      parties: x.parties,
      kind: x.kind,
      state: x.resolved_day && x.resolved_day <= days[d] ? "resolved" : x.case_id && x.filed_day <= days[d] ? "in_court" : "in_dispute",
      ...(x.case_id && x.filed_day <= days[d] ? { case_id: x.case_id } : {}),
    }));
  timeline.push({ day: days[d], people_state: ps, trips, wages_lost: wages, disputes: active, events: events[d], funnel: f });
}

const world = {
  meta: {
    scenario: "demo",
    source: "mock",
    generator: "scripts/make-mocks.mjs",
    note: "Synthetic town for UI development. Replace with causelist.world.export.export_world output.",
    plane: [1000, 1000],
    court: COURT,
    start: days[0],
    end: days[N - 1],
  },
  neighbourhoods: HOODS.map(({ id, name, x, y }) => ({ id, name, x, y })),
  people,
  advocates,
  households,
  places,
  edges,
  days,
  timeline,
  disputes,
  funnel,
};
writeFileSync(join(dataDir, "world_demo.json"), JSON.stringify(world));

// ---------- agents ----------
const litigantIds = new Set();
for (const d of disputes) if (d.case_id) d.parties.forEach((p) => litigantIds.add(p));
const TRAITS = ["reliability", "patience", "means", "trust_in_court", "preparedness"];
function persona(role) {
  const t = Object.fromEntries(TRAITS.map((k) => [k, round(rand(0.2, 0.95), 2)]));
  if (role === "advocate") { t.caseload = round(rand(0.3, 1), 2); }
  return t;
}
function summary(role, t, extra) {
  const bits = [];
  if (t.reliability > 0.7) bits.push("shows up when listed"); else if (t.reliability < 0.4) bits.push("often skips listings");
  if (t.patience < 0.4) bits.push("hates waiting all day");
  if (t.means < 0.4) bits.push("cannot afford lost days");
  if (t.trust_in_court < 0.4) bits.push("doubts the case will be called");
  if (role === "advocate" && t.caseload > 0.75) bits.push("juggles several courts");
  return `${extra}${bits.length ? ", " + bits.join(", ") : ""}.`;
}
const agents = [];
for (const a of advocates) {
  const t = persona("advocate");
  agents.push({ id: a.id, role: "advocate", name: a.name, persona: { traits: t, summary: summary("advocate", t, "Practises at the District Court") }, case_ids: [] });
}
for (const pidx of litigantIds) {
  const p = personById[pidx];
  const t = persona("litigant");
  t.means = round(Math.min(0.95, Math.max(0.1, (p.daily_wage - 380) / 600)), 2);
  agents.push({ id: p.id, role: "litigant", name: p.name, occupation: p.occupation, neighbourhood: p.neighbourhood, persona: { traits: t, summary: summary("litigant", t, `A ${p.occupation} from ${HOODS.find((h) => h.id === p.neighbourhood).name}`) }, case_ids: [] });
}
const agentById = Object.fromEntries(agents.map((a) => [a.id, a]));
for (const d of disputes) {
  if (!d.case_id) continue;
  for (const id of [...d.parties, ...(d.advocate_ids ?? [])]) {
    const ag = agentById[id];
    if (ag && !ag.case_ids.includes(d.case_id)) ag.case_ids.push(d.case_id);
  }
}

const RAT = {
  appear_ready: [
    "The window is {w}. I can finish the morning shift and still make it; the papers are in order.",
    "Last time this went ahead, so I trust it will be called. Going, and I have the documents.",
    "My client has waited long enough. I have a {w} slot and I am prepared to argue.",
  ],
  appear_seek: [
    "I will go, but the witness is not ready. I will ask the court for a short date.",
    "I am appearing in another court at the same hour; I will seek time here.",
  ],
  absent: [
    "The last {n} listings were not reached. Losing another day's wage of Rs {wage} is not worth it.",
    "Nobody has served me any fresh papers. I will not go today.",
    "I cannot close the shop again this week; if it matters, the court will list it again.",
  ],
  absent_adv: [
    "Two matters in the higher court overlap with {w}. I will send a proxy request.",
  ],
};
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => String(o[k] ?? ""));
const journeys = Object.fromEntries(agents.map((a) => [a.id, []]));
const propensity = Object.fromEntries(agents.map((a) => [a.id, a.persona.traits.reliability]));
const drift = Object.fromEntries(agents.map((a) => [a.id, []]));
const wastedStreak = Object.fromEntries(agents.map((a) => [a.id, 0]));
const courtDays = [];

for (let d = 0; d < N; d++) {
  const hearings = [];
  for (const h of hearingsByDay[d]) {
    const { hearing, a, b, advC, advR, dispute } = h;
    const participants = [
      { id: a, side: "complainant" },
      { id: b, side: "accused" },
      { id: advC, side: "complainant_advocate" },
      { id: advR, side: "accused_advocate" },
    ];
    const decisions = [];
    for (const part of participants) {
      const ag = agentById[part.id];
      if (!ag) continue;
      const isAdv = ag.role === "advocate";
      const appear = isAdv ? chance(0.9) : hearing.attended.includes(part.id);
      const seek = appear && hearing.reason === "Party Sought Time / Adjournment" && (part.side === "accused" || part.side === "accused_advocate") ;
      const ready = appear && !seek && chance(0.85);
      const p = propensity[part.id];
      const person = personById[part.id];
      const wage = isAdv ? 0 : person?.daily_wage ?? 0;
      const wasted = appear && hearing.outcome !== "substantive";
      const waited = appear ? (hearing.outcome === "not_reached" ? randint(180, 330) : randint(15, 150)) : 0;
      const wagesLost = !isAdv && appear && wasted ? wage : !isAdv && appear ? Math.round(wage * 0.5) : 0;
      const tmpl = !appear ? (isAdv ? RAT.absent_adv : RAT.absent) : seek ? RAT.appear_seek : RAT.appear_ready;
      const rationale = fill(pick(tmpl), { w: hearing.listed_window, n: Math.max(1, wastedStreak[part.id]), wage });
      const step = {
        day: days[d],
        case_id: dispute.case_id,
        side: part.side,
        purpose: hearing.purpose,
        listed_window: hearing.listed_window,
        decision: {
          appear,
          ready,
          seek_adjournment: seek,
          p_appear: round(Math.min(0.99, Math.max(0.02, p + rand(-0.05, 0.05))), 2),
          p_ready: round(rand(0.45, 0.95), 2),
          p_seek: round(seek ? rand(0.4, 0.8) : rand(0.02, 0.25), 2),
        },
        rationale,
        outcome: { kind: hearing.outcome, reason: hearing.reason, next_date: hearing.next_date },
        trip_wasted: wasted,
        minutes_waited: waited,
        wages_lost: wagesLost,
      };
      journeys[part.id].push(step);
      decisions.push({ agent_id: part.id, side: part.side, appear, ready, seek_adjournment: seek, rationale });
      // propensity drifts: wasted trips erode it, substantive hearings restore it
      wastedStreak[part.id] = wasted || hearing.outcome === "not_reached" ? wastedStreak[part.id] + 1 : 0;
      const delta = hearing.outcome === "substantive" ? 0.04 : wasted ? -0.06 : -0.02;
      propensity[part.id] = round(Math.min(0.98, Math.max(0.05, p + delta)), 3);
    }
    hearings.push({ case_id: dispute.case_id, dispute_id: dispute.id, purpose: hearing.purpose, listed_window: hearing.listed_window, outcome: hearing.outcome, reason: hearing.reason, decisions });
  }
  for (const ag of agents) drift[ag.id].push({ day: days[d], p_appear: propensity[ag.id] });
  if (hearings.length) courtDays.push({ day: days[d], hearings });
}
for (const ag of agents) {
  ag.journey = journeys[ag.id];
  ag.propensity = drift[ag.id];
}

// aggregate: statistical model vs agents
const allSteps = agents.flatMap((a) => a.journey);
const litSteps = agents.filter((a) => a.role === "litigant").flatMap((a) => a.journey);
const appearRate = allSteps.filter((s) => s.decision.appear).length / Math.max(1, allSteps.length);
const allHearings = courtDays.flatMap((c) => c.hearings);
const share = (k) => allHearings.filter((h) => h.outcome === k).length / Math.max(1, allHearings.length);
const agg = {
  appearance_rate_pct: round(appearRate * 100),
  substantive_pct: round(share("substantive") * 100),
  adjourned_pct: round(share("adjourned") * 100),
  not_reached_pct: round(share("not_reached") * 100),
  not_ready_pct: round(share("not_ready") * 100),
  trips_wasted: litSteps.filter((s) => s.trip_wasted).length,
  mean_minutes_waited: round(litSteps.filter((s) => s.decision.appear).reduce((t, s) => t + s.minutes_waited, 0) / Math.max(1, litSteps.filter((s) => s.decision.appear).length)),
  wages_lost_total: litSteps.reduce((t, s) => t + s.wages_lost, 0),
};
const stat = {
  appearance_rate_pct: round(agg.appearance_rate_pct + 6.5),
  substantive_pct: round(agg.substantive_pct + 4.2),
  adjourned_pct: round(agg.adjourned_pct - 3.1),
  not_reached_pct: round(agg.not_reached_pct - 0.6),
  not_ready_pct: round(agg.not_ready_pct - 0.5),
  trips_wasted: Math.round(agg.trips_wasted * 0.82),
  mean_minutes_waited: round(agg.mean_minutes_waited * 0.9),
  wages_lost_total: Math.round(agg.wages_lost_total * 0.8),
};

const agentsOut = {
  meta: {
    scenario: "demo",
    source: "mock",
    recorded: false,
    rationale_source: "template",
    generator: "scripts/make-mocks.mjs",
    note: "Synthetic agents with template rationales. Replace with causelist.agents.export.export_agents output.",
    start: days[0],
    end: days[N - 1],
    days,
  },
  agents,
  court_days: courtDays,
  aggregate: {
    statistical: stat,
    agents: agg,
    labels: {
      appearance_rate_pct: "Sides that turn up (%)",
      substantive_pct: "Hearings that move the case (%)",
      adjourned_pct: "Adjourned (%)",
      not_reached_pct: "Not reached (%)",
      not_ready_pct: "Not ready (%)",
      trips_wasted: "Wasted trips (litigants)",
      mean_minutes_waited: "Mean minutes waited",
      wages_lost_total: "Wages lost (Rs)",
    },
    lower_is_better: ["adjourned_pct", "not_reached_pct", "not_ready_pct", "trips_wasted", "mean_minutes_waited", "wages_lost_total"],
  },
};
writeFileSync(join(dataDir, "agents_demo.json"), JSON.stringify(agentsOut));

console.log(`world_demo.json: ${people.length} people, ${households.length} homes, ${disputes.length} disputes, ${caseSeq} cases, ${N} days`);
console.log(`agents_demo.json: ${agents.length} agents, ${courtDays.length} court days, ${allSteps.length} journey steps`);
