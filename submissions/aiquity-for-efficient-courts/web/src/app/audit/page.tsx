"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { DerivedNote, useRunPicker } from "@/components/shell/RunPicker";
import { Badge, Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Button, Select } from "@/components/ui/Controls";
import { dateLabel, downloadCsv, shortDate } from "@/lib/format";
import { STAKEHOLDER_COLOUR, STAKEHOLDER_LABEL, auditOf, type AuditRow } from "@/lib/insights";

const PAGE = 200;

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? shortDate(v) : v;
  return JSON.stringify(v);
}

export default function Audit() {
  const { run, loading, controls } = useRunPicker("audit");
  const audit = useMemo(() => (run ? auditOf(run) : null), [run]);
  const [day, setDay] = useState("all");
  const [action, setAction] = useState("all");
  const [rule, setRule] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const opts = useMemo(() => {
    const rows = audit?.rows ?? [];
    const uniq = (f: (r: AuditRow) => string) => [...new Set(rows.map(f))].filter(Boolean).sort();
    return { days: uniq((r) => r.day), actions: uniq((r) => r.action), rules: uniq((r) => r.rule) };
  }, [audit]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (audit?.rows ?? []).filter(
      (r) =>
        (day === "all" || r.day === day) &&
        (action === "all" || r.action === action) &&
        (rule === "all" || r.rule === rule) &&
        (!needle || (r.case_id ?? "").toLowerCase().includes(needle)),
    );
  }, [audit, day, action, rule, q]);

  return (
    <div>
      <PageHeader
        eyebrow="Audit"
        title="Every decision, the rule behind it, and why"
        lede="Each line reads as a sentence: on this day, for this case, the scheduler did this, by this rule, for this reason. Filter to one case to see its whole story."
        right={controls}
      />
      {loading || !run || !audit ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <DerivedNote show={audit.derived} what="The audit log" />
          <Card>
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Case</span>
                <span className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setLimit(PAGE);
                    }}
                    placeholder="Case number"
                    className="mono w-full rounded-lg border border-line bg-bg py-2 pl-8 pr-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </span>
              </label>
              <Select label="Day" value={day} onChange={(v) => { setDay(v); setLimit(PAGE); }} options={[{ value: "all", label: "All days" }, ...opts.days.map((d) => ({ value: d, label: dateLabel(d, true) }))]} />
              <Select label="Action" value={action} onChange={(v) => { setAction(v); setLimit(PAGE); }} options={[{ value: "all", label: "All actions" }, ...opts.actions.map((a) => ({ value: a, label: a }))]} />
              <Select label="Rule" value={rule} onChange={(v) => { setRule(v); setLimit(PAGE); }} options={[{ value: "all", label: "All rules" }, ...opts.rules.map((a) => ({ value: a, label: a }))]} />
              <Button variant="ghost" onClick={() => downloadCsv("audit.csv", rows.map((r) => ({ ...r, before: show(r.before), after: show(r.after) })))}>
                <Download size={15} /> CSV
              </Button>
            </div>
            <p className="mb-3 text-[13px] text-muted">
              <span className="num text-text">{rows.length.toLocaleString("en-IN")}</span> of {audit.rows.length.toLocaleString("en-IN")} entries
            </p>
            <ol className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-line bg-bg">
              {rows.slice(0, limit).map((r, i) => (
                <li key={`${r.day}-${r.case_id}-${r.action}-${i}`} className="grid gap-1 px-4 py-2.5 md:grid-cols-[92px_150px_1fr] md:gap-4">
                  <span className="num text-[12px] text-muted">{dateLabel(r.day, true)}</span>
                  <button onClick={() => setQ(r.case_id)} className="mono text-left text-[12px] text-primary hover:underline">
                    {r.case_id}
                  </button>
                  <span className="text-[13px] text-text">
                    <span className="font-medium">{r.action}</span>
                    <span className="text-muted"> by </span>
                    <Badge className="bg-surface-2 text-text ring-1 ring-line">{r.rule}</Badge>
                    {r.why && <span className="text-muted"> because {r.why.charAt(0).toLowerCase() + r.why.slice(1)}</span>}
                    {(show(r.before) || show(r.after)) && (
                      <span className="num ml-1 text-[12px] text-faint">
                        {show(r.before) && `${show(r.before)} `}
                        {show(r.after) && `→ ${show(r.after)}`}
                      </span>
                    )}
                    {r.stakeholder && (
                      <span className="ml-2">
                        <Badge colour={STAKEHOLDER_COLOUR[r.stakeholder] ?? "var(--c-baseline)"}>{STAKEHOLDER_LABEL[r.stakeholder] ?? r.stakeholder}</Badge>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {rows.length > limit && (
              <div className="mt-3 flex justify-center">
                <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  Show more
                </Button>
              </div>
            )}
            <Takeaway>
              Nothing on the causelist happens without a rule a judge can read. Click a case number to follow it from
              listing to outcome to its next date.
            </Takeaway>
          </Card>
        </>
      )}
    </div>
  );
}
