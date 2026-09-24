/**
 * World board data: types + a defensive loader/normaliser for `world_<scenario>.json`.
 *
 * Primary shape: schema "town-world/1" from causelist.world.export.export_world
 * (places object, relationships creditor->debtor, delta-encoded people_state, per-person
 * trip/wage deltas, dispute stories). The demo mock from scripts/make-mocks.mjs uses a
 * flatter shape (places array, edges, full people_state); both are accepted.
 *
 * The normaliser never trusts the file: any list may be missing, ids may be unknown.
 * Output is dense, index-based arrays that the 3D scene reads every frame.
 */

export type OutcomeKind = "substantive" | "adjourned" | "not_reached" | "not_ready";

export type RawPerson = {
  id: string; name?: string; x: number; y: number; neighbourhood?: string; occupation?: string;
  household?: string | number; wage?: number; daily_wage?: number;
};
export type RawAdvocate = { id: string; name?: string; x?: number; y?: number; adopted?: boolean };
export type RawPlace = { id?: string; kind?: string; name?: string; x: number; y: number; neighbourhood?: string; radius?: number; owner_id?: string };
export type RawEvent = {
  type: string; day?: string; person_ids?: string[]; dispute_id?: string | null; case_id?: string | null; text?: string;
  outcome?: string | null; reason?: string | null; purpose?: string | null; next_date?: string | null;
  advocate_id?: string; advocate_ids?: string[]; attended?: string[]; wages_lost?: number; amount?: number; source?: string;
};
export type RawDisputeRow = { id: string; parties?: string[]; kind?: string; state?: string; case_id?: string | null };
export type RawDispute = RawDisputeRow & {
  origin?: string; complainant_id?: string; accused_id?: string; amount?: number; advocate_id?: string | null; advocate_ids?: string[];
  started?: string; start_day?: string; filed_on?: string | null; filed_day?: string; resolved_on?: string | null; resolved_day?: string;
  resolution?: string | null; final_state?: string; state_end?: string; judgment?: string; court_stage?: string;
  hearings?: number; adjournments?: number; story?: string; timeline?: RawEvent[];
  kind_label?: string; forum?: string; relationship?: string; money_at_stake?: number; case_ids?: string[];
};
export type RawDay = {
  day?: string;
  people_state?: Record<string, string>;
  deltas?: Record<string, [number, number]>;
  trips?: number; wages_lost?: number;
  disputes?: RawDisputeRow[];
  events?: RawEvent[];
  court?: { listed?: number; filed?: number; lines?: { case_id: string; dispute_id?: string | null; origin?: string; window?: string; purpose?: string; advocate_id?: string; outcome?: string | null; reason?: string | null; next_date?: string | null }[] };
  funnel?: Record<string, number>;
  totals?: { people_by_state?: Record<string, number>; trips?: number; wages_lost?: number };
};
export type WorldFile = {
  schema?: string;
  meta?: Record<string, unknown>;
  places?: RawPlace[] | { court?: RawPlace; neighbourhoods?: RawPlace[]; businesses?: RawPlace[] };
  neighbourhoods?: RawPlace[];
  people?: RawPerson[];
  advocates?: RawAdvocate[];
  relationships?: { kind?: string; creditor_id?: string; debtor_id?: string; from?: string; to?: string }[];
  edges?: { kind?: string; from?: string; to?: string }[];
  days?: string[];
  prelude?: { events?: RawEvent[] };
  timeline?: RawDay[];
  disputes?: RawDispute[];
  funnel?: Record<string, number>[] | PopulationFunnel;
};

/** top-level world funnel: from population to this court (every rate carries its source) */
export type SourcedValue = { value: number; source?: string };
export type PopulationFunnel = {
  config?: {
    city_population?: SourcedValue;
    kinds?: Record<string, { label?: string; relationship?: string; forum?: string; per_1000_per_year?: SourcedValue; stages?: Record<string, SourcedValue> }>;
  };
  stages?: string[];
  window_days?: number;
  expected_filings_per_sitting_day?: number;
  observed_filings_per_sitting_day?: number;
  expected_per_year?: Record<string, Record<string, number>>;
  observed_in_window?: Record<string, Record<string, number>>;
  table?: Record<string, unknown>[];
};

