"use client";

import HowLink from "@/components/ui/HowLink";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, ChevronDown, X } from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui/Card";
import { Button } from "@/components/ui/Controls";
import { fetchRun, useAsync } from "@/lib/data";
import { C, OUTCOME_COLOUR, OUTCOME_LABEL } from "@/lib/theme";
import { ageFromWhy, dateLabel, pct, pretty, toMin, whyList } from "@/lib/format";
import { checklistFor } from "@/lib/insights";
import { explainNextDate, factLine } from "@/lib/nextdate";
import { isAgent, journeyMap, rationaleOf, tidy } from "@/lib/agents";
import { saveAnnotations } from "@/lib/annotations";
import type { Day, Listing, Run } from "@/lib/types";
import PersonCalendar from "@/components/charts/PersonCalendar";
import CaseSuggest from "@/components/ui/CaseSuggest";
import PlannedLine from "@/components/ui/PlannedLine";

const STAGES = ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA", "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"];
const ABSENT: Record<string, "pet" | "resp" | "both"> = {
  "Petitioner Absence / Non-Compliance": "pet",
  "Respondent Absence / Non-Compliance": "resp",
  "Both Parties Unready / Absent": "both",
};

async function loadRun(roster: "100" | "3000"): Promise<{ run: Run; file: string } | null> {
  const order = roster === "3000" ? ["optimal"] : ["combined", "agents", "optimal"];
  for (const c of order) {
    const r = await fetchRun(roster, c);
    if (r) return { run: r, file: `run_${roster}_${c}.json` };
  }
  return null;
}


