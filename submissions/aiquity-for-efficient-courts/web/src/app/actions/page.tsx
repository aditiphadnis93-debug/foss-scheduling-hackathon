"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarCheck, Check, Download, FileUp, ListChecks, Loader2, Server } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import { Badge, Card } from "@/components/ui/Card";
import { Button, Segmented, Select, Slider } from "@/components/ui/Controls";
import { apiHealthy } from "@/lib/api";
import { availableConfigs, fetchRun, useAsync } from "@/lib/data";
import { dateLabel, downloadCsv, pct, presetLabel, pretty, whyList } from "@/lib/format";
import { generateRoster, listRosters, makeCauselist, nextDate, uploadRoster, type CauselistOut, type NextDateOut, type RosterInfo, type RosterSummary } from "@/lib/actions";
import { saveAnnotations } from "@/lib/annotations";
import CaseSuggest from "@/components/ui/CaseSuggest";
import PartyDates, { emptyPrefs, type Preferences } from "@/components/ui/PartyDates";
import { compare, type CompareResult } from "@/lib/api";
import { askForProposal, LEVERS, leverValue, type Proposal } from "@/lib/agents";
import { fmtMetric, meta } from "@/lib/metrics";
import { DeltaPill } from "@/components/ui/Stat";

export default function Actions() {
  const [engine, setEngine] = useState<boolean | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [rosters, setRosters] = useState<RosterInfo[]>([{ key: "100", label: "Sample docket (100 cases)" }, { key: "3000", label: "Full docket (3,000 cases)" }]);
  const refresh = () =>
    listRosters()
      .then(setRosters)
      .catch(() => {});
  useEffect(() => {
    let on = true;
    apiHealthy().then((ok) => {
      if (!on) return;
      setEngine(ok);
      if (ok) refresh();
    });
    return () => {
      on = false;
    };
  }, []);
  const sittingDays = useAsync(() => fetchRun("100", "optimal").then((r) => r?.days.map((d) => d.date) ?? []), []) ?? [];
  const configs = (useAsync(() => availableConfigs("100"), []) ?? []).filter((c) => c !== "baseline");

  return (
    <div>
      <PageHeader eyebrow="Court actions" title="Do the court's work, live" lede="Create a roster, generate a day's causelist, and get the next best date for a matter. Each runs on the local engine in seconds." />
      {engine === false && (
        <div className="card mb-5 flex items-center gap-3 p-4">
          <Server size={18} className="text-primary" />
          <p className="text-[14px] text-text">
            Start the local engine to run these live{" "}
            <code className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">PYTHONPATH=src uvicorn causelist.api:app --port 8000</code>. Meanwhile you can download a
            saved causelist below, and see recorded next dates in the <Link href="/bench" className="text-primary hover:underline">Bench view</Link>.
          </p>
        </div>
      )}
      <div className="card mb-5 flex flex-wrap items-center gap-4 px-4 py-2.5 text-[12px] text-muted">
        <span className="flex items-center gap-2">
          <span className={clsx("h-2 w-2 rounded-full", engine ? "bg-green" : "bg-[var(--c-baseline)]")} />
          {engine ? "Engine connected" : engine === false ? "Engine not running" : "Checking the engine…"}
        </span>
        <span>Rosters: {rosters.map((r) => r.label).join(" · ")}</span>
        {last && <span className="ml-auto">Last action: {last}</span>}
      </div>
      <div className="flex flex-col gap-5">
        <RosterCard engine={engine} rosters={rosters} onChange={refresh} onDone={setLast} />
        <CauselistCard engine={engine} rosters={rosters} days={sittingDays} configs={configs} onDone={setLast} />
        <NextDateCard engine={engine} rosters={rosters} days={sittingDays} onDone={setLast} />
        <CompareCard engine={engine} configs={configs} onDone={setLast} />
        <StressCard engine={engine} onDone={setLast} />
        <AskCard engine={engine} onDone={setLast} />
      </div>
    </div>
  );
}

