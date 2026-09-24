"use client";

import HowLink from "@/components/ui/HowLink";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import PageHeader from "@/components/shell/PageHeader";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Segmented, Select } from "@/components/ui/Controls";
import { CountUp } from "@/components/ui/Stat";
import { availableConfigs, preferredRoster, useAsync, useRuns } from "@/lib/data";
import { runwayOf, type Runway } from "@/lib/priors";
import { C } from "@/lib/theme";
import { presetLabel, pretty } from "@/lib/format";
import { EASE } from "@/lib/motion";
import type { Roster } from "@/lib/types";

const STAGES = [
  "ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA",
  "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT",
];

export default function RunwayPage() {
  const initial = useAsync(() => preferredRoster(["optimal", "baseline"]), []);
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initial ?? "100";
  const configs = (useAsync(() => availableConfigs(roster), [roster]) ?? []).filter((c) => c !== "baseline");
  const [pick, setPick] = useState("optimal");
  const config = configs.includes(pick) ? pick : configs[0] ?? "optimal";
  const { runs, loading } = useRuns(roster, [config, "baseline"]);
  const ours = runwayOf(runs[config]);
  const base = runwayOf(runs.baseline);

  return (
    <div>
      <PageHeader
        eyebrow="What this posting can close"
        title="How many cases can this judge actually finish?"
        lede="A judge is posted to a court for a fixed window. Each case needs a certain number of hearings, each after its procedural gap, before it can reach judgement. This page asks which cases could be finished in the window at all, and whether the plan finished them."
        right={
          <>
            <Segmented<Roster> id="rw-roster" value={roster} onChange={setRoster} options={[{ value: "100", label: "100 cases" }, { value: "3000", label: "3,000 cases" }]} />
            <div className="min-w-[200px]">
              <Select value={config} onChange={setPick} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
            </div>
          </>
        }
      />
      {loading ? (
        <Skeleton className="h-80" />
      ) : !ours ? (
        <Card>
          <p className="text-[14px] text-muted">This run does not carry the posting window analysis yet; it arrives with the next data export.</p>
        </Card>
      ) : (
        <>
          <Headline r={ours} b={base} config={config} />
          <HowLink id="limits" label="Limits" className="mt-2 inline-block" />
          <StageBars r={ours} b={base} config={config} />
          <NotFinished r={ours} />
        </>
      )}
    </div>
  );
}

