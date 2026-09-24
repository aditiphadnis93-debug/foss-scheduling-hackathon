"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useExplain } from "@/components/shell/Explain";
import Funnel from "@/components/charts/Funnel";
import { CountUp } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Card";
import { fetchRun, useAsync } from "@/lib/data";
import { accessOf } from "@/lib/access";
import { C } from "@/lib/theme";
import { EASE } from "@/lib/motion";
import MathsPlain from "@/components/ui/MathsPlain";
import FormulaBlock, { CORE_FORMULAS } from "@/components/ui/FormulaBlock";
import { tidy } from "@/lib/agents";

type M = Record<string, number>;
const FALLBACK = {
  ours: { eju_pct: 90.2, reach_rate_pct: 91.2, substantive_total: 818, justice_weighted_progress_per_hour: 6.52, cases_5y_pending_start: 436, cases_5y_pending_end: 262, backlog_4y_heard_pct: 57.1, next_date_mean_gap_days: 18, next_date_sane_pct: 76.9, sitting_days: 52 } as M,
  base: { eju_pct: 91.3, reach_rate_pct: 43.1, substantive_total: 739, justice_weighted_progress_per_hour: 5.28, cases_5y_pending_start: 436, cases_5y_pending_end: 324, backlog_4y_heard_pct: 49.6, next_date_mean_gap_days: 57.4, next_date_sane_pct: 69.2, sitting_days: 52 } as M,
  hours: { ours: 7.9, base: 59.1 },
};

async function load() {
  const [o, b] = await Promise.all([fetchRun("3000", "optimal"), fetchRun("3000", "baseline")]);
  if (!o || !b) return FALLBACK;
  return {
    ours: { ...FALLBACK.ours, ...o.metrics },
    base: { ...FALLBACK.base, ...b.metrics },
    hours: { ours: accessOf(o).possibility.life_hours_per_hearing_moved, base: accessOf(b).possibility.life_hours_per_hearing_moved },
  };
}

const TITLES = ["The problem, in their numbers", "The algorithm in four steps", "How dynamic it is", "The people are AI agents", "Scored the way you will score it", "Visual insight", "How far we took it"];

