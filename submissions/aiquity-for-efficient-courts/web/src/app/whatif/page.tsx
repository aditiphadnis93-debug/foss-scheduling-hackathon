"use client";

import HowLink from "@/components/ui/HowLink";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Play, RotateCcw, Server, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import AgeingSlider from "@/components/ui/AgeingSlider";
import { Card, Takeaway } from "@/components/ui/Card";
import { Button, Segmented, Select, Slider, Toggle } from "@/components/ui/Controls";
import { DeltaPill } from "@/components/ui/Stat";
import { apiHealthy, compare, API_URL, type CompareResult, type Overrides } from "@/lib/api";
import { availableConfigs, fetchRun, useAsync, useRuns } from "@/lib/data";
import { fmtMetric, meta, orderedKeys } from "@/lib/metrics";
import { verdictLine } from "@/lib/verdict";
import { C, presetColour } from "@/lib/theme";
import { presetLabel, shortDate } from "@/lib/format";
import type { Roster } from "@/lib/types";
import { PREFILL_KEY } from "@/lib/agents";
import DayEditor, { type DayEdit } from "@/components/ui/DayEditor";
import WeekStrip, { Guardrails, WeekLegend } from "@/components/charts/WeekStrip";
import { toProfile, validateWeek, weekFromProfile, weekOf } from "@/lib/dayprofile";

const FLOOR = 0.2;
const SITTING_DAYS = 10;
const KEYS = [
  "utilisation_pct",
  "reach_rate_pct",
  "substantive_pct_of_heard",
  "backlog_4y_heard_pct",
  "old_minutes_share_pct",
  "predictability_gap_days",
  "next_date_sane_pct",
  "justice_weighted_progress_per_hour",
  "advocate_trips",
  "listed_per_day",
  "idle_minutes_per_day",
];

type Detail = Record<string, unknown>;
type State = {
  ageing: number;
  auto: boolean;
  fill: number;
  overbook: number;
  maxListed: number;
  cluster: number;
  fresh: number;
  age: number;
  carry: "priority" | "same_weekday" | "none";
  nextDate: "procedural" | "flat";
  readiness: boolean;
  appointments: boolean;
  horizon: boolean;
  horizonDays: number;
  correlation: boolean;
  advCap: number;
  leave: string[];
  reserve: number;
  kappa: number;
  urgent: number;
  emergency: number;
  gamingShare: number;
  gamingResponse: boolean;
  agencyMult: number;
  absence: number;
  judgeBg: "" | "criminal_bar" | "civil_bar" | "judicial_service" | "academic";
  judgeYears: number;
  learning: boolean;
};

function fromDetail(d: Detail): State {
  const w = (d.weights ?? {}) as Record<string, number>;
  const share = d.ageing_share;
  return {
    ageing: typeof share === "number" ? Math.max(FLOOR, share) : 0.25,
    auto: share === "auto",
    fill: Number(d.fill_target ?? 1),
    overbook: Number(d.overbook ?? 1),
    maxListed: Number(d.max_listed ?? 60),
    cluster: Number(w.cluster ?? 0.3),
    fresh: Number(w.fresh ?? 0),
    age: Number(w.age ?? 1),
    carry: (d.carry_over as State["carry"]) ?? "priority",
    nextDate: (d.next_date_policy as State["nextDate"]) ?? "procedural",
    readiness: Boolean(d.use_readiness ?? true),
    appointments: Boolean(d.give_appointments ?? true),
    horizon: Boolean(d.use_horizon ?? true),
    horizonDays: Number(d.horizon_days ?? 10),
    correlation: Boolean(d.advocate_correlation ?? true),
    advCap: Number(d.advocate_daily_cap ?? 6),
    leave: [],
    reserve: Number(d.reserve_minutes ?? 30),
    kappa: Number(d.risk_kappa ?? 1),
    urgent: Number(d.urgent_per_day ?? 1.5),
    emergency: Number(d.judge_emergency_p ?? 0.03),
    gamingShare: Number(d.gaming_share ?? 0.08),
    gamingResponse: Boolean(d.gaming_response ?? true),
    agencyMult: Number(d.agency_delay_mult ?? 1),
    absence: 1,
    judgeBg: ((d.judge as { background?: string } | null)?.background ?? "") as State["judgeBg"],
    judgeYears: Number((d.judge as { years_on_bench?: number } | null)?.years_on_bench ?? 5),
    learning: Boolean(d.learning ?? true),
  };
}