function Title({ icon: Icon, n, t, d }: { icon: typeof FileUp; n: number; t: string; d: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-on-primary">
        <Icon size={18} />
      </span>
      <div>
        <p className="text-[12px] uppercase tracking-[0.12em] text-primary">Action {n}</p>
        <h2 className="display text-[22px]">{t}</h2>
        <p className="text-[14px] text-muted">{d}</p>
      </div>
    </div>
  );
}

function Bars({ data, title }: { data: Record<string, number>; title: string }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div>
      <p className="mb-1 text-[12px] uppercase tracking-[0.1em] text-muted">{title}</p>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[12px]">
          <span className="truncate text-text">{pretty(k)}</span>
          <div className="h-2 rounded bg-surface-2">
            <motion.div className="h-2 rounded bg-primary" initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="num text-right text-muted">{v}</span>
        </div>
      ))}
    </div>
  );
}

function RosterCard({ engine, rosters, onChange, onDone }: { engine: boolean | null; rosters: RosterInfo[]; onChange: () => void; onDone: (s: string) => void }) {
  const [tab, setTab] = useState<"upload" | "generate">("upload");
  const [name, setName] = useState("my_court");
  const [file, setFile] = useState<File | null>(null);
  const [n, setN] = useState(500);
  const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<RosterSummary | null>(null);
  const run = async (ex?: { n: number; seed: number; name: string }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = ex ? await generateRoster(ex.n, ex.seed, ex.name) : tab === "upload" ? await uploadRoster(name, file ? await file.text() : "") : await generateRoster(n, seed, name || undefined);
      setOut(r);
      onChange();
      onDone(`roster with ${r.cases} cases`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Title icon={FileUp} n={1} t="Create a roster" d="What this does for your court: brings your own docket in, or makes a test docket of any size, so every other action runs on it." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => { setTab("generate"); setN(500); setSeed(7); setName("example_500"); run({ n: 500, seed: 7, name: "example_500" }); }} disabled={!engine || busy} className="px-3 py-1.5 text-[13px]">Try an example: 500 cases</Button>
        <Button variant="ghost" onClick={() => downloadCsv("roster_template.csv", TEMPLATE_ROWS)} className="px-3 py-1.5 text-[13px]"><Download size={14} /> Roster template (CSV)</Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <Segmented id="roster-tab" value={tab} onChange={setTab} options={[{ value: "upload", label: "Upload" }, { value: "generate", label: "Generate" }]} />
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-text" />
          </label>
          {tab === "upload" ? (
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" aria-label="Roster CSV" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted">
                Number of cases
                <input type="number" min={10} max={5000} value={n} onChange={(e) => setN(Number(e.target.value))} className="num rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-text" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted">
                Seed
                <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} className="num rounded-lg border border-line bg-bg px-3 py-2 text-[14px] text-text" />
              </label>
            </div>
          )}
          <Button onClick={() => run()} disabled={busy || !engine || (tab === "upload" && !file)}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {tab === "upload" ? "Upload roster" : "Generate roster"}
          </Button>
          {err && <p className="rounded-lg border border-danger/40 p-2 text-[13px] text-danger">{err}</p>}
          <p className="text-[12px] text-muted">Available: {rosters.map((r) => r.label).join(" · ")}</p>
          <details className="text-[12px] text-muted">
            <summary className="cursor-pointer text-text">What the file needs</summary>
            <p className="mt-1">One row per case with these columns: {REQUIRED.join(", ")}; and a count of hearings held so far for each hearing type (hearings_admission … hearings_application_review).</p>
          </details>
        </div>
        {out ? (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-text">
              <span className="display num text-[24px]">{out.cases.toLocaleString("en-IN")}</span> cases · {out.advocates} advocates
            </p>
            <Bars title="By stage" data={out.by_stage} />
            <Bars title="By age" data={out.by_age} />
            <p className="text-[12px] text-muted">Kinds of dispute: {Object.entries(out.dispute_kinds).map(([k, v]) => `${pretty(k)} ${v}`).join(" · ")}</p>
            <p className="text-[13px] text-text">What next: generate a causelist on this roster below.</p>
          </div>
        ) : (
          <p className="text-[13px] text-muted">The roster&apos;s summary appears here: cases, advocates, stages and ages.</p>
        )}
      </div>
    </Card>
  );
}

