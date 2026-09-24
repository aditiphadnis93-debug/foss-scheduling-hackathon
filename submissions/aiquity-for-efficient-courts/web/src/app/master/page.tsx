"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, CalendarClock, Download, TriangleAlert, Undo2, X } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import { Badge, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Controls";
import { fetchRun, useAsync } from "@/lib/data";
import { C } from "@/lib/theme";
import { ageFromWhy, dateLabel, downloadCsv, pretty, toMin, toHHMM } from "@/lib/format";
import { explainNextDate, factLine } from "@/lib/nextdate";
import { saveAnnotations } from "@/lib/annotations";
import { apiHealthy } from "@/lib/api";
import { nextDate as liveNextDate } from "@/lib/actions";
import type { Day, Listing, Run } from "@/lib/types";
import Readiness, { type ReadyChange } from "./Readiness";
import { Tabs } from "@/components/ui/Controls";
import PartyDates, { applyPrefs, emptyPrefs, type Preferences } from "@/components/ui/PartyDates";

type Att = "present" | "absent" | "not_ready";
type Row = { l: Listing; pet: Att; acc: Att; passed: boolean; rescheduled: string | null };
type Change = { at: string; case_id: string; what: string; why: string };

const PEOPLE = 2;
const REASONS = ["Party absent", "Advocate unavailable", "Papers not ready", "Court time ran out", "Judge's direction", "Other"];

function initial(l: Listing): { pet: Att; acc: Att } {
  const r = l.outcome?.reason ?? "";
  if (l.outcome?.kind === "not_ready") return { pet: "not_ready", acc: "present" };
  if (r.startsWith("Petitioner Absence")) return { pet: "absent", acc: "present" };
  if (r.startsWith("Respondent Absence")) return { pet: "present", acc: "absent" };
  if (r.startsWith("Both Parties")) return { pet: "absent", acc: "absent" };
  return { pet: "present", acc: "present" };
}

const nowText = () => new Date().toTimeString().slice(0, 5);

