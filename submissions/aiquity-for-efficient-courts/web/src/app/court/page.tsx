"use client";

import HowLink from "@/components/ui/HowLink";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, X } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import DayClock, { placeDay, type Placed } from "@/components/charts/DayClock";
import { Card, Badge, Skeleton, Takeaway } from "@/components/ui/Card";
import { Segmented, Select, Tabs, Button } from "@/components/ui/Controls";
import { availableConfigs, preferredRoster, useAsync, useRun } from "@/lib/data";
import { C, OUTCOME_COLOUR, OUTCOME_LABEL, presetColour } from "@/lib/theme";
import { dateLabel, downloadCsv, pct, presetLabel, pretty, shortDate, whyList } from "@/lib/format";
import { saveAnnotations, type Annotation } from "@/lib/annotations";
import type { Day, Roster, Run } from "@/lib/types";
import PersonCalendar from "@/components/charts/PersonCalendar";
import { changesToday } from "@/lib/courtday";
import { Technical } from "@/components/shell/Explain";
import CourtAssistant from "@/components/ui/Assistant";
import PlannedLine from "@/components/ui/PlannedLine";
import SittingBoxes from "@/components/charts/SittingBoxes";
import { isAgent, journeyMap, rationaleOf, tidy, type Journey } from "@/lib/agents";
import { Info, Siren, Zap } from "lucide-react";
import {
  STAKEHOLDER_COLOUR,
  STAKEHOLDER_LABEL,
  caseDelayHistory,
  checklistFor,
  dayFlags,
  gamingFor,
  recommendationFor,
} from "@/lib/insights";

type View = "advocates" | "list" | "held";

