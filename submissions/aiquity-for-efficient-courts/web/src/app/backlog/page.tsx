"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import AgeArea from "@/components/charts/AgeArea";
import Trajectory from "@/components/charts/Trajectory";
import { Badge, Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Segmented, Select, Tabs } from "@/components/ui/Controls";
import { availableConfigs, preferredRoster, useAsync, useRuns } from "@/lib/data";
import { AGE_COLOUR, AGE_KEYS, AGE_LABEL, C, OUTCOME_COLOUR, OUTCOME_LABEL, presetColour } from "@/lib/theme";
import { dateLabel, daysBetween, presetLabel, pretty, shortDate } from "@/lib/format";
import type { FlagRow, Roster, Run } from "@/lib/types";

type FlagKey = "ageing" | "repeat_adjournments" | "stuck_at_stage";
const FLAG_INFO: Record<FlagKey, { label: string; take: string }> = {
  ageing: { label: "Ageing at risk", take: "The oldest pending cases at the end of the period. Each should leave court with a firm next date." },
  repeat_adjournments: { label: "Repeat adjournments", take: "Adjourned two or more times in a row. Consider a peremptory date or costs." },
  stuck_at_stage: { label: "Stuck at a stage", take: "More than twice the usual number of hearings at the current stage." },
};

export default function Backlog() {
  const initial = useAsync(() => preferredRoster(["optimal", "baseline"]), []);
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initial ?? "100";
  const configs = (useAsync(() => availableConfigs(roster), [roster]) ?? []).filter((c) => c !== "baseline");
  const [configPick, setConfig] = useState("optimal");
  const config = configs.includes(configPick) ? configPick : configs[0] ?? "optimal";
  const { runs, loading } = useRuns(roster, [config, "baseline"]);
  const ours = runs[config];
  const base = runs["baseline"];
  const [flag, setFlag] = useState<FlagKey>("ageing");
  const [caseId, setCaseId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Backlog"
        title="How old is the docket, and who is at risk?"
        lede="Pending cases by how long they have waited, every sitting day, under a court setup and under current practice. Cases age into older bands while they wait, so holding the rose bands flat is already work."
        right={
          <>
            <Segmented<Roster>
              id="bl-roster"
              value={roster}
              onChange={(r) => setRoster(r)}
              options={[
                { value: "100", label: "100 cases" },
                { value: "3000", label: "3,000 cases" },
              ]}
            />
            <div className="min-w-[200px]">
              <Select value={config} onChange={setConfig} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
            </div>
          </>
        }
      />

      {loading || !ours ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <AreaCard run={ours} title={presetLabel(config)} colour={presetColour(config)} id="ours" />
            {base ? <AreaCard run={base} title="Current practice" colour={C.baseline} id="base" /> : <Skeleton className="h-80" />}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 px-1 text-[12px] text-muted">
            {AGE_KEYS.map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: AGE_COLOUR[k] }} />
                {AGE_LABEL[k]}
              </span>
            ))}
          </div>

          <OldTrajectory ours={ours} base={base} config={config} />

          <Card className="mt-5" title="Flags for the judge" subtitle={`At the end of the period under ${presetLabel(config)}. Click a case for its full timeline.`}>
            <Tabs<FlagKey>
              id="flags"
              value={flag}
              onChange={setFlag}
              tabs={(Object.keys(FLAG_INFO) as FlagKey[]).map((k) => ({
                value: k,
                label: (
                  <span>
                    {FLAG_INFO[k].label} <span className="num text-faint">{ours.flags?.[k]?.length ?? 0}</span>
                  </span>
                ),
              }))}
            />
            <FlagTable rows={ours.flags?.[flag] ?? []} onPick={setCaseId} />
            <Takeaway>{FLAG_INFO[flag].take}</Takeaway>
          </Card>

          <CaseFinder run={ours} onPick={setCaseId} />
        </>
      )}

      <Drawer open={!!caseId && !!ours} onClose={() => setCaseId(null)} title={<span className="num">{caseId}</span>}>
        {caseId && ours && <CaseTimeline run={ours} caseId={caseId} />}
      </Drawer>
    </div>
  );
}

