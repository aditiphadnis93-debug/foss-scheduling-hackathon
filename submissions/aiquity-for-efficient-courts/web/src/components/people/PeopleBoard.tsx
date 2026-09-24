"use client";

/**
 * /people: agent journey boards. Every advocate and litigant is an agent with a persona;
 * select one to watch their listings play out, what they decided and why, and how their
 * willingness to turn up drifts with each wasted trip.
 */
import Link from "next/link";
import { caseHref } from "@/lib/world-case";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { Briefcase, CheckCircle2, CircleSlash, Clock, Footprints, Hourglass, IndianRupee, Quote, User, XCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  TRAIT_LABEL, listAgentScenarios, loadAgents, traitValue,
  type Agent, type AgentsData, type AgentsScenario, type Step,
} from "@/lib/people";
import { OUTCOME_COLOR, OUTCOME_LABEL, PEOPLE_COLOR, fmtDate, pretty } from "@/lib/world";
import { Num, Panel } from "@/components/world/ui";

type Filter = "all" | "advocate" | "litigant";

export default function PeopleBoard() {
  const [scenarios, setScenarios] = useState<AgentsScenario[]>([]);
  const [scenario, setScenario] = useState<string | null>(null);
  const [data, setData] = useState<AgentsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [courtDay, setCourtDay] = useState(0);

  useEffect(() => {
    let alive = true;
    listAgentScenarios().then((s) => { if (alive) { setScenarios(s); setScenario(s[0]?.id ?? "demo"); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!scenario) return;
    let alive = true;
    loadAgents(scenario)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setErr(null);
        // start on the most telling journey: most wasted trips with a real rationale
        const best = [...d.agents].sort((a, b) => b.totals.wasted * 2 + b.steps.length - (a.totals.wasted * 2 + a.steps.length))
          .find((a) => a.role === "litigant") ?? d.agents[0];
        let want: string | null = null;
        try { want = new URLSearchParams(window.location.search).get("agent"); } catch { want = null; }
        setSel(want && d.agents.some((a) => a.id === want) ? want : best?.id ?? null);
        const busiest = d.byDay.reduce((bi, list, i, arr) => (list.length > arr[bi].length ? i : bi), 0);
        setCourtDay(busiest);
      })
      .catch((e: unknown) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [scenario]);

  const agent = data?.agents.find((a) => a.id === sel) ?? null;
  const list = useMemo(() => {
    if (!data) return [];
    return data.agents
      .filter((a) => filter === "all" || a.role === filter)
      .sort((a, b) => b.totals.wasted - a.totals.wasted || b.totals.listings - a.totals.listings);
  }, [data, filter]);

  const current = scenarios.find((s) => s.id === scenario);

  return (
    <div className="text-[var(--text)]">
      <div className="pb-16">
        {/* header */}
        <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--primary,#2463EB)]">People, not probabilities</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Every advocate and litigant decides for themselves</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--text-muted,var(--muted,#65758B))]">
            Each person is an agent with a persona. On every listing they decide whether to turn up, whether they are ready,
            and whether to ask for time. Wasted trips wear them down, and the court feels it.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {scenarios.map((s) => (
              <button key={s.id} type="button" onClick={() => setScenario(s.id)}
                className={clsx("rounded-xl border px-3.5 py-2 text-left text-xs transition-colors",
                  s.id === scenario ? "border-[var(--primary,#2463EB)] bg-[var(--primary,#2463EB)] text-white" : "border-[var(--border,var(--line,#E1E7EF))] bg-[var(--bg,var(--surface))] text-[var(--text)] hover:bg-[var(--surface-2)]")}>
                <span className="font-medium">{s.label}</span>
              </button>
            ))}
            {data && (
              <span className="ml-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">
                <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono">{data.agents.length} agents</span>
                <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono">{data.days.length} sitting days</span>
                {data.model && <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[var(--primary-strong,#1E3B8A)]">decisions written by a language model</span>}
                {data.mock && <span className="rounded-md bg-[var(--c-adjourned,#F59F0A)]/15 px-2 py-1 uppercase tracking-wider text-[var(--c-adjourned,#F59F0A)]">sample data</span>}
              </span>
            )}
          </div>
          {current?.note && <div className="mt-2 text-xs text-[var(--text-muted,var(--muted,#65758B))]">{current.note}</div>}
        </motion.header>

        {err && <div className="mt-8 text-sm text-[var(--c-adjourned,#F59F0A)]">Could not load agents: {err}</div>}
        {!data && !err && <div className="mt-10 flex items-center gap-3 text-sm text-[var(--text-muted,var(--muted,#65758B))]"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--primary,#2463EB)]" /> Loading agents</div>}

        {data && (
          <>
            <div className="mt-8 grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
              {/* agent grid */}
              <Panel flat className="flex max-h-[860px] flex-col overflow-hidden">
                <div className="flex items-center gap-1 border-b border-[var(--border,var(--line,#E1E7EF))]/70 p-3">
                  {(["all", "advocate", "litigant"] as Filter[]).map((f) => (
                    <button key={f} type="button" onClick={() => setFilter(f)}
                      className={clsx("rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors", filter === f ? "bg-[var(--primary-subtle,#F0F6FF)] text-[var(--primary-strong,#1E3B8A)]" : "text-[var(--text-muted,var(--muted,#65758B))] hover:text-[var(--text)]")}>
                      {f === "all" ? "Everyone" : `${f}s`}
                      <span className="ml-1.5 font-mono text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">{f === "all" ? data.agents.length : data.agents.filter((a) => a.role === f).length}</span>
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">by wasted trips</span>
                </div>
                <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-1">
                  <LayoutGroup>
                    {list.map((a, i) => <AgentCard key={`${a.id}-${i}`} agent={a} active={a.id === sel} onClick={() => setSel(a.id)} />)}
                  </LayoutGroup>
                </div>
              </Panel>

              {/* journey */}
              <AnimatePresence mode="wait">
                {agent && (
                  <motion.div key={`${scenario}-${agent.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}>
                    <Journey agent={agent} data={data} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <CourtToday data={data} day={courtDay} setDay={setCourtDay} onPick={(id) => { setSel(id); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
              <Comparison data={data} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RoleIcon({ role, size = 13 }: { role: string; size?: number }) {
  return role === "advocate" ? <Briefcase size={size} /> : <User size={size} />;
}

function AgentCard({ agent, active, onClick }: { agent: Agent; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      layout="position"
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative w-full rounded-xl border p-3 text-left transition-colors",
        active ? "border-[var(--border,var(--line,#E1E7EF))] bg-[var(--primary-subtle,#F0F6FF)] shadow-[inset_2px_0_0_var(--primary,#2463EB)]" : "border-[var(--border,var(--line,#E1E7EF))] bg-[var(--bg,var(--surface))] hover:bg-[var(--surface-2)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={clsx("flex h-6 w-6 items-center justify-center rounded-md", agent.role === "advocate" ? "bg-[var(--primary-soft,#DCEBFE)] text-[var(--primary-strong,#1E3B8A)]" : "bg-[var(--surface-2)] text-[var(--text-muted,var(--muted,#65758B))]")}>
          <RoleIcon role={agent.role} />
        </span>
        <span className="truncate font-mono text-[12px] text-[var(--text)]">{agent.name}</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">{agent.totals.listings} listed</span>
      </div>
      <div className="mt-2.5 space-y-1">
        {agent.traits.slice(0, 4).map(([k, v, n]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-[112px] truncate text-[10px] text-[var(--text-muted,var(--muted,#65758B))]">{TRAIT_LABEL[k] ?? pretty(k)}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full bg-[var(--primary,#2463EB)]" style={{ width: `${n * 100}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-[10px] text-[var(--text)]">{traitValue(k, v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-3 text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">
        <span className="flex items-center gap-1"><Footprints size={11} className="text-[var(--c-adjourned,#F59F0A)]" /> {agent.totals.wasted}/{agent.totals.trips} wasted</span>
        <span className="flex items-center gap-1"><Hourglass size={11} /> {Math.round(agent.totals.minutes / 60)}h</span>
        {agent.totals.wages > 0 && <span className="flex items-center gap-1"><IndianRupee size={11} /> {agent.totals.wages.toLocaleString("en-IN")}</span>}
      </div>
    </motion.button>
  );
}

function Journey({ agent, data }: { agent: Agent; data: AgentsData }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <Panel flat className="overflow-hidden">
      <div className="grid gap-5 border-b border-[var(--border,var(--line,#E1E7EF))]/70 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted,var(--muted,#65758B))]">
            <RoleIcon role={agent.role} size={12} /> {agent.role}
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold">{agent.name}</div>
          <div className="mt-1 text-xs text-[var(--text-muted,var(--muted,#65758B))]">{agent.caseIds.length} case{agent.caseIds.length === 1 ? "" : "s"}: <span className="font-mono">{agent.caseIds.slice(0, 4).join(", ")}{agent.caseIds.length > 4 ? " ..." : ""}</span></div>
          <div className="mt-4 space-y-2">
            {agent.traits.map(([k, v, n], i) => (
              <div key={k}>
                <div className="flex justify-between text-[11px]"><span className="text-[var(--text)]">{TRAIT_LABEL[k] ?? pretty(k)}</span><span className="font-mono text-[var(--text-muted,var(--muted,#65758B))]">{traitValue(k, v)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <motion.div className="h-full rounded-full bg-[var(--primary,#2463EB)]"
                    initial={{ width: reduced ? `${n * 100}%` : 0 }} animate={{ width: `${n * 100}%` }} transition={{ duration: 0.8, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<Footprints size={13} />} label="Trips" value={agent.totals.trips} />
            <Stat icon={<XCircle size={13} />} label="Wasted" value={agent.totals.wasted} tone="var(--c-adjourned,#F59F0A)" />
            <Stat icon={<Hourglass size={13} />} label="Hours waited" value={agent.totals.minutes / 60} fmt={(v) => v.toFixed(1)} />
            <Stat icon={<IndianRupee size={13} />} label="Wages lost" value={agent.totals.wages} tone={agent.totals.wages ? "var(--c-adjourned,#F59F0A)" : undefined} />
          </div>
          <Drift agent={agent} data={data} />
        </div>
      </div>
      <ol className="relative p-5">
        <div className="absolute bottom-8 left-[37px] top-8 w-px bg-[var(--border,var(--line,#E1E7EF))]" aria-hidden />
        {agent.steps.map((s, i) => <StepRow key={`${s.day}-${s.caseId}-${i}`} step={s} i={i} role={agent.role} />)}
        {!agent.steps.length && <li className="text-sm text-[var(--text-muted,var(--muted,#65758B))]">No listings in this run.</li>}
      </ol>
    </Panel>
  );
}

function Stat({ icon, label, value, tone, fmt }: { icon: React.ReactNode; label: string; value: number; tone?: string; fmt?: (v: number) => string }) {
  return (
    <div className="rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">{icon}{label}</div>
      <Num value={value} format={fmt} className="mt-1 block font-mono text-xl font-semibold" />
      <span className="sr-only">{tone}</span>
      {tone && <div className="mt-1 h-0.5 w-8 rounded-full" style={{ background: tone }} />}
    </div>
  );
}

function Drift({ agent, data }: { agent: Agent; data: AgentsData }) {
  const W = 520, H = 130, P = 10;
  const pts = agent.drift;
  const n = Math.max(1, data.days.length - 1);
  const path = useMemo(() => {
    if (!pts.length) return "";
    // several values can share a day (one per listing): spread them inside the day
    const counts = new Map<number, number>();
    const seen = new Map<number, number>();
    for (const p of pts) counts.set(p.dayIdx, (counts.get(p.dayIdx) ?? 0) + 1);
    return pts.map((p, i) => {
      const k = seen.get(p.dayIdx) ?? 0;
      seen.set(p.dayIdx, k + 1);
      const frac = (counts.get(p.dayIdx) ?? 1) > 1 ? k / (counts.get(p.dayIdx)! - 1 || 1) * 0.8 : 0;
      const x = P + ((p.dayIdx + frac) / (n + 0.8)) * (W - 2 * P);
      const y = H - P - p.value * (H - 2 * P);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [pts, n]);
  const first = pts[0]?.value, last = pts[pts.length - 1]?.value;
  const measure = data.driftMeasure[agent.role] ?? "attendance propensity";
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted,var(--muted,#65758B))]">Willingness to turn up</div>
        {first != null && last != null && (
          <div className="font-mono text-xs">
            <span className="text-[var(--text-muted,var(--muted,#65758B))]">{Math.round(first * 100)}%</span>
            <span className="mx-1 text-[var(--text-muted,var(--muted,#65758B))]">to</span>
            <span style={{ color: last < first - 0.01 ? "var(--c-adjourned,#F59F0A)" : last > first + 0.01 ? "var(--c-substantive,#10B77F)" : "var(--text)" }}>{Math.round(last * 100)}%</span>
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[130px] w-full" preserveAspectRatio="none" role="img" aria-label={measure}>
        <defs>
          <linearGradient id="drift-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary,#2463EB)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary,#2463EB)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={P} x2={W - P} y1={H - P - g * (H - 2 * P)} y2={H - P - g * (H - 2 * P)} stroke="var(--border,var(--line,#E1E7EF))" strokeDasharray="3 5" />
        ))}
        {path && (
          <>
            <motion.path d={`${path} L${W - P},${H - P} L${P},${H - P} Z`} fill="url(#drift-fill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} />
            <motion.path d={path} fill="none" stroke="var(--primary,#2463EB)" strokeWidth={2.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: "easeInOut" }} />
          </>
        )}
      </svg>
      <div className="mt-1 text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">{measure}</div>
    </div>
  );
}

function Chip({ ok, yes, no, neutral }: { ok: boolean | null; yes: string; no: string; neutral?: boolean }) {
  const Icon = ok ? CheckCircle2 : CircleSlash;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px]",
      (ok == null || neutral) && "bg-[var(--surface-2)]", ok == null ? "text-[var(--text-muted,var(--muted,#65758B))]" : neutral && !ok ? "text-[var(--text)]" : "")}
      style={ok == null || (neutral && !ok) ? undefined : { color: ok ? PEOPLE_COLOR.court : PEOPLE_COLOR.dispute, background: `color-mix(in srgb, ${ok ? PEOPLE_COLOR.court : PEOPLE_COLOR.dispute} 12%, transparent)` }}>
      <Icon size={11} /> {ok ? yes : no}
    </span>
  );
}

function StepRow({ step: s, i, role }: { step: Step; i: number; role: string }) {
  const color = OUTCOME_COLOR[s.outcome];
  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(i, 14) * 0.06, duration: 0.4 }}
      className="relative mb-4 grid grid-cols-[34px_minmax(0,1fr)] gap-3"
    >
      <div className="relative z-10 flex h-[34px] w-[34px] flex-col items-center justify-center rounded-xl border bg-[var(--surface)]" style={{ borderColor: color }}>
        <span className="font-mono text-[9px] leading-none text-[var(--text-muted,var(--muted,#65758B))]">{fmtDate(s.day, { month: "short" })}</span>
        <span className="font-mono text-[13px] font-semibold leading-none">{fmtDate(s.day, { day: "numeric" })}</span>
      </div>
      <div className="min-w-0 rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={caseHref(s.caseId)} className="font-mono text-[12px] text-[var(--primary-strong,#1E3B8A)] hover:underline">{s.caseId}</Link>
          <span className="text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">{pretty(s.purpose)}</span>
          {s.window && <span className="flex items-center gap-1 font-mono text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]"><Clock size={11} />{s.window}</span>}
          <span className="ml-auto rounded-md px-2 py-0.5 text-[10.5px] font-medium" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>{OUTCOME_LABEL[s.outcome]}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.called ? (
            <>
              <Chip ok={s.appear} yes="Turned up" no="Stayed away" />
              {s.appear && <Chip ok={s.ready} yes="Ready" no="Not ready" />}
              {s.seek && <Chip ok={false} yes="" no="Sought time" />}
              {s.confirmed && <span className="inline-flex items-center gap-1 rounded-md bg-[var(--primary-subtle,#F0F6FF)] px-1.5 py-0.5 text-[10.5px] text-[var(--primary-strong,#1E3B8A)]"><Sparkles size={11} />Confirmed in advance</span>}
              {s.pAppear != null && (
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text)]">
                  Chance they turn up {Math.round(s.pAppear * 100)}%{s.pAppearStat != null && <span className="text-[var(--c-baseline,#9CA3B0)]"> (court-wide average {Math.round(s.pAppearStat * 100)}%)</span>}
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">Never called</span>
          )}
        </div>
        {s.rationale && (
          <blockquote className="mt-2.5 flex gap-2 text-[12.5px] leading-relaxed text-[var(--text)]">
            <Quote size={13} className="mt-0.5 shrink-0 text-[var(--primary,#2463EB)]/70" />
            <span>{s.rationale}</span>
          </blockquote>
        )}
        <div className="mt-2.5 flex flex-wrap gap-3 text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">
          {s.reason && <span>Reason: <span className="text-[var(--text)]">{s.reason}</span></span>}
          {s.tripMade && <span className={s.tripWasted ? "text-[var(--c-adjourned,#F59F0A)]" : ""}>{s.tripWasted ? "Trip wasted" : "Trip worth it"}</span>}
          {s.minutesWaited > 0 && <span>{s.minutesWaited} min waited</span>}
          {role === "litigant" && s.wagesLost > 0 && <span className="text-[var(--c-adjourned,#F59F0A)]">Rs {s.wagesLost.toLocaleString("en-IN")} wages lost</span>}
          {s.travelCost > 0 && <span>Rs {s.travelCost} travel</span>}
        </div>
      </div>
    </motion.li>
  );
}

function CourtToday({ data, day, setDay, onPick }: { data: AgentsData; day: number; setDay: (d: number) => void; onPick: (id: string) => void }) {
  const hearings = data.byDay[day] ?? [];
  const maxN = Math.max(1, ...data.byDay.map((l) => l.length));
  const turned = hearings.reduce((s, h) => s + h.parties.filter((p) => p.step.appear).length, 0);
  const total = hearings.reduce((s, h) => s + h.parties.length, 0);
  return (
    <Panel flat className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">Inside the court</div>
          <div className="mt-1 text-xl font-semibold">{data.days[day] ? fmtDate(data.days[day], { weekday: "long", day: "numeric", month: "long" }) : "-"}</div>
        </div>
        <div className="text-xs text-[var(--text-muted,var(--muted,#65758B))]"><span className="font-mono text-[var(--text)]">{hearings.length}</span> matters · <span className="font-mono text-[var(--text)]">{turned}/{total}</span> people turned up</div>
      </div>
      <div className="mt-4 flex h-12 items-end gap-[3px]">
        {data.byDay.map((l, i) => (
          <button key={data.days[i]} type="button" onClick={() => setDay(i)} title={fmtDate(data.days[i])} aria-label={`Show ${fmtDate(data.days[i])}`}
            className={clsx("flex-1 rounded-t-sm transition-colors", i === day ? "bg-[var(--primary,#2463EB)]" : "bg-[var(--border,var(--line,#E1E7EF))] hover:bg-[var(--border,var(--line,#E1E7EF))]")}
            style={{ height: `${Math.max(8, (l.length / maxN) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
        <AnimatePresence mode="popLayout">
          {hearings.map((h, i) => (
            <motion.div key={`${day}-${h.caseId}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}
              className="rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: OUTCOME_COLOR[h.outcome], }} />
                <Link href={caseHref(h.caseId)} className="font-mono text-[12px] text-[var(--primary-strong,#1E3B8A)] hover:underline">{h.caseId}</Link>
                <span className="text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">{pretty(h.purpose)}</span>
                <span className="font-mono text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">{h.window}</span>
                <span className="ml-auto text-[10.5px]" style={{ color: OUTCOME_COLOR[h.outcome] }}>{OUTCOME_LABEL[h.outcome]}{h.reason ? ` · ${h.reason}` : ""}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {h.parties.map(({ agent, step }) => (
                  <button key={agent.id} type="button" onClick={() => onPick(agent.id)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--surface-2)]">
                    <span className={clsx("mt-0.5", agent.role === "advocate" ? "text-[var(--primary,#2463EB)]" : "text-[var(--primary,#2463EB)]")}><RoleIcon role={agent.role} size={12} /></span>
                    <span className="w-[98px] shrink-0 truncate font-mono text-[11px] text-[var(--text)]">{agent.name}</span>
                    <span className={clsx("shrink-0 text-[10.5px]", !step.called && "text-[var(--text-muted,var(--muted,#65758B))]")} style={step.called ? { color: step.appear ? PEOPLE_COLOR.court : PEOPLE_COLOR.dispute } : undefined}>
                      {!step.called ? "not called" : step.appear ? (step.seek ? "came, sought time" : step.ready ? "came, ready" : "came, not ready") : "stayed away"}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">{step.rationale}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {!hearings.length && <div className="text-sm text-[var(--text-muted,var(--muted,#65758B))]">No agent listings on this day.</div>}
      </div>
    </Panel>
  );
}

function Comparison({ data }: { data: AgentsData }) {
  const rows = data.comparison.slice(0, 10);
  const s = data.summary;
  const pAgent = typeof s.mean_p_absent_agent === "number" ? s.mean_p_absent_agent : null;
  const pStat = typeof s.mean_p_absent_statistical === "number" ? s.mean_p_absent_statistical : null;
  return (
    <Panel flat className="p-5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">Court-wide averages vs people deciding for themselves</div>
      <div className="mt-1 text-xl font-semibold">Same causelist, two kinds of people</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted,var(--muted,#65758B))]">
        Court-wide averages assume everyone behaves like the average party. Here each person decides from their own situation and what happened to them last time.
        {pAgent != null && pStat != null && <> On average people expected to stay away <span className="font-mono text-[var(--text)]">{Math.round(pAgent * 100)}%</span> of the time vs <span className="font-mono text-[var(--text)]">{Math.round(pStat * 100)}%</span> in the court-wide averages.</>}
      </p>
      <div className="mt-3 flex gap-4 text-[11px] text-[var(--text-muted,var(--muted,#65758B))]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[var(--c-baseline,#9CA3B0)]" /> Court-wide averages</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-[var(--text)]" /> People deciding for themselves</span>
      </div>
      <div className="mt-4 space-y-3.5">
        {rows.map((r, i) => {
          const max = Math.max(Math.abs(r.stat), Math.abs(r.agent), 1e-9);
          const delta = r.agent - r.stat;
          const better = r.lowerBetter ? delta < 0 : delta > 0;
          return (
            <div key={r.key}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-[var(--text)]">{r.label}</span>
                <span className={clsx("font-mono text-[11px]", Math.abs(delta) < 1e-9 ? "text-[var(--text-muted,var(--muted,#65758B))]" : better ? "text-[var(--c-substantive,#10B77F)]" : "text-[var(--c-adjourned,#F59F0A)]")}>
                  {delta > 0 ? "+" : ""}{Number.isInteger(delta) ? delta : delta.toFixed(1)}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {[{ v: r.stat, c: "var(--c-baseline,#9CA3B0)" }, { v: r.agent, c: "var(--text)" }].map((b, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <motion.div className="h-full rounded-full" style={{ background: b.c }} initial={{ width: 0 }} whileInView={{ width: `${(Math.abs(b.v) / max) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, delay: i * 0.05 + k * 0.1 }} />
                    </div>
                    <span className="w-12 text-right font-mono text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">{Number.isInteger(b.v) ? b.v : b.v.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="text-sm text-[var(--text-muted,var(--muted,#65758B))]">No comparison in this run.</div>}
      </div>
      {typeof s.litigant_hours_lost === "number" && (
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border,var(--line,#E1E7EF))]/70 pt-4 text-center">
          <div><Num value={Number(s.litigant_wasted_trips ?? 0)} className="block font-mono text-lg font-semibold text-[var(--c-adjourned,#F59F0A)]" /><div className="text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">wasted litigant trips</div></div>
          <div><Num value={Number(s.litigant_hours_lost)} className="block font-mono text-lg font-semibold" /><div className="text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">hours lost</div></div>
          <div><Num value={Number(s.litigant_money_lost ?? 0)} className="block font-mono text-lg font-semibold" /><div className="text-[10px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">rupees lost</div></div>
        </div>
      )}
    </Panel>
  );
}