export default function Master() {
  const [roster, setRoster] = useState<"100" | "3000">("100");
  const run = useAsync(async () => (roster === "3000" ? fetchRun("3000", "optimal") : (await fetchRun("100", "combined")) ?? (await fetchRun("100", "optimal"))), [roster]);
  const [dayIdx, setDayIdx] = useState(0);
  const day: Day | null = run?.days[Math.min(dayIdx, run.days.length - 1)] ?? null;
  const key = `${roster}|${day?.date}`;
  const [state, setState] = useState<{ key: string; rows: Row[]; log: Change[] } | null>(null);
  const base = useMemo<Row[]>(
    () => (day ? [...day.listings].sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score).map((l) => ({ l, ...initial(l), passed: false, rescheduled: null })) : []),
    [day],
  );
  const rows = state && state.key === key ? state.rows : base;
  const log = state && state.key === key ? state.log : [];
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"roll" | "ready">("roll");
  const onReady = (c: ReadyChange) => {
    const ch: Change = { at: nowText(), case_id: c.case_id, what: c.what, why: c.why };
    setState({ key, rows, log: [ch, ...log] });
    if (day)
      saveAnnotations([{ case_id: c.case_id, day: day.date, field: "listed", predicted: c.field, judge_value: c.value, note: `${c.field}: ${c.item}`, annotator: "court master", roster, saved_at: new Date().toISOString() }]);
  };

  const update = (rs: Row[], change?: Change) => setState({ key, rows: rs, log: change ? [change, ...log] : log });
  const record = async (c: Change, field: "reschedule" | "listed", predicted: string | null, value: string) => {
    if (!day) return;
    await saveAnnotations([{ case_id: c.case_id, day: day.date, field: field === "reschedule" ? "next_date" : "listed", predicted, judge_value: value, note: `${c.what}: ${c.why}`, annotator: "court master", roster, saved_at: new Date().toISOString() }]);
  };

  const setAtt = (i: number, side: "pet" | "acc", v: Att) => {
    const r = rows[i];
    const next = rows.map((x, k) => (k === i ? { ...x, [side]: v } : x));
    update(next, { at: nowText(), case_id: r.l.case_id, what: `${side === "pet" ? "Complainant side" : "Accused side"} marked ${v.replace("_", " ")}`, why: "roll call" });
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    update(next, { at: nowText(), case_id: rows[i].l.case_id, what: d < 0 ? "Moved up the list" : "Moved down the list", why: "order of calling" });
  };
  const passOver = (i: number) => {
    const r = rows[i];
    const next = [...rows.slice(0, i), ...rows.slice(i + 1), { ...r, passed: !r.passed }];
    update(next, { at: nowText(), case_id: r.l.case_id, what: r.passed ? "Recalled" : "Passed over (call later)", why: "court master" });
  };
  const reschedule = (caseId: string, date: string, reason: string, suggested: string | null) => {
    const next = rows.map((x) => (x.l.case_id === caseId ? { ...x, rescheduled: date } : x));
    const c: Change = { at: nowText(), case_id: caseId, what: `Rescheduled to ${dateLabel(date, true)}`, why: reason };
    update(next, c);
    record(c, "reschedule", suggested, date);
    setOpen(null);
  };

  if (!run || !day) return <div className="card h-96 animate-pulse" />;

  const counts = {
    listed: rows.length,
    present: rows.filter((r) => r.pet === "present" && r.acc === "present" && !r.rescheduled).length,
    absent: rows.filter((r) => r.pet === "absent" || r.acc === "absent").length,
    passed: rows.filter((r) => r.passed).length,
    rescheduled: rows.filter((r) => r.rescheduled).length,
    moved: rows.filter((r) => r.l.outcome?.kind === "substantive" && r.pet === "present" && r.acc === "present" && !r.rescheduled).length,
  };
  const off = rows.filter((r) => r.rescheduled || r.pet !== "present" || r.acc !== "present");
  const freed = off.reduce((s, r) => s + Math.max(0, r.l.exp_min - (r.rescheduled ? 0 : 1)), 0);
  const presentAdvocates = new Set(rows.filter((r) => r.pet === "present" && r.acc === "present" && !r.rescheduled).map((r) => r.l.advocate));
  const standby = ((day as Day & { standby?: Listing[] }).standby ?? []).filter((sb) => presentAdvocates.size === 0 || presentAdvocates.has(sb.advocate) || true);
  const callable = standby.reduce<{ left: number; out: Listing[] }>(
    (acc, sb) => (acc.left >= sb.exp_min ? { left: acc.left - sb.exp_min, out: [...acc.out, sb] } : acc),
    { left: freed, out: [] },
  ).out;
  const warnings = rows.filter((r) => r.rescheduled && (r.l.why.some((w) => /age\s+([4-9]|\d{2})/.test(w)) || (ageFromWhy(r.l.why) ?? 0) >= 4) && (Date.parse(r.rescheduled) - Date.parse(day.date)) / 86400000 > 14);

  return (
    <div>
      <PageHeader
        eyebrow="Court master"
        title="Run the day's list"
        lede="Take the roll call, pass over, re-order and reschedule. Every change is logged with its reason and its effect on the day."
        right={
          <>
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {([["100", "One world · 100 cases"], ["3000", "Full docket · 3,000"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setRoster(v); setDayIdx(0); }} className={clsx("rounded-md px-2.5 py-1 text-[12px]", roster === v ? "bg-primary-subtle font-medium text-primary" : "text-muted")}>
                  {label}
                </button>
              ))}
            </div>
            <select value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px]" aria-label="Sitting day">
              {run.days.map((d, i) => (
                <option key={d.date} value={i}>{dateLabel(d.date, true)}</option>
              ))}
            </select>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3 md:grid-cols-6">
        {([["Listed", counts.listed], ["Present", counts.present], ["Absent", counts.absent], ["Passed over", counts.passed], ["Rescheduled", counts.rescheduled], ["Moved forward", counts.moved]] as const).map(([l, v]) => (
          <div key={l} className="card px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted">{l}</p>
            <p className="display num text-[22px]">{v}</p>
          </div>
        ))}
      </div>
      <div className="card mb-4 flex flex-wrap items-center gap-4 border-l-2 border-l-primary px-4 py-3 text-[13px]">
        <span><span className="num font-medium text-text">{Math.round(freed)}</span> minutes freed</span>
        <span><span className="num font-medium text-text">{callable.length}</span> standby matter{callable.length === 1 ? "" : "s"} can now be called{callable.length ? `: ${callable.slice(0, 3).map((s) => s.case_id).join(", ")}` : ""}</span>
        <span><span className="num font-medium text-text">{off.length * PEOPLE}</span> people affected</span>
        {warnings.length > 0 && (
          <span className="flex items-center gap-1 text-danger"><TriangleAlert size={14} /> {warnings.length} case{warnings.length > 1 ? "s" : ""} over 4 years pushed beyond 14 days</span>
        )}
      </div>
      <div className="mb-3">
        <Tabs id="master-tab" value={tab} onChange={setTab} tabs={[{ value: "roll", label: "Roll call" }, { value: "ready", label: "Readiness & prerequisites" }]} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        {tab === "ready" ? (
          <Card className="min-w-0"><Readiness run={run} dayIdx={dayIdx} onChange={onReady} /></Card>
        ) : (
        <Card className="min-w-0 p-0">
          <div className="scroll-thin max-h-[720px] overflow-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>{["", "Window", "Case", "Purpose", "Advocate", "Complainant side", "Accused side", ""].map((h, i) => <th key={i} className="border-b border-line px-2 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.l.case_id} className={clsx("border-b border-line", r.rescheduled && "opacity-50", r.passed && "bg-surface-2")}>
                    <td className="px-1 py-1.5">
                      <div className="flex flex-col">
                        <button onClick={() => move(i, -1)} className="text-faint hover:text-text" aria-label="Move up"><ArrowUp size={13} /></button>
                        <button onClick={() => move(i, 1)} className="text-faint hover:text-text" aria-label="Move down"><ArrowDown size={13} /></button>
                      </div>
                    </td>
                    <td className="num whitespace-nowrap px-2 py-1.5">{r.l.start}–{r.l.end}</td>
                    <td className="mono whitespace-nowrap px-2 py-1.5" style={(ageFromWhy(r.l.why) ?? 0) >= 4 ? { color: C.old } : undefined}>
                      {r.l.case_id}
                      {r.passed && <Badge className="ml-1 bg-bg text-muted ring-1 ring-line">passed over</Badge>}
                      {r.rescheduled && <Badge className="ml-1 bg-bg text-muted ring-1 ring-line">to {dateLabel(r.rescheduled, true)}</Badge>}
                    </td>
                    <td className="px-2 py-1.5">{pretty(r.l.purpose)}</td>
                    <td className="mono px-2 py-1.5 text-muted">{r.l.advocate}</td>
                    <td className="px-2 py-1.5"><AttToggle v={r.pet} onChange={(v) => setAtt(i, "pet", v)} /></td>
                    <td className="px-2 py-1.5"><AttToggle v={r.acc} onChange={(v) => setAtt(i, "acc", v)} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <button onClick={() => passOver(i)} className="rounded-md px-2 py-1 text-[12px] text-muted ring-1 ring-line hover:text-text">{r.passed ? <><Undo2 size={12} className="inline" /> Recall</> : "Pass over"}</button>
                      <button onClick={() => setOpen(r.l.case_id)} className="ml-1 rounded-md px-2 py-1 text-[12px] text-primary ring-1 ring-line hover:bg-primary-subtle"><CalendarClock size={12} className="inline" /> Reschedule</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        )}
        <Card title="Changes today" right={<Button variant="ghost" onClick={() => downloadCsv(`changes_${day.date}.csv`, log.map((c) => ({ time: c.at, who: "court master", case: c.case_id, what: c.what, why: c.why })))} disabled={!log.length} className="px-2 py-1 text-[12px]"><Download size={13} /> Export</Button>}>
          {log.length === 0 ? (
            <p className="text-[13px] text-muted">Marks, pass-overs and reschedules appear here with their reason.</p>
          ) : (
            <ol className="scroll-thin flex max-h-[640px] flex-col gap-2 overflow-y-auto">
              <AnimatePresence initial={false}>
                {log.map((c, i) => (
                  <motion.li key={`${c.at}-${c.case_id}-${log.length - i}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg bg-surface-2 p-2 text-[12px]">
                    <p className="text-text"><span className="num text-muted">{c.at}</span> · <span className="mono">{c.case_id}</span></p>
                    <p className="text-text">{c.what}</p>
                    <p className="text-muted">{c.why} · court master</p>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </Card>
      </div>
      <AnimatePresence>
        {open && <Reschedule run={run} day={day} l={rows.find((r) => r.l.case_id === open)!.l} roster={roster} onClose={() => setOpen(null)} onDone={reschedule} />}
      </AnimatePresence>
    </div>
  );
}

function AttToggle({ v, onChange }: { v: Att; onChange: (v: Att) => void }) {
  const opts: [Att, string, string][] = [["present", "Present", C.substantive], ["absent", "Absent", C.adjourned], ["not_ready", "Not ready", C.not_ready]];
  return (
    <div className="inline-flex rounded-md border border-line p-0.5">
      {opts.map(([k, label, col]) => (
        <button key={k} onClick={() => onChange(k)} className="rounded px-1.5 py-0.5 text-[11px]" style={v === k ? { background: `color-mix(in srgb, ${col} 18%, transparent)`, color: col } : { color: "var(--text-faint)" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Reschedule({ run, day, l, roster, onClose, onDone }: { run: Run; day: Day; l: Listing; roster: string; onClose: () => void; onDone: (caseId: string, date: string, reason: string, suggested: string | null) => void }) {
  const ex = explainNextDate(run, day, l);
  const [live, setLive] = useState<{ date: string; rule: string; ruleDate?: string; applied?: string } | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(emptyPrefs());
  const hasPrefs = [...prefs.petitioner.prefer, ...prefs.petitioner.avoid, ...prefs.respondent.prefer, ...prefs.respondent.avoid].length > 0;
  const [free, setFree] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  useEffect(() => {
    let on = true;
    apiHealthy().then(async (ok) => {
      if (!ok || !on) return;
      try {
        const r = await liveNextDate(roster, l.case_id, day.date, l.outcome?.kind === "substantive" ? "moved" : l.outcome?.kind === "not_ready" ? "not_ready" : l.outcome?.kind === "not_reached" ? "not_reached" : "absent", hasPrefs ? prefs : undefined);
        if (on && r.suggested) setLive({ date: r.suggested, rule: r.rule_in_words ?? "", ruleDate: r.rule_date, applied: r.preferences_applied });
      } catch {}
    });
    return () => {
      on = false;
    };
  }, [roster, l, day.date, prefs, hasPrefs]);
  const sittings = run.days.map((d) => d.date);
  const old = (ageFromWhy(l.why) ?? 0) >= 4;
  const offline = ex.chosen && hasPrefs ? applyPrefs(ex.chosen, sittings, prefs, old) : null;
  const suggested = live?.date ?? offline?.date ?? ex.chosen;
  const ruleDate = live?.ruleDate ?? ex.chosen;
  return (
    <>
      <motion.div className="fixed inset-0 z-50 bg-text/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside className="float fixed inset-y-0 right-0 z-50 w-full max-w-[460px] overflow-y-auto border-l border-line bg-bg p-6" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 36 }}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-[12px] uppercase tracking-[0.12em] text-primary">Reschedule</p>
            <p className="mono text-[18px] font-semibold">{l.case_id}</p>
            <p className="text-[13px] text-muted">{pretty(l.purpose)} · {l.advocate}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-text" aria-label="Close"><X size={18} /></button>
        </div>
        {suggested ? (
          <button onClick={() => onDone(l.case_id, suggested, reason, suggested)} className="selected-row w-full rounded-lg p-4 text-left">
            <p className="text-[11px] uppercase tracking-[0.12em] text-primary">Suggested{live ? " (live)" : ""}</p>
            <p className="display text-[26px]">{dateLabel(suggested, true)}</p>
            <p className="mt-1 text-[13px] text-text">{live?.rule ? live.rule.charAt(0).toUpperCase() + live.rule.slice(1) + "." : ex.rule}</p>
            {ex.facts && <p className="mt-1 text-[12px] text-muted">{factLine(ex.facts, ex.usual)}</p>}
            {hasPrefs && ruleDate && (
              <p className="mt-2 text-[12px] text-text">
                The rule&apos;s date: {dateLabel(ruleDate, true)} · With the parties&apos; requests: {dateLabel(suggested, true)}
                {(live?.applied ?? offline?.note) ? ` — ${live?.applied ?? offline?.note}` : ""}
              </p>
            )}
          </button>
        ) : (
          <p className="text-[13px] text-muted">No next date is needed: {ex.happened}</p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {ex.alts.map((a) => (
            <button key={a.date} onClick={() => onDone(l.case_id, a.date, reason, suggested)} className="rounded-lg border border-line p-3 text-left hover:bg-surface-2">
              <p className="num text-[14px] text-text">{dateLabel(a.date, true)}</p>
              <p className="text-[12px] text-muted">{factLine(a, ex.usual)}</p>
              <p className="text-[12px] text-text">{a.tradeoff}</p>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <PartyDates value={prefs} onChange={setPrefs} />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <label className="text-[12px] text-muted">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-text">
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">Another date
            <input type="date" value={free} min={day.date} onChange={(e) => setFree(e.target.value)} className="num mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] text-text" />
          </label>
          <Button onClick={() => free && onDone(l.case_id, free, reason, suggested)} disabled={!free}>Use this date</Button>
          <p className="text-[11px] text-faint">Pick the suggested date or an alternative above, or set your own. Now {toHHMM(new Date().getHours() * 60 + new Date().getMinutes())}.</p>
        </div>
      </motion.aside>
    </>
  );
}