export default function Algorithm() {
  const data = useAsync(load, []) ?? FALLBACK;
  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const register = useCallback((i: number, el: HTMLElement | null) => {
    refs.current[i] = el;
  }, []);
  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(TITLES.length - 1, i));
    setStep(n);
    refs.current[n]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        go(step + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        go(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, go]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    refs.current.forEach((r) => r && obs.observe(r));
    return () => obs.disconnect();
  }, []);

  const o = data.ours;
  const b = data.base;
  return (
    <div className="relative">
      <div className="sticky top-0 z-30 -mx-5 mb-6 flex items-center gap-3 border-b border-line bg-bg/95 px-5 py-3 md:-mx-10 md:px-10">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-primary">How we schedule</p>
        <div className="mx-auto flex items-center gap-1.5" role="tablist" aria-label="Steps">
          {TITLES.map((t, i) => (
            <button key={t} onClick={() => go(i)} aria-label={`Step ${i + 1}: ${t}`} aria-selected={i === step} role="tab" className="p-1">
              <span className={clsx("block h-2 rounded-full transition-all", i === step ? "w-6 bg-primary" : "w-2 bg-[var(--border)] hover:bg-[var(--text-faint)]")} />
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => go(step - 1)} disabled={step === 0} className="grid h-8 w-8 place-items-center rounded-lg border border-line disabled:opacity-30" aria-label="Back">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => go(step + 1)} disabled={step === TITLES.length - 1} className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary disabled:opacity-30" aria-label="Next">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <Step i={0} register={register} tech={<p>The brief&apos;s judge has 420 minutes; our court day is 10:00–13:30 and 14:00–16:30, 360 minutes of hearings, with 30 minutes held for urgent matters. Capacity is counted in expected minutes, not files.</p>}>
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="display text-[40px] leading-[1.05] md:text-[52px]">
              60 listed. <span className="text-muted">20 heard.</span> <span className="text-primary">10 moved.</span>
            </p>
            <p className="mt-4 text-[18px] leading-relaxed text-muted">
              A judge&apos;s day is 360 minutes of hearings. The question is not what is pending. It is how to use this judge&apos;s time today.
            </p>
          </div>
          <div className="card p-6">
            <Funnel
              max={60}
              steps={[
                { label: "Listed", value: 60, colour: C.baseline, note: "told to come" },
                { label: "Heard", value: 20, colour: C.adjourned, note: "reached" },
                { label: "Moved", value: 10, colour: C.substantive, note: "case moved forward" },
              ]}
            />
          </div>
        </div>
      </Step>

      <Step i={1} register={register} tech={<TechFormulas />}>
        <div className="grid gap-3 lg:grid-cols-4">
          {[
            { n: "1", t: "Can it go ahead?", d: "Checks the matter's checklist (summons served, filing ready), then the chance each side turns up and is ready, from the court's own tables, the person's history, the kind of dispute and this judge." },
            { n: "2", t: "What is it worth?", d: "The chance it moves the case, times how close that brings it to judgment, raised for age, for being stuck at a stage and for times it was passed over." },
            { n: "3", t: "Pack the day", d: "An optimiser picks the matters and slots that give the most progress per court hour, in expected minutes with a buffer. At least a quarter of the time (never below a fifth) for cases over four years old, each advocate's matters together, 30 minutes kept for emergencies." },
            { n: "4", t: "Give dates and windows", d: "A rolling ten-day plan of dates, a time window for every matter, and a next date matched to the next step, not a flat 60 days." },
          ].map((s, i) => (
            <motion.div key={s.n} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12, ease: EASE }} className="relative">
              <div className="card h-full p-5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-[14px] font-semibold text-on-primary">{s.n}</span>
                <p className="mt-3 text-[18px] font-semibold text-text">{s.t}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.d}</p>
              </div>
              {i < 3 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-bg text-primary lg:block" size={22} />}
            </motion.div>
          ))}
        </div>
        <div className="mt-5">
          <MathsPlain />
        </div>
      </Step>

      <Step i={2} register={register} tech={<p>Horizon planner re-optimises the next 10 sitting days nightly; readiness signals override the statistical chance for confirmed matters; the day is simulated with lognormal durations, correlated advocate absence, urgent arrivals from the reserve, judge emergency tail roll-over and standby backfill; Beta posteriors per advocate and party update after each hearing when learning is on.</p>}>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { t: "Every evening", d: "Re-plans the next ten sitting days: who comes, when, and in what order." },
            { t: "Each morning", d: "Readiness confirmations and prerequisite checks update the list before anyone travels." },
            { t: "During the day", d: "Actual hearing times, no-shows, urgent matters, a judge called away, standby matters called in: the day adapts.", href: "/court", cta: "See “Changes today”" },
            { t: "After each hearing", d: "The next date is recalculated; with learning on, the chance each person turns up is updated." },
          ].map((x, i) => (
            <motion.div key={x.t} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="card border-t-2 border-t-primary p-5">
              <p className="text-[12px] uppercase tracking-[0.12em] text-primary">{x.t}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-text">{x.d}</p>
              {x.href && (
                <Link href={x.href} className="mt-2 inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
                  {x.cta} <ArrowRight size={13} />
                </Link>
              )}
            </motion.div>
          ))}
        </div>
        <p className="mt-4 text-[15px] text-muted">
          The town and the AI agents change who comes (a transport strike empties the corridor). The judge can change any
          setting and see the cost first, in <Link href="/whatif" className="text-primary hover:underline">Simulation</Link> and the{" "}
          <Link href="/assistant" className="text-primary hover:underline">Court assistant</Link>.
        </p>
      </Step>

      <Step i={3} register={register} tech={<AgentPrompt />}>
        <AgentsStep />
      </Step>

      <Step i={4} register={register} tech={<p>Source: run_3000_optimal.json vs run_3000_baseline.json metrics (eju_pct, reach_rate_pct, substantive_total, justice_weighted_progress_per_hour, cases_5y_pending_end, backlog_4y_heard_pct, next_date_mean_gap_days, next_date_sane_pct); people-hours from the access formulas (2 h travel, 5 h all-day wait, half the window with one, 2 people per listing).</p>}>
        <p className="mb-4 text-[14px] text-muted">3,000 cases, {o.sitting_days} sitting days. Recommended list against current practice.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Score dim="Utilisation" main={`${o.eju_pct.toFixed(0)}%`} vs={`${b.eju_pct.toFixed(0)}%`} line="Court time on hearings that moved: level. Current practice gets there by listing 60 and never reaching most." />
          <Score dim="Predictability" main={`${o.reach_rate_pct.toFixed(0)}%`} vs={`${b.reach_rate_pct.toFixed(0)}%`} line="Called on the day they were told to come." good />
          <Score dim="Substantiveness" main={`${o.substantive_total}`} vs={`${b.substantive_total}`} line={`Matters that moved. Progress per court hour ${o.justice_weighted_progress_per_hour.toFixed(1)} vs ${b.justice_weighted_progress_per_hour.toFixed(1)} (+${Math.round((o.justice_weighted_progress_per_hour / b.justice_weighted_progress_per_hour - 1) * 100)}%).`} good />
          <Score dim="Backlog age" main={`${o.cases_5y_pending_start}→${o.cases_5y_pending_end}`} vs={`${b.cases_5y_pending_end}`} line={`Cases over 5 years still pending. Over-4-year cases heard ${o.backlog_4y_heard_pct.toFixed(0)}% vs ${b.backlog_4y_heard_pct.toFixed(0)}%.`} good />
          <Score dim="Next date" main={`${Math.round(o.next_date_mean_gap_days)} days`} vs={`${Math.round(b.next_date_mean_gap_days)} flat`} line={`Matched to the next step. ${o.next_date_sane_pct.toFixed(0)}% fit the step vs ${b.next_date_sane_pct.toFixed(0)}%.`} good />
          <Score dim="People" main={`${data.hours.ours.toFixed(1)} h`} vs={`${data.hours.base.toFixed(1)} h`} line="Hours of people's lives per hearing that moved the case." good />
        </div>
      </Step>

      <Step i={5} register={register}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["/court", "Court day", "Planned against actual: what slipped today, and why."],
            ["/whatif", "Simulation", "Change a setting and see its cost before it touches a case."],
            ["/delays", "Who is the delay?", "Which side, agency or the court itself cost the hearings."],
            ["/runway", "What this posting can close", "Which cases can be finished before the transfer."],
            ["/observatory", "Observatory", "How events in the town change tomorrow's court."],
            ["/assistant", "Court assistant", "Describe a problem; get a change you can test."],
          ].map(([href, t, d], i) => (
            <motion.div key={href} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
              <Link href={href} className="card group block h-full p-5 transition-colors hover:bg-surface-2">
                <p className="text-[17px] font-semibold text-text">{t}</p>
                <p className="mt-1 text-[14px] text-muted">{d}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] text-primary group-hover:underline">
                  Open <ArrowRight size={13} />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </Step>

      <Step i={6} register={register} tech={<p>L1: baseline planner + validator. L2: per-type distributions, costs, three-layer priors, judge setups and guardrails, MILP with the ageing floor. L3: agent behaviour (recorded model decisions with rationales) plugged into the simulator, plus the assistant (explain, propose, test). L4: town inflow model whose events feed the same simulation.</p>}>
        <div className="flex flex-col gap-3">
          {[
            ["L1", "Fixed rules", "Current practice as the baseline, and a validator that checks every list."],
            ["L2", "Distributions, costs, overrides", "The whole engine above: the court's own tables, judge styles, and what each costs."],
            ["L3", "People as AI agents", "Parties and advocates decide and explain; a court assistant proposes and tests changes."],
            ["L4", "A town", "Disputes in the town become cases; its strikes change the day. All in one simulation."],
            ["L5", "Plugs into the court", "Built: roster in; causelist, dates and time windows out through a simple API (create a roster, generate the causelist, suggest the next date); readiness confirmation is the first form of web check-in. Next: the court's case system, portals and SMS for check-in and cancellation, re-packing the day the way travel portals do."],
          ].map(([l, t, d], i) => (
            <motion.div key={l} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.1 }} className="card flex gap-4 p-4" style={{ marginLeft: i * 24 }}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-[14px] font-semibold text-on-primary">{l}</span>
              <span>
                <span className="block text-[16px] font-semibold text-text">{t}</span>
                {d.startsWith("Built:") ? (
                  <span className="mt-1 flex flex-col gap-1 text-[14px] text-muted">
                    <span><Badge colour={C.substantive}>built</Badge> {d.split("Next:")[0].replace("Built:", "").trim()}</span>
                    <span><Badge colour={C.baseline}>next</Badge> {(d.split("Next:")[1] ?? "").trim()}</span>
                  </span>
                ) : (
                  <span className="block text-[14px] text-muted">{d}</span>
                )}
              </span>
            </motion.div>
          ))}
        </div>
        <div className="card mt-6 border-l-2 border-l-primary p-6">
          <p className="display text-[24px] leading-snug text-text">A scheduling layer a court can bolt on: roster in; causelist, dates and time windows out.</p>
        </div>
      </Step>
    </div>
  );
}