function diff(a: State, b: State): { overrides: Overrides; changes: string[] } {
  const o: Overrides = {};
  const ch: string[] = [];
  if (a.auto !== b.auto || (!a.auto && Math.abs(a.ageing - b.ageing) > 1e-9)) {
    o.ageing_share = a.auto ? "auto" : a.ageing;
    ch.push(a.auto ? "an automatic ageing share" : `an ageing share of ${Math.round(a.ageing * 100)}%`);
  }
  const num = (k: keyof Overrides, x: number, y: number, label: string) => {
    if (Math.abs(x - y) > 1e-9) {
      (o as Record<string, unknown>)[k] = x;
      ch.push(label);
    }
  };
  num("fill_target", a.fill, b.fill, `filling ${Math.round(a.fill * 100)}% of the day`);
  num("overbook", a.overbook, b.overbook, `overbooking by ${Math.round((a.overbook - 1) * 100)}%`);
  num("max_listed", a.maxListed, b.maxListed, `a cap of ${a.maxListed} listings`);
  num("cluster", a.cluster, b.cluster, `advocate clustering ${a.cluster.toFixed(1)}`);
  num("fresh", a.fresh, b.fresh, `fresh-first weight ${a.fresh.toFixed(1)}`);
  num("age", a.age, b.age, `age weight ${a.age.toFixed(1)}`);
  const cat = <K extends keyof State>(k: K, ok: keyof Overrides, label: string) => {
    if (a[k] !== b[k]) {
      (o as Record<string, unknown>)[ok] = a[k];
      ch.push(label);
    }
  };
  cat("carry", "carry_over", `carry-over "${a.carry.replace("_", " ")}"`);
  cat("nextDate", "next_date_policy", a.nextDate === "flat" ? "flat next dates" : "procedural next dates");
  cat("readiness", "use_readiness", a.readiness ? "the readiness check" : "no readiness check");
  cat("appointments", "give_appointments", a.appointments ? "appointment windows" : "no appointment windows");
  cat("horizon", "use_horizon", a.horizon ? "dates planned ahead" : "no dates planned ahead");
  num("horizon_days", a.horizonDays, b.horizonDays, `${a.horizonDays} days planned ahead`);
  num("advocate_daily_cap", a.advCap, b.advCap, `at most ${a.advCap} matters per advocate a day`);
  cat("correlation", "advocate_correlation", a.correlation ? "correlated advocate absence" : "independent absences");
  num("reserve_minutes", a.reserve, b.reserve, `a ${a.reserve}-minute urgent reserve`);
  num("risk_kappa", a.kappa, b.kappa, `a safety buffer of ${a.kappa.toFixed(1)}`);
  num("urgent_per_day", a.urgent, b.urgent, `${a.urgent.toFixed(1)} urgent matters a day`);
  num("judge_emergency_p", a.emergency, b.emergency, `a ${Math.round(a.emergency * 100)}% chance of a judge emergency`);
  num("gaming_share", a.gamingShare, b.gamingShare, `${Math.round(a.gamingShare * 100)}% of advocates seeking time strategically`);
  num("agency_delay_mult", a.agencyMult, b.agencyMult, `agency delays x${a.agencyMult.toFixed(1)}`);
  cat("gamingResponse", "gaming_response", a.gamingResponse ? "a firm response to strategic delay" : "no response to strategic delay");
  num("absence_mult", a.absence, b.absence, `absences x${a.absence.toFixed(1)}`);
  if (a.judgeBg !== b.judgeBg || (a.judgeBg && a.judgeYears !== b.judgeYears)) {
    o.judge = a.judgeBg ? { background: a.judgeBg, years_on_bench: a.judgeYears } : ({} as Overrides["judge"]);
    ch.push(a.judgeBg ? `a judge from the ${a.judgeBg.replace("_", " ")}, ${a.judgeYears} years on the bench` : "no judge profile");
  }
  cat("learning", "learning", a.learning ? "learning from each hearing" : "no learning");
  if (a.leave.length) {
    o.leave = a.leave;
    ch.push(`${a.leave.length} leave day${a.leave.length > 1 ? "s" : ""}`);
  }
  return { overrides: o, changes: ch };
}