export default function CourtDay() {
  // open on the 100-case court where the people are AI agents (the demo view); fall back to the usual pick
  const initialRoster = useAsync(
    () => fetch("/data/run_100_agents.json", { method: "HEAD" })
      .then((r) => (r.ok ? ("100" as Roster) : preferredRoster(["optimal"])))
      .catch(() => preferredRoster(["optimal"])),
    [],
  );
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initialRoster;
  const baseConfigs = useAsync(() => (roster ? availableConfigs(roster) : Promise.resolve([])), [roster]) ?? [];
  const hasAgents = useAsync(
    () => (roster === "100" ? fetch("/data/run_100_agents.json", { method: "HEAD" }).then((r) => r.ok).catch(() => false) : Promise.resolve(false)),
    [roster],
  );
  const hasCombined = useAsync(
    () => (roster === "100" ? fetch("/data/run_100_combined.json", { method: "HEAD" }).then((r) => r.ok).catch(() => false) : Promise.resolve(false)),
    [roster],
  );
  const configs = [...(hasCombined ? ["combined"] : []), ...(hasAgents ? ["agents"] : []), ...baseConfigs];
  const journeys = useAsync(journeyMap, []);
  const [configPick, setConfig] = useState<string | null>(null);
  const config =
    configPick && configs.includes(configPick)
      ? configPick
      : configs.includes("combined")
        ? "combined"
        : configs.includes("agents")
        ? "agents"
        : configs.includes("optimal")
        ? "optimal"
        : configs.find((c) => c !== "baseline") ?? configs[0] ?? null;
  const { data: run, loading } = useRun(roster, config);
  const [dayIdx, setDayIdx] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("advocates");

  const day: Day | null = run?.days[Math.min(dayIdx, (run?.days.length ?? 1) - 1)] ?? null;
  const dayStart = String(run?.meta.config_detail?.day_start ?? "10:30");
  const dayMinutes = Number(run?.meta.config_detail?.day_minutes ?? 420);
  const placed = useMemo(() => (day ? placeDay(day, dayStart) : []), [day, dayStart]);
  const sel = placed.find((p) => p.case_id === selected) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Court day"
        title="Watch one day of the court play out"
        lede="Every matter has an appointment window, an expected length and a stated chance of going ahead. Press play: the court clock runs on the minutes each hearing actually took, and every matter lights up with what happened."
        right={
          <>
            <Segmented<Roster>
              id="court-roster"
              value={roster ?? "100"}
              onChange={(r) => {
                setRoster(r);
                setDayIdx(0);
                setSelected(null);
              }}
              options={[
                { value: "100", label: "100 cases" },
                { value: "3000", label: "3,000 cases" },
              ]}
            />
            <div className="min-w-[200px]">
              <Select
                value={config ?? ""}
                onChange={(c) => {
                  setConfig(c);
                  setSelected(null);
                }}
                options={configs.map((c) => ({ value: c, label: presetLabel(c) }))}
              />
            </div>
          </>
        }
      />

      {loading || !run || !day ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-[480px]" />
          {!loading && !run && <p className="text-muted">This setup has not been simulated for this roster yet.</p>}
        </div>
      ) : (
        <>
          <DayStrip run={run} idx={dayIdx} onPick={(i) => { setDayIdx(i); setSelected(null); }} />
          <TownBanner run={run} date={day.date} />
          <DaySummary day={day} placed={placed} dayMinutes={dayMinutes} config={config ?? ""} />
          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_340px]">
            <Card className="min-w-0">
              <PlannedLine run={run} />
              <SittingBoxes run={run} day={day} />
              <DayClock
                run={run}
                day={day}
                note={(l) => {
                  const r = rationaleOf(l, day.date, journeys);
                  return r ? tidy(r) : null;
                }}
                selected={selected}
                onSelect={setSelected}
                autoPlayKey={`${roster}-${config}-${day.date}`}
              />
              <Takeaway>
                Violet diamonds past the dashed line are matters the day could not reach. A list sized in expected
                minutes keeps them rare; a list of sixty makes them the norm. Click any matter for the reasoning.
              </Takeaway>
            </Card>
            <div className="flex min-w-0 flex-col gap-5">
              <CourtAssistant day={day.date} onCite={(c) => setSelected(c)} runFile={`run_${roster}_${config}.json`} />
              <SidePanel sel={sel} day={day} run={run} journeys={journeys} roster={roster ?? "100"} config={config ?? ""} onClose={() => setSelected(null)} />
            </div>
          </div>

          <ChangesToday run={run} day={day} />
          <HowLink id="day" label="What happens on the day" className="mt-2 inline-block" />
          {sel && <PersonCard run={run} sel={sel} date={day.date} />}

          <Card className="mt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Tabs<View>
                id="court-view"
                value={view}
                onChange={setView}
                tabs={[
                  { value: "advocates", label: "By advocate" },
                  { value: "list", label: "Causelist as printed" },
                  { value: "held", label: `Held back (${day.held_back.length + (day.held_back_capacity ?? 0)})` },
                ]}
              />
              <Button variant="ghost" onClick={() => downloadCsv(`causelist_${roster}_${config}_${day.date}.csv`, csvRows(placed, day))}>
                <Download size={15} /> Download CSV
              </Button>
            </div>
            {view === "advocates" && <Advocates placed={placed} onPick={setSelected} />}
            {view === "list" && <Printed placed={placed} onPick={setSelected} selected={selected} />}
            {view === "held" && <Held day={day} />}
          </Card>
        </>
      )}
    </div>
  );
}

function csvRows(placed: Placed[], day: Day) {
  return placed.map((p) => ({
    date: day.date,
    item: p.item,
    slot: p.slot,
    window: `${p.start}-${p.end}`,
    case_number: p.case_id,
    purpose: p.purpose,
    advocate: p.advocate,
    expected_minutes: p.exp_min,
    p_goes_ahead: p.p_ahead,
    p_moves_forward: p.p_sub,
    why_listed: whyList(p.why).join("; "),
    simulated_outcome: p.outcome?.kind ?? "",
    reason: p.outcome?.reason ?? "",
    minutes_used: p.outcome?.minutes ?? "",
    recommended_next_date: p.outcome?.next_date ?? "",
    next_purpose: p.outcome?.next_purpose ?? "",
  }));
}