function AreaCard({ run, title, colour, id }: { run: Run; title: string; colour: string; id: string }) {
  const first = run.backlog[0];
  const last = run.backlog[run.backlog.length - 1];
  const old = (r?: Run["backlog"][number]) => (r ? r["4-5y"] + r["5y+"] : 0);
  const total = (r?: Run["backlog"][number]) => (r ? AGE_KEYS.reduce((s, k) => s + r[k], 0) : 0);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
          {title}
        </span>
      }
      subtitle={`${total(first)} pending at start · ${total(last)} at end · ${last?.disposed_cum ?? 0} disposed`}
    >
      <AgeArea data={run.backlog} id={id} />
      <Takeaway>
        Cases pending four years or more went from <span className="num text-old">{old(first)}</span> to{" "}
        <span className="num text-old">{old(last)}</span>.
      </Takeaway>
    </Card>
  );
}

function OldTrajectory({ ours, base, config }: { ours: Run; base?: Run; config: string }) {
  const data = useMemo(() => {
    const bmap = new Map((base?.backlog ?? []).map((r) => [r.date, r]));
    return ours.backlog.map((r) => {
      const b = bmap.get(r.date);
      return {
        date: r.date,
        ours4: r["4-5y"] + r["5y+"],
        ours5: r["5y+"],
        ...(b ? { base4: b["4-5y"] + b["5y+"], base5: b["5y+"] } : {}),
      };
    });
  }, [ours, base]);
  const end = data[data.length - 1] as Record<string, number | string> | undefined;
  const col = presetColour(config);
  return (
    <Card className="mt-5" title="The oldest cases over time" subtitle="Pending 4+ years (solid) and 5+ years (dashed).">
      <Trajectory
        data={data}
        series={[
          { key: "ours4", name: `${presetLabel(config)} · 4+ yrs`, colour: col },
          { key: "ours5", name: `${presetLabel(config)} · 5+ yrs`, colour: col, dashed: true },
          ...(base
            ? [
                { key: "base4", name: "Current · 4+ yrs", colour: C.baseline },
                { key: "base5", name: "Current · 5+ yrs", colour: C.baseline, dashed: true },
              ]
            : []),
        ]}
      />
      {end && base && (
        <Takeaway>
          By the last sitting day, <span className="num text-text">{String(end.ours4)}</span> cases are 4+ years old under{" "}
          {presetLabel(config)} against <span className="num text-text">{String(end.base4)}</span> under today&apos;s
          practice. The gap is what the ageing floor and age weighting buy.
        </Takeaway>
      )}
    </Card>
  );
}

function FlagTable({ rows, onPick }: { rows: FlagRow[]; onPick: (id: string) => void }) {
  if (!rows.length) return <p className="py-6 text-[13px] text-muted">Nothing flagged.</p>;
  return (
    <div className="scroll-thin mt-3 max-h-[420px] overflow-auto">
      <table className="w-full min-w-[680px] whitespace-nowrap text-[13px]">
        <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-[0.1em] text-muted">
          <tr>
            {["Case", "Age", "Stage", "Next purpose", "Adjourned in a row", "Hearings at stage", "Advocate"].map((h) => (
              <th key={h} className="border-b border-line px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <motion.tr
              key={r.case_id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, 20) * 0.015 }}
              onClick={() => onPick(r.case_id)}
              className="cursor-pointer border-b border-line hover:bg-surface-2"
            >
              <td className="num px-2 py-2" style={r.age_years >= 4 ? { color: C.old } : undefined}>
                {r.case_id}
              </td>
              <td className="num px-2 py-2">{r.age_years.toFixed(1)} yrs</td>
              <td className="px-2 py-2">{pretty(r.stage)}</td>
              <td className="px-2 py-2 text-muted">{pretty(r.purpose)}</td>
              <td className="num px-2 py-2">
                <span className={clsx(r.adjournments_in_row >= 3 && "text-adj")}>{r.adjournments_in_row}</span>
              </td>
              <td className="num px-2 py-2">{r.hearings_at_stage}</td>
              <td className="num px-2 py-2 text-muted">{r.advocate}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseFinder({ run, onPick }: { run: Run; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const d of run.days) for (const l of d.listings) s.add(l.case_id);
    return [...s].sort();
  }, [run]);
  const hits = q.trim() ? ids.filter((i) => i.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 24) : ids.slice(0, 24);
  return (
    <Card className="mt-5" title="Case timeline" subtitle={`Any of the ${ids.length.toLocaleString("en-IN")} cases listed in the period: every listing, outcome, reason and next date.`}>
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a case number"
          className="num w-full rounded-lg border border-line bg-surface-2 py-2 pl-9 pr-3 text-[13px] text-text outline-none placeholder:text-faint focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {hits.map((id) => (
          <button key={id} onClick={() => onPick(id)} className="num rounded-md px-2 py-1 text-[12px] text-muted ring-1 ring-line hover:text-text hover:ring-faint">
            {id}
          </button>
        ))}
      </div>
    </Card>
  );
}