export default function WhatIf() {
  const [roster, setRoster] = useState<Roster>("100");
  const configs = useAsync(() => availableConfigs("100"), []) ?? [];
  const [config, setConfig] = useState("optimal");
  const ref = useAsync(() => fetchRun("100", config), [config]);
  const defaults = useMemo(() => (ref ? fromDetail(ref.meta.config_detail) : null), [ref]);
  const [edit, setEdit] = useState<{ key: string; s: State } | null>(null);
  const [prefill, setPrefill] = useState<{ overrides: Record<string, unknown>; why?: string; question?: string } | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const raw = localStorage.getItem(PREFILL_KEY);
        if (raw) {
          setPrefill(JSON.parse(raw));
          localStorage.removeItem(PREFILL_KEY);
        }
      } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const s = edit && edit.key === config ? edit.s : defaults && prefill && config === "optimal" ? applyPrefill(defaults, prefill.overrides) : defaults;
  const set = (patch: Partial<State>) => s && setEdit({ key: config, s: { ...s, ...patch } });
  const sittingDates = (ref?.days ?? []).slice(0, SITTING_DAYS).map((d) => d.date);
  const isBase = config === "baseline";
  const presetWeek = useMemo(() => weekOf(ref, config), [ref, config]);
  const [dayEdit, setDayEdit] = useState<{ key: string; d: DayEdit } | null>(null);
  const day = dayEdit && dayEdit.key === config ? dayEdit.d : null;
  const editedWeek = day ? weekFromProfile(toProfile(day)) : null;
  const dayErrors = editedWeek ? validateWeek(editedWeek) : [];

  const [health, setHealth] = useState<"checking" | "up" | "down">("checking");
  useEffect(() => {
    let live = true;
    apiHealthy().then((ok) => live && setHealth(ok ? "up" : "down"));
    return () => {
      live = false;
    };
  }, []);

  const [result, setResult] = useState<{ r: CompareResult; changes: string[]; sentProfile: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = s && defaults ? diff(s, defaults) : { overrides: {} as Overrides, changes: [] as string[] };
  const d =
    day && editedWeek
      ? {
          overrides: { ...base.overrides, day_profile: toProfile(day) },
          changes: [...base.changes, `a ${(editedWeek.weekly / 60).toFixed(1)}-hour sitting week`],
        }
      : base;

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await compare({ roster, config, overrides: d.overrides, seed: 42, sitting_days: SITTING_DAYS }, 3);
      setResult({ r, changes: d.changes, sentProfile: !!d.overrides.day_profile });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "engine unreachable");
      setHealth("down");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Simulation"
        title="Change the recommended list. See what it costs."
        lede="Start from a court setup, change anything, and re-run ten sitting days three times over. Everything is compared with the same setup left unchanged. The oldest cases keep their floor whatever you do."
        right={
          <Segmented<Roster>
            id="wi-roster"
            value={roster}
            onChange={setRoster}
            options={[
              { value: "100", label: "100 cases" },
              { value: "3000", label: "3,000 cases (slow)" },
            ]}
          />
        }
      />

      <EngineStatus health={health} />
      {prefill && (
        <div className="selected-row mb-5 rounded-lg p-4 text-[13px]">
          <p className="font-medium text-primary">Loaded from the court assistant</p>
          {prefill.question && <p className="mt-1 text-text">&ldquo;{prefill.question}&rdquo;</p>}
          {prefill.why && <p className="mt-1 text-muted">{prefill.why}</p>}
          <p className="mt-1 text-muted">The proposed settings are filled in below. Press Run to test them, or change them first.</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        {/* controls */}
        <Card title="Your overrides" subtitle="What you change from the setup is named in the verdict." right={<HowLink id="overbooking" label="Overbooking and the buffer" />}>
          <div className="flex flex-col gap-5">
            <Select
              label="Start from"
              value={config}
              onChange={(c) => {
                setConfig(c);
                setResult(null);
              }}
              options={configs.map((c) => ({ value: c, label: presetLabel(c) }))}
            />
            {s && (
              <>
                <Group title="Oldest cases">
                  {isBase ? (
                    <p className="text-[12px] text-muted">Current practice has no ageing floor; choose another setup to see it.</p>
                  ) : (
                    <AgeingSlider value={s.ageing} auto={s.auto} floor={FLOOR} onChange={(v) => set({ ageing: v })} onAuto={(a) => set({ auto: a })} />
                  )}
                  <Slider label="Age weight" value={s.age} min={1} max={4} step={0.25} onChange={(v) => set({ age: v })} format={(v) => v.toFixed(2)} hint="Cannot go below 1: an old case is never worth less than a new one." disabled={isBase} />
                </Group>
                <Group title="How full is the day">
                  <Slider label="Fill target" value={s.fill} min={0.6} max={1.2} step={0.05} onChange={(v) => set({ fill: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Share of 420 minutes to fill with expected court time." disabled={isBase} />
                  <Slider label="How full to list the day" value={s.overbook} min={1} max={1.5} step={0.05} onChange={(v) => set({ overbook: v })} format={(v) => `+${Math.round((v - 1) * 100)}%`} hint="List beyond expected capacity, airline style." disabled={isBase} />
                  <Slider label="Safety buffer" value={s.kappa} min={0} max={2} step={0.1} onChange={(v) => set({ kappa: v })} format={(v) => v.toFixed(1)} hint="Extra minutes booked for uncertainty, in standard deviations. 0 books the average; higher keeps more matters reachable." disabled={isBase} />
                  <Slider label="Maximum listings" value={s.maxListed} min={10} max={80} step={5} onChange={(v) => set({ maxListed: v })} format={(v) => String(v)} />
                </Group>
                <Group title="Style">
                  <Slider label="Advocate clustering" value={s.cluster} min={0} max={3} step={0.1} onChange={(v) => set({ cluster: v })} format={(v) => v.toFixed(1)} hint="Small reward for each extra matter of the same advocate on one day. It only breaks near-ties." disabled={isBase} />
                  <Slider label="Most matters per advocate a day" value={s.advCap} min={1} max={20} step={1} onChange={(v) => set({ advCap: v })} format={(v) => String(v)} hint="The date plan never gives one advocate more than this on one day." disabled={isBase || !s.horizon} />
                  <Slider label="Fresh matters first" value={s.fresh} min={0} max={5} step={0.25} onChange={(v) => set({ fresh: v })} format={(v) => v.toFixed(2)} disabled={isBase} />
                  <Select<State["carry"]>
                    label="Unreached matters return"
                    value={s.carry}
                    onChange={(v) => set({ carry: v })}
                    options={[
                      { value: "priority", label: "Next sitting, higher priority" },
                      { value: "same_weekday", label: "Same weekday next week" },
                      { value: "none", label: "No special treatment" },
                    ]}
                  />
                  <Select<State["nextDate"]>
                    label="Next dates"
                    value={s.nextDate}
                    onChange={(v) => set({ nextDate: v })}
                    options={[
                      { value: "procedural", label: "Procedural (what the next step needs)" },
                      { value: "flat", label: "Flat 60 days" },
                    ]}
                  />
                </Group>
                <Group title="Dates planned ahead">
                  <Toggle label="Plan dates ahead" hint="Publish provisional dates people can plan around" checked={s.horizon} onChange={(v) => set({ horizon: v })} />
                  <Slider label="Days planned ahead" value={s.horizonDays} min={5} max={20} step={1} onChange={(v) => set({ horizonDays: v })} format={(v) => `${v} sitting days`} hint="Every evening the list re-plans this many sitting days ahead: tomorrow is final, the rest are provisional dates people can plan around." disabled={!s.horizon} />
                </Group>
                <Group title="Court practice">
                  <Toggle label="Readiness check" hint="Keep matters with a pending summons off the list" checked={s.readiness} onChange={(v) => set({ readiness: v })} />
                  <Toggle label="Appointment windows" hint="Tell every party when to come" checked={s.appointments} onChange={(v) => set({ appointments: v })} />
                  <Toggle label="Correlated advocate absence" hint="An absent advocate misses all their matters" checked={s.correlation} onChange={(v) => set({ correlation: v })} />
                </Group>
                <Group title="Behaviour and the unexpected">
                  <Slider label="Urgent reserve" value={s.reserve} min={0} max={90} step={5} onChange={(v) => set({ reserve: v })} format={(v) => `${v} min`} hint="Minutes held back each day for urgent and emergency matters." />
                  <Slider label="Urgent arrivals per day" value={s.urgent} min={0} max={6} step={0.5} onChange={(v) => set({ urgent: v })} format={(v) => v.toFixed(1)} hint="Bail, stay, urgent mention." />
                  <Slider label="Judge emergency chance" value={s.emergency} min={0} max={0.2} step={0.01} onChange={(v) => set({ emergency: v })} format={(v) => `${Math.round(v * 100)}%`} hint="The judge loses part of a day; the tail is re-planned with priority." />
                  <Slider label="Strategic time-seeking" value={s.gamingShare} min={0} max={0.4} step={0.02} onChange={(v) => set({ gamingShare: v })} format={(v) => `${Math.round(v * 100)}%`} hint="Share of advocates who seek time as a case nears evidence or judgement." />
                  <Toggle label="Respond to strategic delay" hint="Last chance, firm short date; the other side is not penalised" checked={s.gamingResponse} onChange={(v) => set({ gamingResponse: v })} />
                  <Slider label="State agency delays" value={s.agencyMult} min={0.5} max={3} step={0.1} onChange={(v) => set({ agencyMult: v })} format={(v) => `x${v.toFixed(1)}`} hint="Process service, police, forensics." />
                  <Slider label="How often people stay away" value={s.absence} min={0.5} max={3} step={0.1} onChange={(v) => set({ absence: v })} format={(v) => `x${v.toFixed(1)}`} hint="Multiplies every chance that a party or advocate does not come." />
                  <Toggle label="Learn from each hearing" hint="Update attendance and readiness per advocate and party" checked={s.learning} onChange={(v) => set({ learning: v })} />
                </Group>
                <Group title="Who is hearing">
                  <Select<State["judgeBg"]>
                    label="Judge background"
                    value={s.judgeBg}
                    onChange={(v) => set({ judgeBg: v })}
                    options={[
                      { value: "", label: "Not set (usual hearing times)" },
                      { value: "criminal_bar", label: "From the criminal bar" },
                      { value: "civil_bar", label: "From the civil bar" },
                      { value: "judicial_service", label: "Judicial service" },
                      { value: "academic", label: "Academic" },
                    ]}
                  />
                  <Slider label="Years on the bench" value={s.judgeYears} min={0} max={25} step={0.5} onChange={(v) => set({ judgeYears: v })} format={(v) => `${v} y`} hint="A new judge takes longer at first; this fades with experience." disabled={!s.judgeBg} />
                </Group>
                <Group title="Your day">
                  <p className="text-[12px] text-muted">
                    Shape the default sitting day (applies Monday to Friday). Guardrails are checked as you type.
                  </p>
                  {day ? (
                    <DayEditor value={day} onChange={(v) => setDayEdit({ key: config, d: v })} />
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setDayEdit({ key: config, d: { sittings: presetWeek.days[0].sittings, admin: presetWeek.days[0].admin } })}
                    >
                      Edit the day
                    </Button>
                  )}
                  <WeekStrip week={editedWeek ?? presetWeek} compact />
                  {dayErrors.length > 0 && (
                    <ul className="flex flex-col gap-1 rounded-lg border border-danger/40 bg-bg p-3 text-[12px] text-danger">
                      {dayErrors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {day && (
                    <button onClick={() => setDayEdit(null)} className="self-start text-[12px] text-primary hover:underline">
                      Back to the setup&apos;s day
                    </button>
                  )}
                </Group>
                <Group title="Judge on leave">
                  <div className="flex flex-wrap gap-1.5">
                    {sittingDates.map((dt) => {
                      const on = s.leave.includes(dt);
                      return (
                        <button
                          key={dt}
                          onClick={() => set({ leave: on ? s.leave.filter((x) => x !== dt) : [...s.leave, dt] })}
                          className={clsx(
                            "num rounded-lg px-2 py-1 text-[12px] ring-1 transition",
                            on ? "bg-adj/15 text-adj ring-adj/40" : "text-muted ring-line hover:text-text",
                          )}
                        >
                          {shortDate(dt)}
                        </button>
                      );
                    })}
                  </div>
                </Group>
                <div className="flex gap-2">
                  <Button onClick={run} disabled={busy || dayErrors.length > 0} className="flex-1">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                    {busy ? "Running 2 x 3 simulations..." : "Run what-if"}
                  </Button>
                  <Button variant="ghost" onClick={() => setEdit(null)}>
                    <RotateCcw size={15} />
                  </Button>
                </div>
                {d.changes.length > 0 && <p className="text-[12px] text-muted">Changed: {d.changes.join(", ")}.</p>}
                {err && <p className="text-[12px] text-adj">The engine did not answer ({err}).</p>}
              </>
            )}
          </div>
        </Card>

        {/* results */}
        <div className="flex min-w-0 flex-col gap-5">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div key="res" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Results result={result} />
              </motion.div>
            ) : busy ? (
              <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="card grid h-64 place-items-center">
                <div className="flex flex-col items-center gap-3 text-muted">
                  <Loader2 className="animate-spin text-primary" />
                  <p className="text-[13px]">Simulating ten sitting days, three seeds each, with and without your changes.</p>
                </div>
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="card p-6 text-[14px] text-muted">
                {health === "down"
                  ? "The live engine is not running, so compare two saved setups below instead."
                  : "Change any override on the left and press Run. The verdict appears here in one sentence, with every measure underneath."}
              </motion.div>
            )}
          </AnimatePresence>
          <Card title="The shape of the day" subtitle={`${presetLabel(config)} as set up`}>
            <WeekStrip week={presetWeek} />
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.3fr] lg:items-start">
              <WeekLegend />
              <Guardrails />
            </div>
          </Card>
          <PresetCompare configs={configs} />
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{title}</p>
      {children}
    </div>
  );
}

function EngineStatus({ health }: { health: "checking" | "up" | "down" }) {
  if (health === "up")
    return (
      <div className="mb-5 flex items-center gap-2 text-[12px] text-muted">
        <span className="h-2 w-2 rounded-full bg-sub" /> Live engine connected
      </div>
    );
  if (health === "checking") return <div className="mb-5 h-[18px]" />;
  return (
    <div className="card mb-5 flex flex-col gap-3 p-5 md:flex-row md:items-center">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary">
        <Server size={18} />
      </div>
      <div className="flex-1">
        <p className="font-medium">Start the local engine to run live what-ifs</p>
        <p className="mt-1 text-[13px] text-muted">
          From <span className="num">submissions/aiquity-for-efficient-courts</span> run{" "}
          <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-text">
            PYTHONPATH=src uvicorn causelist.api:app --port 8000
          </code>{" "}
          then reload. Looking for it at <span className="num">{API_URL}</span>.
        </p>
      </div>
    </div>
  );
}

function Results({ result }: { result: { r: CompareResult; changes: string[]; sentProfile: boolean } }) {
  const { base, modified } = result.r;
  const mean = (m: CompareResult["base"]) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v?.mean]));
  const b = mean(base);
  const m = mean(modified);
  const line = verdictLine(result.changes, b, m, SITTING_DAYS);
  const keys = orderedKeys([...KEYS.filter((k) => k in base), ...Object.keys(base)]);
  return (
    <div className="flex flex-col gap-5">
      <div className="card relative overflow-hidden border-l-2 border-l-primary bg-primary-subtle p-6">
        <p className="text-[11px] uppercase tracking-[0.16em] text-primary">Verdict</p>
        <p className="display mt-2 text-[20px] leading-snug">{line}</p>
        <p className="mt-3 text-[12px] text-faint">Average of three simulated runs of ten sitting days, against the setup left unchanged.</p>
        {result.sentProfile && !("sitting_minutes_per_day" in result.r.modified) && (
          <p className="mt-2 text-[12px] text-muted">
            Your day profile was sent to the engine as <span className="mono">day_profile</span>. The engine did not report
            sitting minutes back, so it may not apply day profiles yet; if so, these numbers use the setup&apos;s own day.
          </p>
        )}
      </div>
      <Card title="Your version vs the setup" subtitle="Bars show the average; the thin line shows the range across runs.">
        <div className="flex flex-col gap-3">
          {keys.filter((k) => KEYS.includes(k)).map((k) => (
            <PairRow key={k} k={k} base={base[k]} mod={modified[k]} />
          ))}
        </div>
        <Takeaway>
          Blue is your version, grey is the setup untouched. Read the pill on the right: green means your change
          helps the court on that measure.
        </Takeaway>
      </Card>
    </div>
  );
}