function Headline({ r, b, config }: { r: Runway; b: Runway | null; config: string }) {
  const cells = [
    { v: r.finishable, label: "could reach judgement on the fastest path", sub: `of ${r.cases.toLocaleString("en-IN")} cases in a ${r.window_days}-day window` },
    { v: r.finishable_typical, label: "could reach judgement at the typical pace", sub: "each hearing waiting its usual gap" },
    { v: r.disposed, label: `disposed under ${presetLabel(config)}`, sub: b ? `current practice: ${b.disposed.toLocaleString("en-IN")}` : "" },
    { v: r.never_called, label: "never came before the judge", sub: "the roster is larger than the posting" },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((c, i) => (
          <div key={c.label} className={i === 2 ? "card border-l-2 border-l-primary p-5" : "card p-5"}>
            <CountUp value={c.v} className="display text-[40px] leading-none text-text" />
            <p className="mt-2 text-[14px] text-text">{c.label}</p>
            <p className="text-[12px] text-muted">{c.sub}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[14px] text-text">
        Of the {r.cases.toLocaleString("en-IN")} cases, {r.finishable.toLocaleString("en-IN")} could in principle be finished
        in {r.window_days} days, but only {r.finishable_typical.toLocaleString("en-IN")} at the pace cases usually move.
        {b ? ` The plan disposed ${r.disposed.toLocaleString("en-IN")} against ${b.disposed.toLocaleString("en-IN")} under current practice.` : ""} Cases
        called on average {r.mean_appearances.toFixed(1)} times each.
      </p>
    </>
  );
}

function StageBars({ r, b, config }: { r: Runway; b: Runway | null; config: string }) {
  const stages = STAGES.filter((s) => r.by_stage[s]).concat(Object.keys(r.by_stage).filter((s) => !STAGES.includes(s)));
  const max = Math.max(1, ...stages.map((s) => r.by_stage[s].cases));
  return (
    <Card className="mt-5" title="By stage" subtitle="Cases at each stage when the window opened: how many could finish, and how many were disposed">
      <p className="mb-4 text-[14px] text-text">Cases near arguments and judgement are where a posting can close the most; early-stage cases need more hearings than the window allows.</p>
      <div className="flex flex-col gap-3">
        {stages.map((s, i) => {
          const o = r.by_stage[s];
          const bb = b?.by_stage[s];
          const bar = (v: number, colour: string, d: number, h = "h-2") => (
            <div className={`relative ${h} rounded bg-surface-2`}>
              <motion.div className="absolute inset-y-0 left-0 rounded" style={{ background: colour }} initial={{ width: 0 }} whileInView={{ width: `${(v / max) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.8, delay: d, ease: EASE }} />
            </div>
          );
          return (
            <div key={s} className="grid gap-2 md:grid-cols-[200px_1fr_190px] md:items-center">
              <span className="text-[13px] text-text">{pretty(s)}</span>
              <div className="flex flex-col gap-0.5">
                {bar(o.cases, "var(--border)", 0)}
                {bar(o.finishable, "var(--primary-soft)", 0.05 * i)}
                {bar(o.disposed, C.ours, 0.1 + 0.05 * i)}
                {bb && bar(bb.disposed, C.baseline, 0.15 + 0.05 * i)}
              </div>
              <span className="num text-right text-[12px] text-muted">
                {o.cases} cases · {o.finishable} possible · <span className="text-text">{o.disposed}</span>
                {bb ? ` vs ${bb.disposed}` : ""} disposed
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded bg-[var(--border)]" /> cases at the stage</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded bg-primary-soft" /> could finish in the window</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded bg-primary" /> disposed, {presetLabel(config)}</span>
        {b && <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded bg-[var(--c-baseline)]" /> disposed, current practice</span>}
      </div>
      <Takeaway>The gap between the light and dark blue bars is work the posting could have closed.</Takeaway>
    </Card>
  );
}

function NotFinished({ r }: { r: Runway }) {
  const rows = useMemo(() => [...(r.finishable_not_disposed ?? [])].sort((a, b) => b.age_years - a.age_years), [r]);
  return (
    <Card className="mt-5" title="Could have finished, but didn't" subtitle={`${rows.length.toLocaleString("en-IN")} cases that fit the window on the fastest path and are still pending · oldest first`}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">Every case that could be finished in the window was finished.</p>
      ) : (
        <div className="scroll-thin max-h-[480px] overflow-auto">
          <table className="w-full min-w-[820px] whitespace-nowrap text-[13px]">
            <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <tr>
                {["Case", "Pending", "Stage", "Stages left", "Hearings needed", "Fastest days", "Called", "Stages moved"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((x) => (
                <tr key={x.case_id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-2 py-2">
                    <Link href={`/case/${encodeURIComponent(x.case_id)}`} className="mono text-primary hover:underline">{x.case_id}</Link>
                  </td>
                  <td className="num px-2 py-2" style={x.age_years >= 4 ? { color: C.old } : undefined}>{x.age_years.toFixed(1)} yrs</td>
                  <td className="px-2 py-2">{pretty(x.stage)}</td>
                  <td className="num px-2 py-2">{x.stages_left}</td>
                  <td className="num px-2 py-2">{x.hearings_needed.toFixed(1)}</td>
                  <td className="num px-2 py-2">{Math.round(x.fastest_days_needed)}</td>
                  <td className="num px-2 py-2">{x.appearances} of {x.max_appearances} possible</td>
                  <td className="num px-2 py-2">{x.stages_advanced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Takeaway>These are the cases to prioritise before the posting ends: the time exists, the listings did not.</Takeaway>
    </Card>
  );
}