function CauselistCard({ engine, rosters, days, configs, onDone }: { engine: boolean | null; rosters: RosterInfo[]; days: string[]; configs: string[]; onDone: (s: string) => void }) {
  const [roster, setRoster] = useState("100");
  const [config, setConfig] = useState("optimal");
  const [date, setDate] = useState<string | null>(null);
  const [overbook, setOverbook] = useState(1);
  const [kappa, setKappa] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<CauselistOut | null>(null);
  const day = date ?? days[0] ?? "2026-09-28";
  const run = async (ex?: { roster: string; date: string }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await makeCauselist(ex?.roster ?? roster, config, ex?.date ?? day, { overbook, risk_kappa: kappa });
      setOut(r);
      onDone(`causelist for ${dateLabel(r.date, true)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  const offline = async () => {
    const r = await fetchRun(roster === "3000" ? "3000" : "100", config);
    const d = r?.days.find((x) => x.date === day);
    if (!d) return setErr("No saved causelist for that day and setup.");
    downloadCsv(`causelist_${day}.csv`, d.listings.map((l) => ({ window: `${l.start}-${l.end}`, case_number: l.case_id, purpose: l.purpose, advocate: l.advocate, chance_it_goes_ahead: l.p_ahead, why_listed: whyList(l.why).join("; ") })));
  };
  return (
    <Card>
      <Title icon={ListChecks} n={2} t="Generate the daily causelist" d="What this does for your court: tomorrow's list, sized to the sittings, with a time window and a reason for every matter." />
      <div className="mb-4">
        <Button variant="ghost" onClick={() => { setRoster("3000"); setDate("2026-09-30"); run({ roster: "3000", date: "2026-09-30" }); }} disabled={!engine || busy} className="px-3 py-1.5 text-[13px]">Try an example: Wed 30 Sep, full docket</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Select label="Roster" value={roster} onChange={setRoster} options={rosters.map((r) => ({ value: r.key, label: r.label }))} />
        <Select label="Court setup" value={config} onChange={setConfig} options={(configs.length ? configs : ["optimal"]).map((c) => ({ value: c, label: presetLabel(c) }))} />
        <Select label="Sitting day" value={day} onChange={setDate} options={days.map((d) => ({ value: d, label: dateLabel(d, true) }))} />
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <Slider label="How full to list the day" value={overbook} min={1} max={1.5} step={0.05} onChange={setOverbook} format={(v) => `+${Math.round((v - 1) * 100)}%`} />
        <Slider label="Safety buffer" value={kappa} min={0} max={2} step={0.1} onChange={setKappa} format={(v) => v.toFixed(1)} hint="Extra minutes booked for uncertainty." />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => run()} disabled={busy || !engine}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />} {busy ? "Planning the day… (up to a minute)" : "Generate causelist"}
        </Button>
        {!engine && (
          <Button variant="ghost" onClick={offline}>
            <Download size={15} /> Download the saved causelist
          </Button>
        )}
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {out && (
        <div className="mt-4">
          <p className="mb-2 text-[15px] text-text">
            {out.listings.length} matters listed, {Math.round(out.expected_minutes ?? 0)} of {out.capacity ?? "--"} minutes
            {out.held_back.length ? `, ${out.held_back.length} held back because a summons or papers are pending` : ""}
            {out.held_back_capacity ? `, ${out.held_back_capacity} ready but did not fit` : ""}.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <span>
              <span className="num text-text">{out.listings.length}</span> matters · expected{" "}
              <span className="num text-text">{Math.round(out.expected_minutes ?? 0)}</span> of {out.capacity ?? "--"} minutes
            </span>
            <Button variant="ghost" onClick={() => {
              const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `causelist_${out.date}.csv`;
              a.click();
            }} className="px-3 py-1 text-[12px]">
              <Download size={13} /> Download CSV
            </Button>
            <Link href="/court" className="text-primary hover:underline">Open in Court day</Link>
            <Link href="/bench" className="text-primary hover:underline">Open the Bench view</Link>
          </div>
          <div className="scroll-thin max-h-[420px] overflow-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>{["Window", "Case", "Purpose", "Advocate", "Chance it goes ahead", "Why listed"].map((h) => <th key={h} className="border-b border-line px-2 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {out.listings.map((l) => (
                  <tr key={l.case_id} className="border-b border-line">
                    <td className="num whitespace-nowrap px-2 py-1.5">{l.start}–{l.end}</td>
                    <td className="mono whitespace-nowrap px-2 py-1.5">{l.case_id}</td>
                    <td className="px-2 py-1.5">{pretty(l.purpose)}</td>
                    <td className="mono px-2 py-1.5 text-muted">{l.advocate}</td>
                    <td className="num px-2 py-1.5">{pct(l.p_ahead)}</td>
                    <td className="px-2 py-1.5 text-muted">{whyList(l.why).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(out.held_back.length > 0 || (out.held_back_capacity ?? 0) > 0) && (
            <p className="mt-2 text-[13px] text-muted">
              Held back: {out.held_back.length} not ready ({out.held_back.slice(0, 3).map((h) => `${h.case_id}: ${h.reason}`).join("; ")}
              {out.held_back.length > 3 ? "…" : ""}){out.held_back_capacity ? ` · ${out.held_back_capacity} ready but the day was full` : ""}.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const OUTCOMES = [
  { value: "moved", label: "Moved forward" },
  { value: "absent", label: "Did not appear" },
  { value: "sought_time", label: "Asked for time" },
  { value: "not_ready", label: "Summons or papers not ready" },
  { value: "not_reached", label: "Not reached" },
];

function NextDateCard({ engine, rosters, days, onDone }: { engine: boolean | null; rosters: RosterInfo[]; days: string[]; onDone: (s: string) => void }) {
  const [roster, setRoster] = useState("100");
  const [caseId, setCaseId] = useState("");
  const [today, setToday] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("absent");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<NextDateOut | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(emptyPrefs());
  const hasPrefs = [...prefs.petitioner.prefer, ...prefs.petitioner.avoid, ...prefs.respondent.prefer, ...prefs.respondent.avoid].length > 0;
  const caseIds = useAsync(() => fetchRun(roster === "3000" ? "3000" : "100", "optimal").then((r) => [...new Set((r?.days ?? []).flatMap((d) => d.listings.map((l) => l.case_id)))].sort()), [roster]) ?? [];
  const day = today ?? days[0] ?? "2026-09-28";
  const run = async (ex?: { roster: string; caseId: string; today: string; outcome: string }) => {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const r = await nextDate(ex?.roster ?? roster, (ex?.caseId ?? caseId).trim(), ex?.today ?? day, ex?.outcome ?? outcome, hasPrefs ? prefs : undefined);
      setOut(r);
      onDone(`next date for ${r.case_id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  const save = async (value: string, verdict: "agree" | "change") => {
    await saveAnnotations([{ case_id: caseId, day, field: "next_date", predicted: out?.suggested ?? null, judge_value: verdict === "agree" ? "agree" : value, note: "", annotator: "judge", roster, saved_at: new Date().toISOString() }]);
    setSaved(verdict === "agree" ? "Accepted." : `Changed to ${dateLabel(value, true)}.`);
  };
  return (
    <Card>
      <Title icon={CalendarCheck} n={3} t="Suggest the next best date" d="What this does for your court: a next date that fits the next step, with the rule in words, ready to accept or change." />
      <div className="mb-4">
        <Button variant="ghost" onClick={() => { setRoster("100"); setCaseId("ST/819/2023"); setToday("2026-10-05"); setOutcome("absent"); run({ roster: "100", caseId: "ST/819/2023", today: "2026-10-05", outcome: "absent" }); }} disabled={!engine || busy} className="px-3 py-1.5 text-[13px]">Try an example: ST/819/2023, 5 Oct, did not appear</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Select label="Roster" value={roster} onChange={setRoster} options={rosters.map((r) => ({ value: r.key, label: r.label }))} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted">Case number</span>
          <CaseSuggest value={caseId} onChange={setCaseId} options={caseIds} />
        </label>
        <Select label="Today" value={day} onChange={setToday} options={days.map((d) => ({ value: d, label: dateLabel(d, true) }))} />
        <Select label="Today's outcome" value={outcome} onChange={setOutcome} options={OUTCOMES} />
      </div>
      <div className="mt-3">
        <PartyDates value={prefs} onChange={setPrefs} />
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => run()} disabled={busy || !engine || !caseId.trim()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CalendarCheck size={15} />} Suggest the next date
        </Button>
        {!engine && <Link href="/bench" className="self-center text-[13px] text-primary hover:underline">See recorded next dates in the Bench view</Link>}
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {out &&
        (out.disposed ? (
          <div className="mt-4 rounded-lg p-4" style={{ background: "var(--green-subtle)", boxShadow: "inset 2px 0 0 var(--green)" }}>
            <p className="display text-[24px] text-text">This case is closed</p>
            <p className="text-[13px] text-muted">{out.explanation}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
            <div className="selected-row rounded-lg p-4">
              <p className="text-[11px] uppercase tracking-[0.12em] text-primary">Suggested next date</p>
              <p className="display mt-1 text-[32px] leading-none">{out.suggested ? dateLabel(out.suggested, true) : "--"}</p>
              <p className="mt-1 text-[13px] text-muted">
                {out.days_away} days away{out.next_purpose ? ` · for ${pretty(out.next_purpose)}` : ""}
              </p>
              {out.rule_date && out.rule_date !== out.suggested && (
                <p className="mt-1 text-[12px] text-text">
                  The rule&apos;s date: {dateLabel(out.rule_date, true)} · With the parties&apos; requests: {dateLabel(out.suggested ?? out.rule_date, true)}
                  {out.preferences_applied ? ` — ${out.preferences_applied}` : ""}
                </p>
              )}
              <p className="mt-2 text-[13px] text-text">{out.rule_in_words ? out.rule_in_words.charAt(0).toUpperCase() + out.rule_in_words.slice(1) + "." : ""}</p>
              {out.procedural_gap_days ? <p className="text-[12px] text-muted">The next step normally needs {out.procedural_gap_days} days.</p> : null}
              <Link href={`/case/${encodeURIComponent(out.case_id)}`} className="mt-1 inline-block text-[12px] text-primary hover:underline">Open the case file</Link>
              {saved ? (
                <p className="mt-3 text-[13px] text-green-strong">{saved}</p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => out.suggested && save(out.suggested, "agree")} className="px-3 py-1.5 text-[13px]">
                    <Check size={14} /> Accept
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {(out.alternatives ?? []).map((a) => (
                <button key={a.date} onClick={() => save(a.date, "change")} className={clsx("rounded-lg border border-line p-3 text-left hover:bg-surface-2")}>
                  <p className="num text-[14px] text-text">{dateLabel(a.date, true)}</p>
                  <p className="text-[12px] text-muted">
                    {a.days_away} days away · {a.note}
                  </p>
                  <Badge className="mt-1 bg-surface-2 text-muted ring-1 ring-line">Change to this date</Badge>
                </button>
              ))}
            </div>
          </div>
        ))}
    </Card>
  );
}

const REQUIRED = ["case_number", "filing_number", "filing_date", "advocate_id", "party_id", "current_stage", "last_hearing_summary", "purpose_of_next_hearing"];
const HEARING_COLS = ["hearings_admission", "hearings_delay_condonation_hearing", "hearings_cognizance", "hearings_appearance", "hearings_warrant", "hearings_plea", "hearings_examination_under_s351_bnss", "hearings_evidence_complainant", "hearings_evidence_accused", "hearings_arguments", "hearings_judgement", "hearings_bail", "hearings_reports", "hearings_application_review", "total_hearings_held"];
const blank = Object.fromEntries(HEARING_COLS.map((c) => [c, 0]));
const TEMPLATE_ROWS: Record<string, unknown>[] = [
  { case_number: "ST/101/2021", filing_number: "KL-000101-2021", filing_date: "2021-03-15", advocate_id: "ADV-001", party_id: "PARTY-00001", current_stage: "Evidence Complainant", last_hearing_summary: "Present: Complainant, Accused Advocate", purpose_of_next_hearing: "Evidence Complainant", ...blank, hearings_admission: 1, hearings_cognizance: 1, hearings_appearance: 2, hearings_plea: 1, hearings_evidence_complainant: 3, total_hearings_held: 8 },
  { case_number: "ST/202/2025", filing_number: "KL-000202-2025", filing_date: "2025-11-02", advocate_id: "ADV-002", party_id: "PARTY-00002", current_stage: "Appearance", last_hearing_summary: "Present: Complainant; Absent: Accused", purpose_of_next_hearing: "Appearance", ...blank, hearings_admission: 1, hearings_cognizance: 1, hearings_appearance: 1, total_hearings_held: 3 },
];

const FIVE = ["utilisation_pct", "reach_rate_pct", "substantive_pct_of_heard", "backlog_4y_heard_pct", "next_date_sane_pct"];

function CompareTable({ r, a, b }: { r: CompareResult; a: string; b: string }) {
  return (
    <table className="mt-3 w-full text-[13px]">
      <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
        <tr>
          <th className="py-1.5 font-medium">Measure</th>
          <th className="py-1.5 text-right font-medium">{a}</th>
          <th className="py-1.5 text-right font-medium">{b}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {FIVE.filter((k) => r.base[k] && r.modified[k]).map((k) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1.5 text-text">{meta(k).label}</td>
            <td className="num py-1.5 text-right text-muted">{fmtMetric(k, r.base[k].mean)}</td>
            <td className="num py-1.5 text-right text-text">{fmtMetric(k, r.modified[k].mean)}</td>
            <td className="py-1.5 text-right"><DeltaPill k={k} a={r.modified[k].mean} b={r.base[k].mean} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompareCard({ engine, configs, onDone }: { engine: boolean | null; configs: string[]; onDone: (s: string) => void }) {
  const opts = (configs.length ? configs : ["optimal"]).map((c) => ({ value: c, label: presetLabel(c) }));
  const [a, setA] = useState("optimal");
  const [b, setB] = useState("morning_bench");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<CompareResult | null>(null);
  const run = async (x = a, y = b) => {
    setBusy(true);
    setErr(null);
    try {
      // the engine compares a setup with overrides; to compare two setups, run each against itself and pair the means
      const [ra, rb] = await Promise.all([
        compare({ roster: "100", config: x, overrides: {}, sitting_days: 10 }, 3),
        compare({ roster: "100", config: y, overrides: {}, sitting_days: 10 }, 3),
      ]);
      setR({ base: ra.base, modified: rb.base });
      onDone(`compared ${presetLabel(x)} and ${presetLabel(y)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Title icon={ListChecks} n={4} t="Compare two court setups" d="What this does for your court: shows what a different way of running the day costs or gains, over ten sitting days." />
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Select label="Setup A" value={a} onChange={setA} options={opts} />
        <Select label="Setup B" value={b} onChange={setB} options={opts} />
        <div className="flex gap-2">
          <Button onClick={() => run()} disabled={!engine || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Compare</Button>
          <Button variant="ghost" onClick={() => { setA("optimal"); setB("morning_bench"); run("optimal", "morning_bench"); }} disabled={!engine || busy} className="px-3 text-[13px]">Try an example</Button>
        </div>
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {r && <CompareTable r={r} a={presetLabel(a)} b={presetLabel(b)} />}
      {r && <Link href="/scorecard" className="mt-2 inline-block text-[13px] text-primary hover:underline">See every setup on the Scorecard</Link>}
    </Card>
  );
}

function StressCard({ engine, onDone }: { engine: boolean | null; onDone: (s: string) => void }) {
  const [kind, setKind] = useState<"emergency" | "strike">("emergency");
  const [reserve, setReserve] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<CompareResult | null>(null);
  const run = async (k = kind) => {
    setBusy(true);
    setErr(null);
    try {
      const overrides = k === "emergency" ? { judge_emergency_p: 0.3, reserve_minutes: reserve } : { urgent_per_day: 4, absence_mult: 1.5, reserve_minutes: reserve };
      setR(await compare({ roster: "100", config: "optimal", overrides: overrides as never, sitting_days: 10 }, 3));
      onDone(k === "emergency" ? "judge called away" : "strike week");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Title icon={ListChecks} n={5} t="Simulate a bad day: the judge called away, or a strike" d="What this does for your court: tests how the list holds up on bad days, against a normal fortnight." />
      <div className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-end">
        <Segmented id="stress" value={kind} onChange={setKind} options={[{ value: "emergency", label: "Judge called away" }, { value: "strike", label: "Strike / many urgent matters" }]} />
        <Slider label="Minutes kept for urgent matters" value={reserve} min={0} max={90} step={5} onChange={setReserve} format={(v) => `${v} min`} />
        <Button onClick={() => run()} disabled={!engine || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Test it</Button>
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {r && <CompareTable r={r} a="Normal days" b={kind === "emergency" ? "Judge often called away" : "Strike week"} />}
    </Card>
  );
}

function AskCard({ engine, onDone }: { engine: boolean | null; onDone: (s: string) => void }) {
  const [q, setQ] = useState("Too many matters weren't reached this week");
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState<Proposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await askForProposal(q, "2026-09-28");
    if (!r) setErr("The assistant needs the local engine.");
    setP(r);
    if (r) onDone("asked the court assistant");
    setBusy(false);
  };
  return (
    <Card>
      <Title icon={ListChecks} n={6} t="Ask the court assistant" d="What this does for your court: describe a problem in your words; get the cause, a proposed change and its tested effect." />
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[14px]" />
        <Button onClick={run} disabled={!engine || busy || !q.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null} Ask</Button>
      </div>
      {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
      {p && (
        <div className="mt-3 rounded-lg bg-surface-2 p-4">
          <p className="text-[14px] leading-relaxed text-text">{p.answer}</p>
          {p.proposal && (
            <ul className="mt-2 flex flex-col gap-1 text-[13px]">
              {Object.entries(p.proposal).map(([k, v]) => (
                <li key={k} className="flex justify-between"><span>{LEVERS[k] ?? k}</span><span className="num text-primary">{leverValue(k, v)}</span></li>
              ))}
            </ul>
          )}
          {p.effect && (
            <p className="mt-2 text-[12px] text-muted">
              {Object.entries(p.effect).slice(0, 3).map(([k, e]) => `${meta(k).label}: ${fmtMetric(k, e.now)} → ${fmtMetric(k, e.with_change)}`).join(" · ")}
            </p>
          )}
        </div>
      )}
      <Link href="/assistant" className="mt-2 inline-block text-[13px] text-primary hover:underline">Open the full assistant</Link>
    </Card>
  );
}