function PairRow({ k, base, mod }: { k: string; base?: { mean: number; p10: number; p90: number }; mod?: { mean: number; p10: number; p90: number } }) {
  if (!base || !mod) return null;
  const max = Math.max(base.p90, mod.p90, base.mean, mod.mean, 1e-9) * 1.1;
  const bar = (s: { mean: number; p10: number; p90: number }, colour: string, delay: number) => (
    <div className="relative h-3">
      <div className="absolute inset-0 rounded bg-surface-2" />
      <motion.div className="absolute inset-y-0 left-0 rounded" style={{ background: colour }} initial={{ width: 0 }} animate={{ width: `${(s.mean / max) * 100}%` }} transition={{ duration: 0.8, delay }} />
      {s.p90 > s.p10 && (
        <div className="absolute top-1/2 h-px -translate-y-1/2 bg-text" style={{ left: `${(s.p10 / max) * 100}%`, width: `${((s.p90 - s.p10) / max) * 100}%` }} />
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-[170px_1fr_150px] items-center gap-4">
      <span className="text-[13px] text-text">{meta(k).label}</span>
      <div className="flex flex-col gap-1">
        {bar(base, C.baseline, 0)}
        {bar(mod, C.ours, 0.15)}
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="num text-[12px] text-muted">{fmtMetric(k, mod.mean)}</span>
        <DeltaPill k={k} a={mod.mean} b={base.mean} />
      </div>
    </div>
  );
}

function PresetCompare({ configs }: { configs: string[] }) {
  const [a, setA] = useState("optimal");
  const [b, setB] = useState("baseline");
  const { runs } = useRuns("100", [a, b]);
  const ra = runs[a];
  const rb = runs[b];
  return (
    <Card
      title="Compare two court setups"
      subtitle="Saved full-period simulations on the 100-case roster. Works without the live engine."
      right={
        <div className="flex flex-wrap items-end gap-2">
          <Select value={a} onChange={setA} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
          <span className="pb-2 text-[12px] text-muted">vs</span>
          <Select value={b} onChange={setB} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
        </div>
      }
    >
      {!ra || !rb ? (
        <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-surface-2 p-4 text-[15px] leading-snug">
            <span className="mr-2 inline-flex items-center gap-1.5 text-[12px] text-muted">
              <TriangleAlert size={13} className="text-primary" /> In plain words
            </span>
            {verdictLine([`Choosing ${presetLabel(a)} over ${presetLabel(b)}`], rb.metrics, ra.metrics, ra.meta.sitting_days)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {KEYS.filter((k) => k in ra.metrics).map((k) => (
              <div key={k} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 ring-1 ring-line">
                <span className="text-[13px] text-muted">{meta(k).label}</span>
                <span className="flex items-center gap-2">
                  <span className="num text-[13px]" style={{ color: presetColour(a, configs) }}>
                    {fmtMetric(k, ra.metrics[k])}
                  </span>
                  <DeltaPill k={k} a={ra.metrics[k]} b={rb.metrics[k]} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function applyPrefill(d: State, o: Record<string, unknown>): State {
  const n = (k: string, v: number) => (typeof o[k] === "number" ? (o[k] as number) : v);
  const b = (k: string, v: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : v);
  const share = o.ageing_share;
  return {
    ...d,
    ageing: typeof share === "number" ? Math.max(FLOOR, share) : d.ageing,
    auto: share === "auto" ? true : typeof share === "number" ? false : d.auto,
    fill: n("fill_target", d.fill),
    overbook: n("overbook", d.overbook),
    maxListed: n("max_listed", d.maxListed),
    cluster: n("cluster", d.cluster),
    fresh: n("fresh", d.fresh),
    age: n("age", d.age),
    reserve: n("reserve_minutes", d.reserve),
    kappa: n("risk_kappa", d.kappa),
    urgent: n("urgent_per_day", d.urgent),
    readiness: b("use_readiness", d.readiness),
    appointments: b("give_appointments", d.appointments),
    horizon: b("use_horizon", d.horizon),
    horizonDays: n("horizon_days", d.horizonDays),
    advCap: n("advocate_daily_cap", d.advCap),
    carry: (typeof o.carry_over === "string" ? o.carry_over : d.carry) as State["carry"],
    nextDate: (typeof o.next_date_policy === "string" ? o.next_date_policy : d.nextDate) as State["nextDate"],
  };
}