function CaseTimeline({ run, caseId }: { run: Run; caseId: string }) {
  const events = useMemo(
    () =>
      run.days.flatMap((d) =>
        d.listings.filter((l) => l.case_id === caseId).map((l) => ({ date: d.date, l })),
      ),
    [run, caseId],
  );
  const held = useMemo(
    () => run.days.flatMap((d) => d.held_back.filter((h) => h.case_id === caseId).map((h) => ({ date: d.date, reason: h.reason }))),
    [run, caseId],
  );
  const info = run.cases?.[caseId];
  const span = Math.max(1, daysBetween(run.meta.start, run.meta.end));
  return (
    <div>
      {info && (
        <div className="mb-5 grid grid-cols-2 gap-2 text-[13px]">
          <Info label="Filed" value={dateLabel(info.filing_date)} />
          <Info label="Pending at start" value={`${info.age_at_start.toFixed(1)} yrs`} highlight={info.age_at_start >= 4} />
          <Info label="Stage at start" value={pretty(info.stage_start)} />
          <Info label="At end" value={info.status_end === "disposed" ? "Disposed" : pretty(info.stage_end)} />
        </div>
      )}
      <div className="relative mb-6 h-12 rounded-lg bg-surface-2 ring-1 ring-line">
        <div className="absolute inset-x-3 top-1/2 h-px bg-line" />
        {events.map((e, i) => (
          <motion.span
            key={e.date}
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{
              left: `calc(12px + (100% - 24px) * ${daysBetween(run.meta.start, e.date) / span})`,
              background: e.l.outcome ? OUTCOME_COLOUR[e.l.outcome.kind] : C.baseline,
              boxShadow: `0 0 12px ${e.l.outcome ? OUTCOME_COLOUR[e.l.outcome.kind] : C.baseline}`,
            }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1 + i * 0.06, type: "spring", stiffness: 400, damping: 20 }}
            title={`${shortDate(e.date)}: ${e.l.outcome ? OUTCOME_LABEL[e.l.outcome.kind] : "listed"}`}
          />
        ))}
        <span className="absolute bottom-0.5 left-3 text-[10px] text-faint">{shortDate(run.meta.start)}</span>
        <span className="absolute bottom-0.5 right-3 text-[10px] text-faint">{shortDate(run.meta.end)}</span>
      </div>
      {events.length === 0 && <p className="text-[13px] text-muted">Not listed during the period.</p>}
      <ol className="relative flex flex-col gap-3 border-l border-line pl-5">
        {events.map((e, i) => (
          <motion.li key={e.date} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="relative">
            <span
              className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full"
              style={{ background: e.l.outcome ? OUTCOME_COLOUR[e.l.outcome.kind] : C.baseline }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="num text-[13px] text-text">{dateLabel(e.date, true)}</span>
              <span className="num text-[12px] text-muted">
                {e.l.start}-{e.l.end}
              </span>
              {e.l.outcome && <Badge colour={OUTCOME_COLOUR[e.l.outcome.kind]}>{OUTCOME_LABEL[e.l.outcome.kind]}</Badge>}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {pretty(e.l.purpose)} · chance it goes ahead {(e.l.p_ahead * 100).toFixed(0)}% · expected {e.l.exp_min.toFixed(0)} min
              {e.l.outcome?.reason ? ` · ${e.l.outcome.reason}` : ""}
            </p>
            {e.l.outcome && (
              <p className="mt-0.5 text-[12px] text-faint">
                {e.l.outcome.next_date
                  ? `Next ${dateLabel(e.l.outcome.next_date, true)}${e.l.outcome.next_purpose ? ` for ${pretty(e.l.outcome.next_purpose)}` : ""}`
                  : "Disposed"}
              </p>
            )}
          </motion.li>
        ))}
      </ol>
      {held.length > 0 && (
        <p className="mt-5 text-[12px] text-faint">
          Held back on {held.length} day{held.length > 1 ? "s" : ""} while a prerequisite was pending (first: {shortDate(held[0].date)}, {held[0].reason}).
        </p>
      )}
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-faint">{label}</p>
      <p className="num text-[14px]" style={highlight ? { color: C.old } : undefined}>
        {value}
      </p>
    </div>
  );
}