// ---------------------------------------------------------------- normalised model

export const PERSON_STATES = ["calm", "in_dispute", "in_court", "resolved"] as const;
const STATE_CODE: Record<string, number> = { calm: 0, in_dispute: 1, in_court: 2, resolved: 3 };

export type Hood = { name: string; x: number; y: number; radius: number };
export type Home = { key: string; x: number; y: number; hood: number; size: number };
export type Person = { id: string; name: string; x: number; y: number; hood: number; home: number; occupation: string; wage: number; neighbourhood: string };
export type Advocate = { id: string; name: string; x: number; y: number };
export type Place = { id: string; name: string; kind: string; x: number; y: number };

export type Hearing = {
  disputeIdx: number;
  caseId: string | null;
  outcome: OutcomeKind;
  reason: string | null;
  purpose: string | null;
  nextDate: string | null;
  travellers: number[]; // person indices who walk to court
  advocates: number[];
  judgment: boolean;
  text: string;
};

export type CourtLine = {
  caseId: string; disputeIdx: number; origin: string; window: string; purpose: string; advocate: string;
  outcome: OutcomeKind | null; reason: string | null; nextDate: string | null; stakeholder: string | null;
  /** minutes the hearing actually took, and the planner's expected minutes (null when not in the data) */
  minutes: number | null; expMin: number | null;
};

export type FunnelStage = { key: string; label: string; value: number };

export type DayModel = {
  date: string;
  states: Uint8Array; // per person state code
  hearings: Hearing[];
  filings: number[]; // dispute indices filed today
  quarrels: number[];
  notices: number[];
  resolutions: number[];
  events: RawEvent[];
  trips: number;
  wages: number;
  tripsCum: number;
  wagesCum: number;
  listed: number;
  lines: CourtLine[]; // that day's causelist in the same simulation as the town
  sittings: unknown; // raw sitting_windows for the day, when the export carries them
  funnel: FunnelStage[];
  byState: number[]; // counts per state
};

export type DisputeStep = { day: string; dayIdx: number; type: string; text: string; outcome: OutcomeKind | null; reason: string | null; source: string };

export type Dispute = {
  id: string;
  a: number; // complainant person index
  b: number; // accused person index
  kind: string;
  kindLabel: string | null;
  forum: string | null;
  /** days the court published a provisional date for this case (horizon planner) */
  published: string[];
  origin: string;
  amount: number | null;
  caseId: string | null;
  advocates: number[];
  steps: DisputeStep[];
  startDay: number; // may be < 0 when it began before the window
  filedDay: number | null;
  endDay: number | null;
  finalState: string;
  story: string;
  hearings: number;
};

export type World = {
  scenario: string;
  source: string;
  label: string;
  court: { x: number; y: number; name: string };
  hoods: Hood[];
  people: Person[];
  advocates: Advocate[];
  homes: Home[];
  businesses: Place[];
  edges: Uint32Array; // pairs of person indices
  disputes: Dispute[];
  days: DayModel[];
  personIndex: Map<string, number>;
  disputeIndex: Map<string, number>;
  /** disputes each person is party to */
  disputesOf: number[][];
  /** window totals per person (trips made, wages lost) */
  personTrips: Float64Array;
  personWages: Float64Array;
  /** case id -> dispute index */
  disputeOfCase: Map<string, number>;
  /** from population to court, when the export carries it */
  population: PopulationFunnel | null;
};

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const OUTCOMES: OutcomeKind[] = ["substantive", "adjourned", "not_reached", "not_ready"];
const asOutcome = (v: unknown): OutcomeKind | null => (OUTCOMES.includes(v as OutcomeKind) ? (v as OutcomeKind) : null);

const QUARREL = new Set(["quarrel", "dispute", "dispute_started", "adopted"]);
const NOTICE = new Set(["legal_notice", "notice"]);
const FILED = new Set(["complaint_filed", "filed", "filing"]);
const RESOLVED = new Set(["settled_pre_court", "dropped", "settled_in_court", "judgement", "judgment", "resolved", "settled"]);
const HEARING = new Set(["hearing", "judgment"]);