function Step({ i, register, children, tech }: { i: number; register: (i: number, el: HTMLElement | null) => void; children: ReactNode; tech?: ReactNode }) {
  const mode = useExplain();
  const [open, setOpen] = useState(false);
  const show = open || mode === "technical";
  return (
    <section
      ref={(el) => register(i, el)}
      data-step={i}
      className="flex min-h-[calc(100vh-120px)] scroll-mt-20 flex-col justify-center py-10"
    >
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6, ease: EASE }}>
        <p className="num text-[13px] text-primary">Step {i + 1} of {TITLES.length}</p>
        <h2 className="display mb-6 mt-1 text-[32px] md:text-[40px]">{TITLES[i]}</h2>
        {children}
        {tech && (
          <div className="mt-5">
            <button onClick={() => setOpen((x) => !x)} className="flex items-center gap-1 text-[13px] text-muted hover:text-text" aria-expanded={show}>
              <ChevronDown size={14} className={clsx("transition-transform", show && "rotate-180")} /> Technical
            </button>
            <AnimatePresence initial={false}>
              {show && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-2 rounded-lg border border-line bg-surface p-4 text-[13px] leading-relaxed text-muted">{tech}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </section>
  );
}

function Score({ dim, main, vs, line, good }: { dim: string; main: string; vs: string; line: string; good?: boolean }) {
  const num = Number(main.replace(/[^\d.]/g, ""));
  const simple = /^\d+(\.\d+)?%?$/.test(main.replace(/ (h|days)$/, ""));
  return (
    <div className={clsx("card p-5", good && "border-l-2 border-l-primary")}>
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">{dim}</p>
      <p className="display mt-2 text-[36px] leading-none text-text">
        {simple && Number.isFinite(num) ? (
          <>
            <CountUp value={num} decimals={main.includes(".") ? 1 : 0} />
            {main.replace(/^[\d.]+/, "")}
          </>
        ) : (
          main
        )}
      </p>
      <p className="mt-1 text-[13px] text-faint">current practice {vs}</p>
      <p className="mt-2 text-[14px] text-muted">{line}</p>
    </div>
  );
}

function TechFormulas() {
  return <FormulaBlock lines={CORE_FORMULAS} />;
}

type Prompts = { agent?: { system_prompt?: string; what_the_agent_is_given?: Record<string, string>; what_it_returns?: string } };

async function loadAgents(): Promise<{ prompts: Prompts | null; quotes: { text: string; case_id: string; day: string }[] }> {
  const [p, r] = await Promise.all([
    fetch("/data/ai_prompts.json").then((x) => (x.ok ? x.json() : null)).catch(() => null),
    fetch("/data/run_100_combined.json").then((x) => (x.ok ? x.json() : null)).catch(() => null),
  ]);
  const quotes: { text: string; case_id: string; day: string }[] = [];
  const seen = new Set<string>();
  for (const d of (r?.days ?? []) as { date: string; listings: { case_id: string; outcome?: { rationale?: string } }[] }[])
    for (const l of d.listings) {
      const t = l.outcome?.rationale;
      if (!t) continue;
      const key = t.split(":")[0];
      if (seen.has(key) || quotes.length >= 2) continue;
      if (/seek|absent|not ready|strike|far|wage/i.test(t) || quotes.length === 0) {
        seen.add(key);
        quotes.push({ text: tidy(t), case_id: l.case_id, day: d.date });
      }
    }
  return { prompts: p, quotes };
}

function AgentsStep() {
  const data = useAsync(loadAgents, []);
  const given = data?.prompts?.agent?.what_the_agent_is_given ?? {};
  const cards = [
    { t: "Who they are", d: "Every party and advocate has a persona: diligence, reliability, distance to court, a day's wage, trust in the court, patience, and a memory of wasted trips." },
    { t: "What they are given each day", d: given.court_policy ? `The court's policy (${given.court_policy}), the matter itself, and the court's own average rates as a starting point.` : "The court's policy (time windows, readiness asked), the matter itself, and the court's own average rates as a starting point." },
    { t: "What they decide", d: "Whether to confirm readiness, whether to turn up, whether they are ready, whether to seek time, how long the hearing takes, and why." },
    { t: "How it feeds back", d: "The plan re-dates matters and calls standby matters into free time; next time, the people remember how they were treated." },
  ];
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div key={c.t} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="card p-5">
            <p className="text-[16px] font-semibold text-text">{c.t}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">{c.d}</p>
          </motion.div>
        ))}
      </div>
      {!!data?.quotes.length && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.quotes.map((q) => (
            <blockquote key={q.case_id + q.day} className="card border-l-2 border-l-primary p-4">
              <p className="text-[15px] leading-relaxed text-text">&ldquo;{q.text}&rdquo;</p>
              <footer className="mt-1 text-[12px] text-muted">
                An AI agent on <span className="mono">{q.case_id}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      )}
      <p className="mt-4 text-[13px] text-muted">
        Honest limits: the agents ran on 100 cases over 18 sitting days with a language model, and their decisions are recorded
        so the demo replays exactly. The 3,000-case scores use the statistical model of attendance.
      </p>
    </>
  );
}

function AgentPrompt() {
  const data = useAsync(loadAgents, []);
  const a = data?.prompts?.agent;
  if (!a) return <p>The agents&apos; prompt is published in ai_prompts.json.</p>;
  return (
    <div className="flex flex-col gap-2">
      {a.system_prompt && <p className="whitespace-pre-wrap">{a.system_prompt}</p>}
      {a.what_it_returns && <p>Returns: {a.what_it_returns}</p>}
    </div>
  );
}