export default function Bench() {
  const [roster, setRoster] = useState<"100" | "3000">("100");
  const loaded = useAsync(() => loadRun(roster), [roster]);
  const journeys = useAsync(journeyMap, []);
  const run = loaded?.run ?? null;
  const [dayIdx, setDayIdx] = useState(0);
  const [idx, setIdx] = useState(0);
  const [showCal, setShowCal] = useState(true);
  const day: Day | null = run?.days[Math.min(dayIdx, run.days.length - 1)] ?? null;
  const list = useMemo(() => (day ? [...day.listings].sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score) : []), [day]);
  const l = list[Math.min(idx, Math.max(0, list.length - 1))];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, list.length - 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length]);

  if (!run || !day || !l) return <div className="card h-96 animate-pulse" />;
  return (
    <div className="flex flex-col gap-4">
      {/* top bar */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {([["100", "One world · 100 cases"], ["3000", "Full docket · 3,000 cases"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setRoster(v);
                setDayIdx(0);
                setIdx(0);
              }}
              className={clsx("rounded-md px-2.5 py-1 text-[12px]", roster === v ? "bg-primary-subtle font-medium text-primary" : "text-muted hover:text-text")}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={dayIdx}
          onChange={(e) => {
            setDayIdx(Number(e.target.value));
            setIdx(0);
          }}
          className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px]"
          aria-label="Sitting day"
        >
          {run.days.map((d, i) => (
            <option key={d.date} value={i}>
              {dateLabel(d.date, true)}
            </option>
          ))}
        </select>
        <p className="text-[14px] text-text">
          Now hearing <span className="display num">{idx + 1}</span> of {list.length}
        </p>
        <span className="num rounded-md bg-primary-subtle px-2 py-1 text-[13px] text-primary">
          {l.start}–{l.end}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-30" aria-label="Previous matter">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setIdx((i) => Math.min(list.length - 1, i + 1))} disabled={idx >= list.length - 1} className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-on-primary disabled:opacity-30" aria-label="Next matter">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.12em] text-muted">Calendar</p>
        <button type="button" onClick={() => setShowCal((v) => !v)} className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-surface-2">
          {showCal ? "Hide calendar" : "Show calendar"}
        </button>
      </div>
      {showCal && (
      <div className="grid gap-4 lg:grid-cols-2">
        <DayCalendar run={run} current={day.date} onPick={(i) => { setDayIdx(i); setIdx(0); }} />
        <div className="card p-4">
          <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Calendar for <span className="mono normal-case">{l.case_id}</span></p>
          <PersonCalendar key={`${l.case_id}-${day.date}`} run={run} who={{ kind: "case", id: l.case_id }} initialDay={day.date} />
          {l.outcome?.next_date && <p className="mt-2 text-[12px] text-muted">Suggested next date: <span className="num text-primary">{dateLabel(l.outcome.next_date, true)}</span></p>}
        </div>
      </div>
      )}
      <PlannedLine run={run} />
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <MatterList run={run} day={day} list={list} current={l.case_id} onPick={(i) => setIdx(i)} onJump={(di, ci) => { setDayIdx(di); setIdx(ci); }} />
      <div className="flex min-w-0 flex-col gap-4">
      <AnimatePresence mode="wait">
        <motion.div key={`${day.date}-${l.case_id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
          <Matter run={run} day={day} l={l} />
          <People run={run} day={day} l={l} rationale={rationaleOf(l, day.date, journeys)} />
          <Next run={run} day={day} l={l} file={loaded!.file} />
        </motion.div>
      </AnimatePresence>
      </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Timeline run={run} caseId={l.case_id} current={day.date} />
        <div className="card p-4">
          <p className="text-[12px] uppercase tracking-[0.12em] text-muted">Next up</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {list.slice(idx + 1, idx + 4).map((n, k) => (
              <li key={n.case_id}>
                <button onClick={() => setIdx(idx + 1 + k)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                  <span className="mono text-[12px] text-text">{n.case_id}</span>
                  <span className="text-[12px] text-muted">{pretty(n.purpose)}</span>
                  <span className="num text-[12px] text-primary">{n.start}</span>
                </button>
              </li>
            ))}
            {idx >= list.length - 1 && <li className="text-[13px] text-muted">Last matter of the day.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}

function historyOf(run: Run, caseId: string, before?: string) {
  const out: { date: string; l: Listing }[] = [];
  for (const d of run.days) {
    if (before && d.date >= before) break;
    for (const x of d.listings) if (x.case_id === caseId) out.push({ date: d.date, l: x });
  }
  return out;
}

function Matter({ run, day, l }: { run: Run; day: Day; l: Listing }) {
  const info = run.cases?.[l.case_id];
  const stage = STAGES.includes(l.purpose) ? l.purpose : info?.stage_start ?? "";
  const si = STAGES.indexOf(stage);
  const interrupt = !STAGES.includes(l.purpose);
  const hist = historyOf(run, l.case_id, day.date);
  let inRow = 0;
  for (let i = hist.length - 1; i >= 0 && hist[i].l.outcome?.kind === "adjourned"; i--) inRow++;
  const age = info?.age_at_start ?? ageFromWhy(l.why);
  const lastAdj = [...hist].reverse().find((h) => h.l.outcome && h.l.outcome.kind !== "substantive");
  const checklist = checklistFor(l);
  const [tech, setTech] = useState(false);
  return (
    <div className="card p-5">
      <p className="mono text-[20px] font-semibold" style={(age ?? 0) >= 4 ? { color: C.old } : undefined}>
        {l.case_id}
      </p>
      <p className="text-[15px] text-text">
        {pretty(l.purpose)} {interrupt && <Badge colour={C.adjourned}>interim matter</Badge>}
      </p>
      <div className="mt-4 flex gap-0.5" aria-label="Stage of the case">
        {STAGES.map((s, i) => (
          <div key={s} className="flex-1" title={pretty(s)}>
            <div className={clsx("h-2 rounded-sm", i < si ? "bg-primary-soft" : i === si ? "bg-primary" : "bg-surface-2")} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span className={si === 0 ? "text-primary" : ""}>Admission</span>
        {si > 0 && si < STAGES.length - 1 && <span className="text-primary">Now: {pretty(STAGES[si])}</span>}
        <span className={si === STAGES.length - 1 ? "text-primary" : ""}>Judgement</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Mini label="Pending" value={age !== null && age !== undefined ? `${age.toFixed(1)} yrs` : "--"} />
        <Mini label="Hearings so far" value={String(info?.hearings_total ?? hist.length)} />
        <Mini label="Adjourned in a row" value={String(inRow)} />
        <Mini label="Days since last hearing" value={hist.length ? String(Math.round((Date.parse(day.date) - Date.parse(hist[hist.length - 1].date)) / 86400000)) : "--"} />
        <Mini label="Next purpose" value={l.outcome?.next_purpose ? pretty(l.outcome.next_purpose) : l.outcome?.next_date ? pretty(l.purpose) : "--"} />
        <Mini label="Kind of dispute" value={String((info as (typeof info & { dispute_kind?: string }) | undefined)?.dispute_kind ?? "not recorded")} />
      </div>
      {lastAdj && <p className="mt-2 text-[13px] text-muted">Last adjourned {dateLabel(lastAdj.date, true)}: {lastAdj.l.outcome?.reason ?? "no reason recorded"}</p>}
      <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-muted">Why it is listed today</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-[14px] text-text">
        {whyList(l.why).map((w) => (
          <li key={w}>· {w}</li>
        ))}
      </ul>
      {checklist.length > 0 && (
        <>
          <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-muted">Checklist</p>
          <ul className="mt-1 flex flex-col gap-1">
            {checklist.map((c) => (
              <li key={c.item} className={clsx("flex items-center gap-2 text-[13px]", c.met ? "text-text" : "text-danger")}>
                {c.met ? <Check size={14} className="text-green-strong" /> : <X size={14} />} {c.item}
              </li>
            ))}
          </ul>
        </>
      )}
      <button onClick={() => setTech((t) => !t)} className="mt-4 flex items-center gap-1 text-[12px] text-muted">
        <ChevronDown size={13} className={clsx(tech && "rotate-180")} /> Technical
      </button>
      {tech && (
        <p className="mono mt-1 text-[11px] text-muted">
          P(goes ahead) {pct(l.p_ahead)} · P(moves forward) {pct(l.p_sub)} · expected {l.exp_min.toFixed(1)} min · score {l.score.toFixed(3)}
        </p>
      )}
    </div>
  );
}

function sideRecord(run: Run, caseId: string, before: string, side: "pet" | "resp") {
  const hist = historyOf(run, caseId, before).filter((h) => h.l.outcome && h.l.outcome.kind !== "not_reached" && h.l.outcome.kind !== "not_ready");
  const absent = hist.filter((h) => {
    const a = ABSENT[h.l.outcome?.reason ?? ""];
    return a === side || a === "both";
  }).length;
  const sought = hist.filter((h) => h.l.outcome?.reason === "Party Sought Time / Adjournment").length;
  return { came: hist.length - absent, of: hist.length, sought };
}

function People({ run, day, l, rationale }: { run: Run; day: Day; l: Listing; rationale: string | null }) {
  const info = run.cases?.[l.case_id];
  const a = ABSENT[l.outcome?.reason ?? ""];
  const called = l.outcome && l.outcome.kind !== "not_reached" && l.outcome.kind !== "not_ready";
  const sides = [
    { key: "pet" as const, title: "Complainant side", who: [...(info?.party ? [info.party] : []), `advocate ${l.advocate}`] },
    { key: "resp" as const, title: "Accused side", who: ["Accused and their advocate"] },
  ];
  return (
    <div className="card flex flex-col gap-3 p-5">
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">The people</p>
      {sides.map((s) => {
        const rec = sideRecord(run, l.case_id, day.date, s.key);
        const absent = a === s.key || a === "both";
        return (
          <div key={s.key} className="rounded-lg border border-line bg-bg p-3">
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-medium text-text">{s.title}</p>
              {called ? <Badge colour={absent ? C.adjourned : C.substantive}>{absent ? "absent today" : "present today"}</Badge> : <Badge colour={C.baseline}>not called</Badge>}
            </div>
            <p className="mono mt-1 text-[12px] text-muted">{s.who.join(" · ")}</p>
            <p className="mt-1 text-[13px] text-muted">
              {rec.of ? `Turned up ${rec.came} of ${rec.of} earlier hearings` : "No earlier hearings in this period"}
              {rec.sought ? ` · time sought ${rec.sought} time${rec.sought > 1 ? "s" : ""}` : ""}
            </p>
          </div>
        );
      })}
      {(rationale || isAgent(l)) && (
        <div className="rounded-lg bg-primary-subtle p-3">
          <Badge colour={C.primary}>AI agent</Badge>
          <p className="mt-2 text-[14px] leading-relaxed text-text">{rationale ? <>&ldquo;{tidy(rationale)}&rdquo;</> : "The people in this matter were played by AI agents."}</p>
        </div>
      )}
    </div>
  );
}

function Next({ run, day, l, file }: { run: Run; day: Day; l: Listing; file: string }) {
  const ex = explainNextDate(run, day, l);
  const nd = ex.chosen;
  const [mode, setMode] = useState<"idle" | "change" | "done">("idle");
  const [note, setNote] = useState("");
  const [free, setFree] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const save = async (value: string, verdict: "agree" | "change") => {
    await saveAnnotations([{ case_id: l.case_id, day: day.date, field: "next_date", predicted: nd, judge_value: verdict === "agree" ? "agree" : value, note, annotator: "judge", config: file, roster: file.includes("3000") ? "3000" : "100", saved_at: new Date().toISOString() }]);
    setSaved(verdict === "agree" ? "Accepted." : `Changed to ${value}.`);
    setMode("done");
  };
  return (
    <div className="card flex flex-col gap-3 p-5">
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">What happens next</p>
      {l.outcome && (
        <div className="flex items-center gap-2">
          <Badge colour={OUTCOME_COLOUR[l.outcome.kind]}>{OUTCOME_LABEL[l.outcome.kind]}</Badge>
        </div>
      )}
      <div>
        <p className="text-[11px] uppercase tracking-[0.12em] text-faint">What happened today</p>
        <p className="text-[14px] text-text">{ex.happened}</p>
      </div>
      {!nd && l.outcome?.kind === "substantive" ? (
        <div className="rounded-lg p-4" style={{ background: "var(--green-subtle)", boxShadow: "inset 2px 0 0 var(--green)" }}>
          <p className="text-[11px] uppercase tracking-[0.12em] text-green-strong">Disposed</p>
          <p className="display mt-1 text-[26px] leading-tight text-text">This case is closed today</p>
          <p className="mt-2 text-[13px] text-muted">Judgement delivered; no next date is needed.</p>
        </div>
      ) : nd ? (
        <>
          <div className="selected-row rounded-lg p-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-primary">Suggested next date</p>
            <p className="display mt-1 text-[32px] leading-none text-text">{dateLabel(nd, true)}</p>
            {l.outcome?.next_purpose && <p className="mt-1 text-[13px] text-muted">for {pretty(l.outcome.next_purpose)}</p>}
            <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-faint">The rule applied</p>
            <p className="text-[13px] text-text">{ex.rule}</p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-faint">Why this day, not earlier</p>
            <p className="text-[13px] text-text">
              {ex.minDate && `The next step could not be heard before ${dateLabel(ex.minDate, true)}. `}
              {ex.facts && factLine(ex.facts, ex.usual)}.
            </p>
          </div>
          {ex.alts.length > 0 && (
            <div className="flex flex-col gap-2">
              {ex.alts.map((a) => (
                <div key={a.date} className="rounded-lg border border-line px-3 py-2 text-muted">
                  <p className="num text-[13px] text-text">{dateLabel(a.date, true)}</p>
                  <p className="text-[12px]">{factLine(a, ex.usual)}</p>
                  <p className="text-[12px] text-text">{a.tradeoff}</p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
      {nd &&
        (mode === "done" ? (
          <p className="text-[13px] text-green-strong">{saved}</p>
        ) : mode === "change" ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {ex.alts.map((a) => (
                <Button key={a.date} variant="ghost" onClick={() => save(a.date, "change")} className="px-3 py-1.5 text-[13px]">
                  {dateLabel(a.date, true)}
                </Button>
              ))}
            </div>
            <input type="date" value={free} onChange={(e) => setFree(e.target.value)} className="num rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px]" aria-label="Another date" />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason, e.g. witness abroad until the 20th" className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40" />
            <div className="flex gap-2">
              <Button onClick={() => free && save(free, "change")} disabled={!free} className="px-3 py-1.5 text-[13px]">Use this date</Button>
              <Button variant="ghost" onClick={() => setMode("idle")} className="px-3 py-1.5 text-[13px]">Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => save(nd, "agree")} className="flex-1">
              <Check size={15} /> Accept
            </Button>
            <Button variant="ghost" onClick={() => setMode("change")} className="flex-1">
              Change
            </Button>
          </div>
        ))}
      <Link href={`/case/${encodeURIComponent(l.case_id)}`} className="text-[12px] text-primary hover:underline">
        Open the full case file
      </Link>
      <HowLink id="nextdate" label="Recommending the next date" />
    </div>
  );
}

function Timeline({ run, caseId, current }: { run: Run; caseId: string; current: string }) {
  const all = historyOf(run, caseId);
  return (
    <div className="card p-4">
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">This case in the period</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {all.map((h) => (
          <span
            key={h.date}
            title={`${dateLabel(h.date, true)}: ${h.l.outcome ? OUTCOME_LABEL[h.l.outcome.kind] : "listed"}`}
            className={clsx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]", h.date === current ? "border-primary bg-primary-subtle" : "border-line")}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: h.l.outcome ? OUTCOME_COLOUR[h.l.outcome.kind] : C.baseline }} />
            <span className="num">{dateLabel(h.date, true)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{label}</p>
      <p className="num text-[15px] text-text">{value}</p>
    </div>
  );
}

type SortKey = "window" | "case" | "stage" | "age";
function MatterList({ run, day, list, current, onPick, onJump }: { run: Run; day: Day; list: Listing[]; current: string; onPick: (i: number) => void; onJump: (dayIdx: number, idx: number) => void }) {
  const [sort, setSort] = useState<SortKey>("window");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const ageOf = (x: Listing) => run.cases?.[x.case_id]?.age_at_start ?? ageFromWhy(x.why) ?? 0;
  const rows = list.map((x, i) => ({ x, i })).sort((a, b) => {
    if (sort === "case") return a.x.case_id.localeCompare(b.x.case_id);
    if (sort === "stage") return STAGES.indexOf(b.x.purpose) - STAGES.indexOf(a.x.purpose);
    if (sort === "age") return ageOf(b.x) - ageOf(a.x);
    return a.i - b.i;
  });
  const allIds = useMemo(() => [...new Set(run.days.flatMap((d) => d.listings.map((x) => x.case_id)))].sort(), [run]);
  const search = (v: string = q) => {
    const needle = v.trim().toLowerCase();
    if (!needle) return;
    const here = list.findIndex((x) => x.case_id.toLowerCase().includes(needle));
    if (here >= 0) {
      onPick(here);
      setMsg(null);
      return;
    }
    const di = run.days.findIndex((d) => d.date >= day.date && d.listings.some((x) => x.case_id.toLowerCase().includes(needle)));
    const dj = di >= 0 ? di : run.days.findIndex((d) => d.listings.some((x) => x.case_id.toLowerCase().includes(needle)));
    if (dj < 0) {
      setMsg("Not listed in this period.");
      return;
    }
    const d = run.days[dj];
    const sorted = [...d.listings].sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score);
    onJump(dj, Math.max(0, sorted.findIndex((x) => x.case_id.toLowerCase().includes(needle))));
    setMsg(`Not listed today; next listed ${dateLabel(d.date, true)}.`);
  };
  return (
    <div className="card flex max-h-[900px] flex-col p-3">
      <CaseSuggest value={q} onChange={setQ} onPick={(v) => search(v)} options={allIds} placeholder="Find a case number" className="px-2.5 py-1.5 text-[12px]" />
      {msg && <p className="mt-1 text-[11px] text-muted">{msg}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {(["window", "case", "stage", "age"] as SortKey[]).map((k) => (
          <button key={k} onClick={() => setSort(k)} className={clsx("rounded-md px-2 py-0.5 text-[11px]", sort === k ? "bg-primary-subtle text-primary" : "text-muted hover:bg-surface-2")}>
            {k === "window" ? "Time" : k === "case" ? "Case no." : k === "stage" ? "Stage" : "Age"}
          </button>
        ))}
      </div>
      <ol className="scroll-thin mt-2 flex-1 overflow-y-auto">
        {rows.map(({ x, i }) => (
          <li key={x.case_id}>
            <button onClick={() => onPick(i)} className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", x.case_id === current ? "selected-row" : "hover:bg-surface-2")}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.outcome ? OUTCOME_COLOUR[x.outcome.kind] : C.baseline }} />
              <span className="mono flex-1 truncate text-[12px] text-text" style={ageOf(x) >= 4 ? { color: C.old } : undefined}>{x.case_id}</span>
              <span className="num text-[11px] text-muted">{x.start}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayCalendar({ run, current, onPick }: { run: Run; current: string; onPick: (i: number) => void }) {
  return (
    <div className="card p-4">
      <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Sitting days</p>
      <div className="mb-1 grid grid-cols-5 gap-1.5 text-center text-[11px] text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {Array.from({ length: Math.max(0, (new Date(run.days[0]?.date + "T00:00:00").getDay() + 6) % 7) }).map((_, k) => <span key={`pad-${k}`} />)}
        {run.days.map((d, i) => {
          const moved = d.listings.filter((x) => x.outcome?.kind === "substantive").length;
          const adj = d.listings.length - moved;
          return (
            <button key={d.date} onClick={() => onPick(i)} className={clsx("rounded-md border p-2 text-left", d.date === current ? "border-primary bg-primary-subtle" : "border-line hover:bg-surface-2")}>
              <p className="num text-[12px] text-text">{dateLabel(d.date, true)}</p>
              <p className="text-[11px] text-muted">{d.listings.length} matters</p>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span style={{ width: `${(moved / Math.max(1, d.listings.length)) * 100}%`, background: C.substantive }} />
                <span style={{ width: `${(adj / Math.max(1, d.listings.length)) * 100}%`, background: C.adjourned }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