/** the five stages the HUD shows, with the keys that feed each (first matching set wins, sets sum) */
const FUNNEL_VIEW: { label: string; keys: string[][] }[] = [
  { label: "Disputes", keys: [["arisen"], ["disputes"]] },
  { label: "Notices", keys: [["notice_sent"], ["notices"]] },
  { label: "Filed", keys: [["filed"]] },
  { label: "In court", keys: [["in_court_now"], ["in_court"]] },
  { label: "Resolved", keys: [["settled_pre_court", "dropped", "settled_in_court", "judgement"], ["resolved"]] },
];

function funnelView(f: Record<string, number>): FunnelStage[] {
  return FUNNEL_VIEW.map((v) => {
    for (const ks of v.keys) if (ks.some((k) => k in f)) return { key: ks.join("+"), label: v.label, value: ks.reduce((s, k) => s + num(f[k]), 0) };
    return { key: v.label, label: v.label, value: 0 };
  });
}

export function normaliseWorld(raw: WorldFile, scenario = "demo"): World {
  const meta = (raw.meta ?? {}) as Record<string, unknown>;

  // ---- places (object form or array form)
  let court = { x: 500, y: 500, name: "Court" };
  let hoodPlaces: RawPlace[] = [];
  let bizPlaces: RawPlace[] = [];
  if (Array.isArray(raw.places)) {
    const ps = raw.places.filter((p) => p && typeof p.x === "number");
    const c = ps.find((p) => p.kind === "court");
    if (c) court = { x: c.x, y: c.y, name: c.name ?? "Court" };
    hoodPlaces = ps.filter((p) => p.kind === "neighbourhood");
    bizPlaces = ps.filter((p) => p.kind === "business" || p.kind === "shop");
  } else if (raw.places && typeof raw.places === "object") {
    const c = raw.places.court;
    if (c && typeof c.x === "number") court = { x: c.x, y: c.y, name: c.name ?? "Court" };
    hoodPlaces = (raw.places.neighbourhoods ?? []).filter((p) => p && typeof p.x === "number");
    bizPlaces = (raw.places.businesses ?? []).filter((p) => p && typeof p.x === "number");
  }
  if (!hoodPlaces.length && Array.isArray(raw.neighbourhoods)) hoodPlaces = raw.neighbourhoods;

  const rawPeople = (Array.isArray(raw.people) ? raw.people : []).filter((p) => p && p.id != null);
  let hoods: Hood[] = hoodPlaces.map((h) => ({ name: String(h.name ?? h.id ?? "Quarter"), x: h.x, y: h.y, radius: num(h.radius, 120) }));
  if (!hoods.length) {
    const acc = new Map<string, { sx: number; sy: number; n: number }>();
    for (const p of rawPeople) {
      const k = String(p.neighbourhood ?? "Town");
      const a = acc.get(k) ?? { sx: 0, sy: 0, n: 0 };
      a.sx += num(p.x); a.sy += num(p.y); a.n++;
      acc.set(k, a);
    }
    hoods = [...acc.entries()].map(([k, a]) => ({ name: k, x: a.sx / a.n, y: a.sy / a.n, radius: 120 }));
  }
  const hoodByLabel = new Map<string, number>();
  hoods.forEach((h, i) => hoodByLabel.set(h.name, i));
  hoodPlaces.forEach((h, i) => { if (h.neighbourhood) hoodByLabel.set(String(h.neighbourhood), i); if (h.id) hoodByLabel.set(String(h.id), i); });
  const nearestHood = (x: number, y: number) => {
    let best = 0, bd = Infinity;
    hoods.forEach((h, i) => { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };

  // ---- homes = households
  const homeAcc = new Map<string, { sx: number; sy: number; n: number }>();
  for (const p of rawPeople) {
    const k = String(p.household ?? `solo-${p.id}`);
    const a = homeAcc.get(k) ?? { sx: 0, sy: 0, n: 0 };
    a.sx += num(p.x); a.sy += num(p.y); a.n++;
    homeAcc.set(k, a);
  }
  const homes: Home[] = [];
  const homeIdx = new Map<string, number>();
  for (const [k, a] of homeAcc) {
    const x = a.sx / a.n, y = a.sy / a.n;
    homeIdx.set(k, homes.length);
    homes.push({ key: k, x, y, hood: nearestHood(x, y), size: a.n });
  }

  const people: Person[] = rawPeople.map((p) => {
    const x = num(p.x, 500), y = num(p.y, 500);
    const lab = p.neighbourhood != null ? String(p.neighbourhood) : "";
    const hood = hoodByLabel.get(lab) ?? nearestHood(x, y);
    return {
      id: String(p.id), name: String(p.name ?? p.id), x, y, hood,
      home: homeIdx.get(String(p.household ?? `solo-${p.id}`)) ?? 0,
      occupation: String(p.occupation ?? "resident"), wage: num(p.wage, num(p.daily_wage, 0)),
      neighbourhood: hoods[hood]?.name ?? lab,
    };
  });
  const personIndex = new Map(people.map((p, i) => [p.id, i]));

  const advocates: Advocate[] = (Array.isArray(raw.advocates) ? raw.advocates : [])
    .filter((a) => a && a.id != null)
    .map((a, i) => {
      const ang = i * 2.39996;
      const r = 70 + (i % 7) * 12;
      return { id: String(a.id), name: String(a.name ?? a.id), x: num(a.x, court.x + Math.cos(ang) * r), y: num(a.y, court.y + Math.sin(ang) * r) };
    });
  const advocateIndex = new Map(advocates.map((a, i) => [a.id, i]));

  const businesses: Place[] = bizPlaces.map((b, i) => ({ id: String(b.id ?? `B${i}`), name: String(b.name ?? "Shop"), kind: String(b.kind ?? "shop"), x: b.x, y: b.y }));

  const rels = Array.isArray(raw.relationships) ? raw.relationships : Array.isArray(raw.edges) ? raw.edges : [];
  const edgeArr: number[] = [];
  for (const r of rels) {
    const rr = r as { creditor_id?: string; debtor_id?: string; from?: string; to?: string };
    const a = personIndex.get(String(rr.creditor_id ?? rr.from));
    const b = personIndex.get(String(rr.debtor_id ?? rr.to));
    if (a != null && b != null && a !== b) edgeArr.push(a, b);
  }

  // ---- days
  const tl = Array.isArray(raw.timeline) ? raw.timeline : [];
  let dayList: string[] = Array.isArray(raw.days) && raw.days.length ? raw.days.map(String) : tl.map((t, i) => String(t.day ?? `D${i + 1}`));
  if (!dayList.length) dayList = [String(meta.start ?? "2026-01-01")];
  const dayIdx = new Map(dayList.map((d, i) => [d, i]));
  /** index of the sitting day an ISO date rolls forward to (events on non-sitting days) */
  const dayOf = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const exact = dayIdx.get(iso);
    if (exact != null) return exact;
    if (iso < dayList[0]) return -1;
    for (let i = 0; i < dayList.length; i++) if (dayList[i] >= iso) return i;
    return dayList.length; // after the window
  };

  // ---- disputes
  const disputes: Dispute[] = [];
  const disputeIndex = new Map<string, number>();
  const addDispute = (d: RawDispute) => {
    if (!d || d.id == null || disputeIndex.has(String(d.id))) return;
    const parties = [d.complainant_id ?? d.parties?.[0], d.accused_id ?? d.parties?.[1]].map((x) => (x == null ? "" : String(x)));
    const a = personIndex.get(parties[0]);
    if (a == null) return;
    const b = personIndex.get(parties[1]) ?? a;
    const steps: DisputeStep[] = (Array.isArray(d.timeline) ? d.timeline : [])
      .filter((r) => r && !["listed", "agent_decision", "published"].includes(String(r.type)))
      .map((r) => ({
        day: String(r.day ?? ""), dayIdx: dayOf(r.day) ?? -1, type: String(r.type), text: String(r.text ?? ""),
        outcome: asOutcome(r.outcome), reason: r.reason ?? null, source: String(r.source ?? "world"),
      }))
      .sort((x, y) => x.day.localeCompare(y.day));
    const started = d.started ?? d.start_day ?? steps[0]?.day;
    const filed = d.filed_on ?? d.filed_day ?? steps.find((s) => FILED.has(s.type))?.day ?? null;
    const resolved = d.resolved_on ?? d.resolved_day ?? steps.find((s) => RESOLVED.has(s.type))?.day ?? null;
    const advs = [d.advocate_id, ...(d.advocate_ids ?? [])].filter(Boolean).map((x) => advocateIndex.get(String(x)) ?? -1).filter((x) => x >= 0);
    disputeIndex.set(String(d.id), disputes.length);
    disputes.push({
      id: String(d.id), a, b,
      kind: String(d.kind ?? "dispute"), origin: String(d.origin ?? "world"),
      kindLabel: d.kind_label ? String(d.kind_label) : null, forum: d.forum ? String(d.forum) : null,
      published: (Array.isArray(d.timeline) ? d.timeline : []).filter((r) => r && r.type === "published" && r.day).map((r) => String(r.day)),
      amount: typeof d.money_at_stake === "number" ? d.money_at_stake : typeof d.amount === "number" ? d.amount : null,
      caseId: d.case_id ? String(d.case_id) : Array.isArray(d.case_ids) && d.case_ids.length ? String(d.case_ids[0]) : null,
      advocates: [...new Set(advs)],
      steps,
      startDay: dayOf(started) ?? 0,
      filedDay: dayOf(filed),
      endDay: dayOf(resolved),
      finalState: String(d.final_state ?? d.state_end ?? d.state ?? (resolved ? "resolved" : "open")),
      story: String(d.story ?? ""),
      hearings: num(d.hearings, steps.filter((s) => HEARING.has(s.type)).length),
    });
  };
  (Array.isArray(raw.disputes) ? raw.disputes : []).forEach(addDispute);
  for (const t of tl) (t.disputes ?? []).forEach((r) => addDispute(r as RawDispute));
  const disputesOf: number[][] = people.map(() => []);
  disputes.forEach((d, k) => { disputesOf[d.a].push(k); if (d.b !== d.a) disputesOf[d.b].push(k); });

  // ---- per-day models
  const nP = people.length;
  const state = new Uint8Array(nP);
  const personTrips = new Float64Array(nP), personWages = new Float64Array(nP);
  const rawFunnel = Array.isArray(raw.funnel) ? raw.funnel : [];
  const population = raw.funnel && !Array.isArray(raw.funnel) && typeof raw.funnel === "object" ? (raw.funnel as PopulationFunnel) : null;
  const days: DayModel[] = [];
  let tripsCum = 0, wagesCum = 0;
  const cum: Record<string, number> = { disputes: 0, notices: 0, filed: 0, in_court: 0, resolved: 0 };
  for (let i = 0; i < dayList.length; i++) {
    const row: RawDay = tl[i] ?? {};
    if (row.people_state && typeof row.people_state === "object") {
      for (const [pid, st] of Object.entries(row.people_state)) {
        const pi = personIndex.get(pid);
        if (pi != null && st in STATE_CODE) state[pi] = STATE_CODE[st];
      }
    }
    const events = Array.isArray(row.events) ? row.events : [];
    const hearings: Hearing[] = [];
    const filings: number[] = [], quarrels: number[] = [], notices: number[] = [], resolutions: number[] = [];
    for (const ev of events) {
      const t = String(ev.type ?? "");
      const di = ev.dispute_id != null ? disputeIndex.get(String(ev.dispute_id)) ?? -1 : -1;
      const dsp = di >= 0 ? disputes[di] : null;
      if (HEARING.has(t)) {
        const trav = (ev.attended ?? ev.person_ids ?? []).map((x) => personIndex.get(String(x)) ?? -1).filter((x) => x >= 0);
        const advs = [ev.advocate_id, ...(ev.advocate_ids ?? [])].filter(Boolean).map((x) => advocateIndex.get(String(x)) ?? -1).filter((x) => x >= 0);
        hearings.push({
          disputeIdx: di, caseId: ev.case_id ?? dsp?.caseId ?? null,
          outcome: asOutcome(ev.outcome) ?? "adjourned", reason: ev.reason ?? null, purpose: ev.purpose ?? null,
          nextDate: ev.next_date ?? null, travellers: trav, advocates: advs.length ? advs : dsp?.advocates ?? [],
          judgment: t === "judgment" || ev.purpose === "JUDGEMENT", text: ev.text ?? "",
        });
        if (!row.people_state) for (const p of trav) state[p] = 2;
      } else if (di >= 0) {
        if (FILED.has(t)) filings.push(di);
        else if (QUARREL.has(t) && t !== "adopted") quarrels.push(di);
        else if (NOTICE.has(t)) notices.push(di);
        else if (RESOLVED.has(t)) resolutions.push(di);
        if (!row.people_state && dsp) {
          const s = RESOLVED.has(t) ? 3 : QUARREL.has(t) || NOTICE.has(t) ? 1 : -1;
          if (s >= 0) { state[dsp.a] = s; state[dsp.b] = s; }
        }
      }
    }
    // trips / wages: per-person deltas (engine export) or day totals (mock)
    let trips = 0, wages = 0;
    if (row.deltas && typeof row.deltas === "object") {
      for (const [pid, v] of Object.entries(row.deltas)) if (Array.isArray(v)) {
        trips += num(v[0]); wages += num(v[1]);
        const pi = personIndex.get(pid);
        if (pi != null) { personTrips[pi] += num(v[0]); personWages[pi] += num(v[1]); }
      }
    } else {
      trips = num(row.trips, hearings.reduce((s, h) => s + h.travellers.length, 0));
      wages = num(row.wages_lost, 0);
    }
    tripsCum += trips; wagesCum += wages;
    if (row.totals) { tripsCum = num(row.totals.trips, tripsCum); wagesCum = num(row.totals.wages_lost, wagesCum); }

    let fRaw: Record<string, number> | undefined = row.funnel ?? (rawFunnel[i] as Record<string, number> | undefined);
    if (!fRaw) {
      cum.disputes += quarrels.length; cum.notices += notices.length; cum.filed += filings.length; cum.resolved += resolutions.length;
      cum.in_court = disputes.filter((d) => d.filedDay != null && d.filedDay <= i && (d.endDay == null || d.endDay > i)).length;
      fRaw = { ...cum };
    }
    const byState = [0, 0, 0, 0];
    for (let p = 0; p < nP; p++) byState[state[p]]++;
    days.push({
      date: dayList[i], states: state.slice(), hearings, filings, quarrels, notices, resolutions, events,
      trips, wages, tripsCum, wagesCum, listed: num(row.court?.listed, hearings.length),
      sittings: (row as { sitting_windows?: unknown }).sitting_windows ?? (row.court as { sitting_windows?: unknown } | undefined)?.sitting_windows ?? null,
      lines: (row.court?.lines ?? []).filter((l) => l && l.case_id).map((l) => {
        const x = l as typeof l & { stakeholder?: string | null; minutes?: number; exp_min?: number };
        return {
          caseId: String(l.case_id), disputeIdx: l.dispute_id != null ? disputeIndex.get(String(l.dispute_id)) ?? -1 : -1,
          origin: String(l.origin ?? "roster"), window: String(l.window ?? ""), purpose: String(l.purpose ?? ""),
          advocate: String(l.advocate_id ?? ""), outcome: asOutcome(l.outcome), reason: l.reason ?? null,
          nextDate: l.next_date ?? null, stakeholder: x.stakeholder ?? null,
          minutes: typeof x.minutes === "number" ? x.minutes : null, expMin: typeof x.exp_min === "number" ? x.exp_min : null,
        };
      }),
      funnel: funnelView(fRaw), byState,
    });
  }

  const label = [meta.config, meta.roster].filter(Boolean).map(String).join(" / ");
  return {
    scenario, source: String(meta.source ?? (raw.schema ? "engine" : "export")), label,
    court, hoods, people, advocates, homes, businesses,
    edges: Uint32Array.from(edgeArr), disputes, days, personIndex, disputeIndex, disputesOf,
    personTrips, personWages, population,
    disputeOfCase: new Map(disputes.flatMap((d, k) => (d.caseId ? [[d.caseId, k] as [string, number]] : []))),
  };
}

export const DEFAULT_WORLD = "100_combined"; // one world: town + agents + court from the same run
const FALLBACK_WORLD = "100_optimal";

export async function loadWorld(scenario = DEFAULT_WORLD): Promise<World> {
  const get = async (s: string) => {
    const r = await fetch(`/data/world_${encodeURIComponent(s)}.json`);
    if (!r.ok) throw new Error(`world_${s}.json: ${r.status}`);
    return normaliseWorld((await r.json()) as WorldFile, s);
  };
  for (const s of [...new Set([scenario, DEFAULT_WORLD, FALLBACK_WORLD, "demo"])]) {
    try { return await get(s); } catch { /* try the next one */ }
  }
  throw new Error("No world data found in /data");
}

/** The dispute that tells the best story end to end inside the window. */
export function pickDirectorDispute(w: World): number {
  let best = -1, bestScore = -Infinity;
  const n = w.days.length;
  w.disputes.forEach((d, i) => {
    const outcomes = new Set(d.steps.map((s) => s.outcome).filter(Boolean));
    const inWindow = d.startDay >= 0 && d.startDay < n * 0.35;
    const score = (inWindow ? 30 : 0) + (d.filedDay != null && d.filedDay >= 0 ? 12 : 0)
      + Math.min(d.hearings, 8) * 4 + outcomes.size * 5 + (d.endDay != null && d.endDay < n ? 8 : 0)
      + (d.origin === "world" ? 6 : 0) - Math.max(0, d.startDay) * 0.2;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** meaning colours as theme tokens (COLORS.md section 2) for 2D UI */
export const OUTCOME_COLOR: Record<OutcomeKind, string> = {
  substantive: "var(--c-substantive, #10B77F)",
  adjourned: "var(--c-adjourned, #F59F0A)",
  not_reached: "var(--c-not-reached, #C678DD)",
  not_ready: "var(--c-not-ready, #274754)",
};
export const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  substantive: "Moved forward",
  adjourned: "Adjourned",
  not_reached: "Not reached",
  not_ready: "Not ready",
};
/** people states have their own colour family (COLORS.md section 7), never shared with hearing outcomes */
export const PEOPLE_COLOR = {
  calm: "#94A3B8",
  dispute: "light-dark(#DB2777, #F472B6)",
  court: "light-dark(#4338CA, #818CF8)",
  resolved: "light-dark(#0E7490, #22D3EE)",
};
export const STATE_COLOR = [PEOPLE_COLOR.calm, PEOPLE_COLOR.dispute, PEOPLE_COLOR.court, PEOPLE_COLOR.resolved]; // calm, in_dispute, in_court, resolved
export const STATE_LABEL = ["Calm", "In dispute", "In court", "Resolved"];

export const STEP_LABEL: Record<string, string> = {
  quarrel: "The quarrel", adopted: "On the docket", legal_notice: "Legal notice", notice: "Legal notice",
  negotiation: "Trying to settle", notice_expired: "Notice runs out", complaint_filed: "Complaint filed",
  filed: "Registered in court", filing: "Filed", hearing: "Hearing", judgement: "Judgement", judgment: "Judgement",
  settled_pre_court: "Settled before court", settled_in_court: "Settled in court", dropped: "Claim dropped",
  resolved: "Resolved", settled: "Settled",
};
export const isResolvedType = (t: string) => RESOLVED.has(t);
export const isHearingType = (t: string) => HEARING.has(t);

export const pretty = (s: string | null | undefined) =>
  s ? s.toLowerCase().replace(/_/g, " ").replace("s351 bnss", "S351 BNSS").replace(/^\w/, (c) => c.toUpperCase()) : "";

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", opts);
}
export const fmtMoney = (v: number) => `Rs ${Math.round(v).toLocaleString("en-IN")}`;