function DayStrip({ run, idx, onPick }: { run: Run; idx: number; onPick: (i: number) => void }) {
  const max = Math.max(1, ...run.days.map((d) => Math.max(d.minutes_used, d.expected)));
  return (
    <div className="card mb-5 p-4">
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span>Sitting days · bar height is court minutes used</span>
        <span className="num text-text">{dateLabel(run.days[idx]?.date, true)}</span>
      </div>
      <div className="scroll-thin flex items-end gap-1 overflow-x-auto pb-1">
        {run.days.map((d, i) => (
          <button
            key={d.date}
            onClick={() => onPick(i)}
            title={`${dateLabel(d.date, true)}: ${Math.round(d.minutes_used)} min used, ${d.listings.length} listed`}
            className="group flex w-[18px] shrink-0 flex-col items-center gap-1"
          >
            <span className="flex h-14 w-full items-end">
              <motion.span
                className="w-full rounded-t-[3px]"
                style={{ background: i === idx ? C.ours : "var(--border)" }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(6, (d.minutes_used / max) * 100)}%` }}
                transition={{ duration: 0.6, delay: i * 0.008 }}
              />
            </span>
            <span className={clsx("num text-[9px]", i === idx ? "text-primary" : "text-faint group-hover:text-muted")}>
              {shortDate(d.date).split(" ")[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DaySummary({ day, placed, dayMinutes, config }: { day: Day; placed: Placed[]; dayMinutes: number; config: string }) {
  const n = (k: string) => placed.filter((p) => p.outcome?.kind === k).length;
  const cells = [
    { label: "Listed", value: String(placed.length), colour: presetColour(config) },
    { label: "Expected minutes", value: `${Math.round(day.expected)} / ${dayMinutes}` },
    { label: "Minutes used", value: String(Math.round(day.minutes_used)) },
    { label: "Moved forward", value: String(n("substantive")), colour: C.substantive },
    { label: "Not reached", value: String(n("not_reached")), colour: C.not_reached },
    { label: "Held back", value: String(day.held_back.length + (day.held_back_capacity ?? 0)), colour: C.not_ready },
  ];
  const f = dayFlags(day);
  return (
    <>
    {(f.urgent > 0 || f.reserveUsed > 0 || f.emergency) && (
      <div className="mb-3 flex flex-wrap gap-2">
        {f.urgent > 0 && (
          <Badge colour={C.primary}>
            <Zap size={12} /> {f.urgent} urgent matter{f.urgent > 1 ? "s" : ""} taken in
          </Badge>
        )}
        {f.reserveUsed > 0 && (
          <Badge colour={C.primary}>
            reserve used <span className="num">{Math.round(f.reserveUsed)}</span> min
          </Badge>
        )}
        {f.emergency && (
          <Badge colour={C.danger}>
            <Siren size={12} /> judge emergency: the rest of the day was re-planned with priority
          </Badge>
        )}
      </div>
    )}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="card px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{c.label}</p>
          <p className="num mt-1 text-[22px] font-semibold" style={c.colour ? { color: c.colour } : undefined}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
    </>
  );
}

function SidePanel({
  sel,
  day,
  run,
  journeys,
  roster,
  config,
  onClose,
}: {
  sel: Placed | null;
  day: Day;
  run: Run;
  journeys: Map<string, Journey> | null;
  roster: string;
  config: string;
  onClose: () => void;
}) {
  return (
    <div className="card relative min-h-[360px] overflow-hidden p-5">
      <AnimatePresence mode="wait">
        {!sel ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[14px] text-muted">
            <p className="text-[11px] uppercase tracking-[0.14em] text-primary">Why this matter?</p>
            <p className="mt-3 leading-relaxed">
              Click any matter on the clock to see why it was listed, the chance it goes ahead, what happened, and the
              next date the court would give. You can agree or disagree with each prediction; your notes are the data
              that recalibrates the model to this court.
            </p>
          </motion.div>
        ) : (
          <motion.div key={sel.case_id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="num text-[18px] font-semibold" style={(sel.age ?? 0) >= 4 ? { color: C.old } : undefined}>
                  {sel.case_id}
                </p>
                <p className="text-[13px] text-muted">
                  {pretty(sel.purpose)} · {sel.advocate}
                  {sel.age !== null && ` · ${sel.age.toFixed(1)} yrs pending`}
                </p>
              </div>
              <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-text" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Mini label="Window" value={`${sel.start}-${sel.end}`} />
              <Mini label="Expected" value={`${sel.exp_min.toFixed(0)} min`} />
              <Mini label="Chance it goes ahead" value={pct(sel.p_ahead)} />
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: pct(sel.p_ahead) }} />
            </div>
            {(() => {
              const r = rationaleOf(sel, day.date, journeys);
              if (!r && !isAgent(sel)) return null;
              return (
                <div className="mt-4 rounded-lg border border-line bg-primary-subtle p-3">
                  <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-primary">
                    <Badge colour={C.primary}>AI agent</Badge> The people in this matter decided
                  </p>
                  {r ? (
                    <p className="mt-2 text-[14px] leading-relaxed text-text">&ldquo;{tidy(r)}&rdquo;</p>
                  ) : (
                    <p className="mt-2 text-[13px] text-muted">Whether to come, be ready or seek time was decided by the parties&apos; and advocate&apos;s agents.</p>
                  )}
                </div>
              );
            })()}
            <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-muted">Why listed</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {whyList(sel.why).map((w) => (
                <Badge key={w} className="bg-surface-2 text-text ring-1 ring-line">
                  {w}
                </Badge>
              ))}
            </div>
            <Technical>
              <div className="mt-2 rounded-lg bg-surface-2 p-2 text-[11px] text-muted">
                <p className="mono">why: {sel.why.join(" · ")}</p>
                <p className="mono mt-1">
                  p_ahead {sel.p_ahead.toFixed(3)} · p_sub {sel.p_sub.toFixed(3)} · exp_min {sel.exp_min.toFixed(1)} · score {sel.score.toFixed(3)}
                  {sel.outcome ? ` · decided_by ${sel.outcome.decided_by}` : ""}
                </p>
              </div>
            </Technical>
            {sel.outcome && (
              <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <Badge colour={OUTCOME_COLOUR[sel.outcome.kind]}>{OUTCOME_LABEL[sel.outcome.kind]}</Badge>
                  <span className="num text-[12px] text-muted">{sel.outcome.minutes.toFixed(1)} min</span>
                </div>
                {sel.outcome.reason && <p className="mt-2 text-[13px] text-muted">{sel.outcome.reason}</p>}
                <p className="mt-2 text-[13px]">
                  Next date{" "}
                  <span className="num text-primary">{sel.outcome.next_date ? dateLabel(sel.outcome.next_date, true) : "disposed"}</span>
                  {sel.outcome.next_purpose && <span className="text-muted"> for {pretty(sel.outcome.next_purpose)}</span>}
                </p>
              </div>
            )}
            <Recommendation sel={sel} day={day} run={run} />
            <Annotate key={`${sel.case_id}-${day.date}`} sel={sel} day={day} roster={roster} config={config} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{label}</p>
      <p className="num text-[14px] text-text">{value}</p>
    </div>
  );
}

type Verdict = "agree" | "disagree" | null;

function Annotate({ sel, day, roster, config }: { sel: Placed; day: Day; roster: string; config: string }) {
  const [v, setV] = useState<Record<string, Verdict>>({});
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fields: { key: Annotation["field"]; label: string; predicted: string | number | null }[] = [
    { key: "p_goes_ahead", label: `Goes ahead ${pct(sel.p_ahead)}`, predicted: sel.p_ahead },
    { key: "expected_minutes", label: `${sel.exp_min.toFixed(0)} minutes`, predicted: sel.exp_min },
    { key: "next_date", label: `Next date ${sel.outcome?.next_date ? shortDate(sel.outcome.next_date) : "--"}`, predicted: sel.outcome?.next_date ?? null },
  ];
  const save = async () => {
    const items: Annotation[] = fields
      .filter((f) => v[f.key])
      .map((f) => ({
        case_id: sel.case_id,
        day: day.date,
        field: f.key,
        predicted: f.predicted,
        judge_value: v[f.key],
        note,
        annotator: "judge",
        config,
        roster,
        saved_at: new Date().toISOString(),
      }));
    if (!items.length && note.trim())
      items.push({ case_id: sel.case_id, day: day.date, field: "listed", predicted: "listed", judge_value: "note", note, annotator: "judge", config, roster });
    if (!items.length) {
      setStatus("Mark agree or disagree on at least one prediction, or add a note.");
      return;
    }
    const r = await saveAnnotations(items);
    setStatus(`${items.length} note${items.length > 1 ? "s" : ""} saved ${r.remote ? "to the engine" : r.local ? "in this browser" : "(storage unavailable)"}.`);
  };
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Judge&apos;s view of the predictions</p>
      <div className="mt-2 flex flex-col gap-2">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <span className="text-[13px]">{f.label}</span>
            <span className="flex gap-1">
              {(["agree", "disagree"] as const).map((x) => (
                <button
                  key={x}
                  onClick={() => setV((s) => ({ ...s, [f.key]: s[f.key] === x ? null : x }))}
                  className={clsx(
                    "flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] ring-1 transition",
                    v[f.key] === x
                      ? x === "agree"
                        ? "bg-sub/15 text-sub ring-sub/40"
                        : "bg-adj/15 text-adj ring-adj/40"
                      : "text-muted ring-line hover:text-text",
                  )}
                >
                  {x === "agree" ? <Check size={12} /> : <X size={12} />}
                  {x}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional): e.g. accused is in custody, will be produced"
        rows={2}
        className="mt-3 w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-text outline-none placeholder:text-faint focus:ring-2 focus:ring-primary/40"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={save} className="px-3 py-1.5 text-[13px]">
          Save
        </Button>
        <AnimatePresence>
          {status && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[12px] text-muted">
              {status}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Advocates({ placed, onPick }: { placed: Placed[]; onPick: (id: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const p of placed) m.set(p.advocate, [...(m.get(p.advocate) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].item - b[1][0].item);
  }, [placed]);
  const multi = groups.filter((g) => g[1].length > 1).length;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(([adv, ps], gi) => (
          <motion.div
            key={adv}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(gi, 20) * 0.02 }}
            className="rounded-lg border border-line bg-surface-2 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="num text-[13px] text-text">{adv}</span>
              <span className="text-[11px] text-muted">
                {ps.length} matter{ps.length > 1 ? "s" : ""} · from {ps.map((p) => p.start).sort()[0]}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ps.map((p) => (
                <button
                  key={p.case_id}
                  onClick={() => onPick(p.case_id)}
                  className="num rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-line hover:ring-faint"
                  style={{ color: p.outcome ? OUTCOME_COLOUR[p.outcome.kind] : undefined }}
                >
                  {p.case_id}
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
      <Takeaway>
        {multi} advocate{multi === 1 ? " has" : "s have"} more than one matter today, placed together so one trip to
        court covers them all. Colours are each matter&apos;s outcome.
      </Takeaway>
    </>
  );
}

function Printed({ placed, onPick, selected }: { placed: Placed[]; onPick: (id: string) => void; selected: string | null }) {
  return (
    <div className="scroll-thin max-h-[520px] overflow-auto">
      <table className="w-full min-w-[980px] text-left text-[12px]">
        <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.1em] text-muted">
          <tr>
            {["#", "Window", "Case", "Purpose", "Advocate", "Expected min", "Chance it goes ahead", "Why listed", "Outcome", "Next date"].map((h) => (
              <th key={h} className="border-b border-line px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {placed.map((p) => (
            <tr
              key={p.case_id}
              onClick={() => onPick(p.case_id)}
              className={clsx("cursor-pointer border-b border-line hover:bg-surface-2", selected === p.case_id && "selected-row")}
            >
              <td className="num px-2 py-1.5 text-faint">{p.item}</td>
              <td className="num px-2 py-1.5">{p.start}-{p.end}</td>
              <td className="num px-2 py-1.5" style={(p.age ?? 0) >= 4 ? { color: C.old } : undefined}>
                {p.case_id}
              </td>
              <td className="px-2 py-1.5">{pretty(p.purpose)}</td>
              <td className="num px-2 py-1.5 text-muted">{p.advocate}</td>
              <td className="num px-2 py-1.5">{p.exp_min.toFixed(1)}</td>
              <td className="num px-2 py-1.5">{pct(p.p_ahead)}</td>
              <td className="max-w-[260px] truncate px-2 py-1.5 text-muted" title={whyList(p.why).join("; ")}>
                {whyList(p.why).join("; ")}
              </td>
              <td className="px-2 py-1.5">
                {p.outcome && <Badge colour={OUTCOME_COLOUR[p.outcome.kind]}>{OUTCOME_LABEL[p.outcome.kind]}</Badge>}
              </td>
              <td className="num px-2 py-1.5">{p.outcome?.next_date ? shortDate(p.outcome.next_date) : p.outcome ? "disposed" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Held({ day }: { day: Day }) {
  const groups = useMemo(() => {
    const m = new Map<string, { case_id: string; reason: string }[]>();
    for (const h of day.held_back) {
      const g = h.reason.startsWith("prerequisite") ? "Prerequisite pending" : h.reason;
      m.set(g, [...(m.get(g) ?? []), h]);
    }
    return [...m.entries()];
  }, [day]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        {groups.map(([g, rows]) => (
          <Badge key={g} colour={C.not_ready}>
            {g}: <span className="num">{rows.length}</span>
          </Badge>
        ))}
        {(day.held_back_capacity ?? 0) > 0 && (
          <Badge colour={C.baseline}>
            Ready, but the day was full: <span className="num">{day.held_back_capacity}</span>
          </Badge>
        )}
      </div>
      {day.held_back.length === 0 ? (
        <p className="text-[13px] text-muted">No matter was held back for a known prerequisite today.</p>
      ) : (
        <div className="scroll-thin grid max-h-[360px] gap-1.5 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
          {day.held_back.map((h) => (
            <div key={h.case_id} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-[12px]">
              <span className="num text-text">{h.case_id}</span>
              <span className="text-muted">{h.reason.replace("prerequisite pending until ", "ready ")}</span>
            </div>
          ))}
        </div>
      )}
      <Takeaway>
        A matter whose summons has not come back would only be adjourned, so it is kept off the list with the date it
        is expected to be ready. Ready matters that did not fit carry a higher priority tomorrow.
      </Takeaway>
    </div>
  );
}

function Recommendation({ sel, day, run }: { sel: Placed; day: Day; run: Run }) {
  const rec = recommendationFor(run, day, sel);
  const checklist = checklistFor(sel);
  const gaming = gamingFor(run, sel.advocate);
  const history = caseDelayHistory(run, sel.case_id);
  const hist = Object.entries(history).sort((a, b) => b[1] - a[1]);
  const total = hist.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="mt-4 flex flex-col gap-4">
      {rec && (
        <div className="selected-row rounded-lg p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-primary">Recommended next date</p>
          <p className="display mt-1 text-[20px] text-text">
            {sel.outcome?.next_date ? dateLabel(sel.outcome.next_date, true) : "Disposed"}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            <span className="font-medium text-text">{rec.rule}</span>: {rec.why}
          </p>
        </div>
      )}
      {checklist.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Checklist for {pretty(sel.purpose)}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {checklist.map((c) => (
              <li key={c.item} className="flex items-start gap-2 text-[13px]">
                <span
                  className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full"
                  style={{ background: c.met ? "var(--green-subtle)" : "color-mix(in srgb, var(--c-danger) 12%, transparent)", color: c.met ? "var(--green-strong)" : "var(--c-danger)" }}
                >
                  {c.met ? <Check size={11} /> : <X size={11} />}
                </span>
                <span className={c.met ? "text-text" : "text-danger"}>{c.item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {gaming && (
        <div className="rounded-lg border border-line bg-surface-2 p-3">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <Info size={14} className="text-adj" /> Pattern to review for {sel.advocate}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Time sought more often than expected near evidence or judgement. Shown as evidence for the court to weigh, not a
            finding. Response: a firm, short last-chance date; the other side is not penalised.
          </p>
          {gaming.evidence && typeof gaming.evidence === "object" && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-[12px]">
              {Object.entries(gaming.evidence).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-faint">{k.replace(/_/g, " ")}</dt>
                  <dd className="num text-text">{typeof v === "number" ? (v > 0 && v < 1 ? pct(v) : String(v)) : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      <div>
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Delay history of this case</p>
        {total === 0 ? (
          <p className="mt-1 text-[13px] text-muted">No lost hearings in this period.</p>
        ) : (
          <>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
              {hist.map(([s, n]) => (
                <motion.span key={s} initial={{ width: 0 }} animate={{ width: `${(n / total) * 100}%` }} style={{ background: STAKEHOLDER_COLOUR[s] }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
              {hist.map(([s, n]) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: STAKEHOLDER_COLOUR[s] }} />
                  {STAKEHOLDER_LABEL[s]} <span className="num text-text">{n}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PersonCard({ run, sel, date }: { run: Run; sel: Placed; date: string }) {
  const party = run.cases?.[sel.case_id]?.party;
  const [kind, setKind] = useState<"advocate" | "party">("advocate");
  const k = kind === "party" && party ? "party" : "advocate";
  const id = k === "party" ? party! : sel.advocate;
  return (
    <Card
      className="mt-5"
      title={
        <span>
          Calendar for <span className="mono">{id}</span>
        </span>
      }
      subtitle="Every listing in the period, and the selected day's matters inside the court's sittings"
      right={
        party ? (
          <Segmented<"advocate" | "party">
            id="person-kind"
            value={k}
            onChange={setKind}
            options={[
              { value: "advocate", label: "Advocate" },
              { value: "party", label: "Party" },
            ]}
          />
        ) : undefined
      }
    >
      <p className="mb-3 text-[14px] text-text">
        Clustering puts one person&apos;s matters next to each other, so a single trip to court covers them all.
      </p>
      <PersonCalendar key={`${k}-${id}-${date}`} run={run} who={{ kind: k, id }} initialDay={date} />
    </Card>
  );
}

function ChangesToday({ run, day }: { run: Run; day: Day }) {
  const items = useMemo(() => changesToday(run, day), [run, day]);
  const tone = { bad: C.adjourned, good: C.substantive, info: C.primary } as const;
  return (
    <Card className="mt-5" title="Changes today" subtitle="What moved against the plan, and who it affected (two people per matter: one for each side)">
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">The day ran to plan.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-[var(--border)]">
          {items.map((c, i) => (
            <motion.li key={c.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="grid gap-2 py-3 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: tone[c.tone] }} />
                <div>
                  <p className="text-[14px] font-medium text-text">{c.title}</p>
                  <p className="text-[13px] text-muted">{c.detail}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 md:justify-end">
                {c.minutes !== undefined && c.minutes > 0 && <Badge className="bg-surface-2 text-text ring-1 ring-line"><span className="num">{Math.round(c.minutes)}</span> min</Badge>}
                {c.matters !== undefined && c.matters > 0 && <Badge className="bg-surface-2 text-text ring-1 ring-line"><span className="num">{c.matters}</span> matter{c.matters === 1 ? "" : "s"}</Badge>}
                {c.people !== undefined && c.people > 0 && <Badge className="bg-surface-2 text-text ring-1 ring-line"><span className="num">{c.people}</span> people</Badge>}
              </div>
            </motion.li>
          ))}
        </ol>
      )}
      <Takeaway>Every change is built from the day&apos;s own record: the minutes each hearing took against its plan, and what the court did about it.</Takeaway>
    </Card>
  );
}

type TownEvt = { kind?: string; start: string; days?: number; label?: string };
function TownBanner({ run, date }: { run: Run; date: string }) {
  const comb = (run.meta as Run["meta"] & { combined?: { events?: TownEvt[]; town_kept_away?: Record<string, { extra_absent?: number }> } }).combined;
  if (!comb) return null;
  const on = (comb.events ?? []).filter((e) => {
    const d0 = Date.parse(e.start);
    const d = Date.parse(date);
    return d >= d0 && d < d0 + (e.days ?? 1) * 86400000;
  });
  const n = comb.town_kept_away?.[date]?.extra_absent ?? 0;
  if (!on.length && !n) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-4" style={{ borderLeft: "2px solid var(--c-adjourned)" }}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "var(--c-adjourned)" }} />
      <p className="text-[14px] text-text">
        <span className="font-medium">{on.map((e) => e.label || (e.kind ?? "").replace(/_/g, " ")).join(" · ") || "Trouble in the town"}</span>
        {n > 0 && (
          <span className="text-muted">
            {" "}
            — <span className="num text-text">{n}</span> {n === 1 ? "person" : "people"} could not reach court
          </span>
        )}
      </p>
    </motion.div>
  );
}
