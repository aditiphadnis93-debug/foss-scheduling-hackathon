"use client";

import HowLink from "@/components/ui/HowLink";
import clsx from "clsx";
import { motion } from "framer-motion";
import PageHeader from "@/components/shell/PageHeader";
import { useRunPicker } from "@/components/shell/RunPicker";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { pretty, pct } from "@/lib/format";
import { priorsOf, type PriorRow, type PriorValues } from "@/lib/priors";
import { useExplain } from "@/components/shell/Explain";
import type { Run } from "@/lib/types";

const COLS: { key: keyof PriorValues; label: string; kind: "min" | "days" | "p" | "n" }[] = [
  { key: "minutes", label: "Minutes", kind: "min" },
  { key: "ideal_gap_days", label: "Gap to next date", kind: "days" },
  { key: "p_substantive", label: "Moves forward", kind: "p" },
  { key: "p_prerequisite_unmet", label: "Prerequisite missing", kind: "p" },
  { key: "p_absent_if_ready", label: "A side absent", kind: "p" },
  { key: "p_seek_time_if_ready", label: "Time sought", kind: "p" },
  { key: "p_court_side_if_ready", label: "Court side", kind: "p" },
];

function phrase(p: number): string {
  if (p >= 0.85) return "almost always";
  if (p >= 0.6) return "usually";
  if (p >= 0.4) return "about half the time";
  if (p >= 0.15) return "sometimes";
  if (p > 0.03) return "rarely";
  return "almost never";
}

function fmt(v: unknown, kind: string, plain = false): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  if (kind === "p") return plain ? phrase(v) : pct(v);
  if (kind === "days") return `${Math.round(v)} d`;
  return `${v.toFixed(v < 10 ? 1 : 0)}`;
}

export default function PriorsPage() {
  const { run, loading, controls, config } = useRunPicker("priors");
  const plain = useExplain() === "plain";
  const pr = priorsOf(run);
  const overridden = pr?.rows.filter((r) => r.judge_override && Object.keys(r.judge_override).length).length ?? 0;
  const learned = pr?.rows.filter((r) => r.learned) ?? [];
  return (
    <div>
      <PageHeader
        eyebrow="What the court assumes"
        title="The numbers behind every prediction"
        lede="For each kind of hearing: how long it takes, how often it moves the case, and why it fails. Three layers, each overriding the one below: the organiser's tables, the court's own defaults, and this judge's adjustments. What the scheduler uses is the last column."
        right={<>{controls}<HowLink id="priors" label="What the court assumes" /></>}
      />
      {loading ? (
        <Skeleton className="h-96" />
      ) : !pr ? (
        <Card>
          <p className="text-[14px] text-muted">
            This run does not carry the court&apos;s master list yet; it arrives with the next data export. The court
            defaults live in <span className="mono">config/priors/court_default.yaml</span>, and a judge overrides rows
            under <span className="mono">priors:</span> in their setup (for example, block scheduling sets evidence
            hearings to 40 minutes and arguments to 1.2 times the default).
          </p>
        </Card>
      ) : (
        <>
          <Card title="Master list by hearing type" subtitle={`${pr.rows.length} hearing types · ${overridden} adjusted by this judge${config ? ` (${config.replace(/_/g, " ")})` : ""}`}>
            <p className="mb-3 text-[14px] text-text">Each cell shows the value in use; a blue cell has been changed by the court or the judge, with the original beneath it.</p>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[980px] whitespace-nowrap text-[13px]">
                <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                  <tr>
                    <th className="border-b border-line px-2 py-2 font-medium">Hearing</th>
                    {COLS.map((c) => (
                      <th key={c.key} className="border-b border-line px-2 py-2 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                    <th className="border-b border-line px-2 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {pr.rows.map((r) => (
                    <tr key={r.hearing_type} className="border-b border-line">
                      <td className="px-2 py-2 text-text">{pretty(r.hearing_type)}</td>
                      {COLS.map((c) => (
                        <Cell key={c.key} r={r} k={c.key} kind={c.kind} plain={plain} />
                      ))}
                      <td className="max-w-[220px] truncate px-2 py-2 text-[12px] text-faint" title={String(r.effective.source ?? r.court?.source ?? r.organiser.source ?? "")}>
                        {String(r.judge_override && Object.keys(r.judge_override).length ? "judge override" : r.court ? "court default" : r.organiser.source ?? "organiser")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Takeaway>
              A judge can adjust minutes, the gap to the next date and the chance a hearing moves forward, within bounds;
              every other number comes from the court&apos;s records and can be checked here.
            </Takeaway>
          </Card>

          {learned.length > 0 && (
            <Card className="mt-5" title="What the court has learned" subtitle="Chance a hearing goes ahead: assumed before the period vs updated from what happened">
              <div className="flex flex-col gap-3">
                {learned.map((r, i) => {
                  const l = r.learned!;
                  return (
                    <div key={r.hearing_type} className="grid grid-cols-1 items-center gap-x-4 gap-y-1 sm:grid-cols-[180px_1fr_170px] sm:gap-y-4">
                      <span className="text-[13px] text-text">{pretty(r.hearing_type)}</span>
                      <div className="relative h-4 rounded bg-surface-2">
                        <div className="absolute inset-y-0 rounded" style={{ left: `${l.lo90 * 100}%`, width: `${(l.hi90 - l.lo90) * 100}%`, background: "var(--primary-soft)" }} />
                        <motion.div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-primary" initial={{ left: `${l.prior_go_ahead * 100}%` }} whileInView={{ left: `${l.posterior_go_ahead * 100}%` }} viewport={{ once: true }} transition={{ duration: 1, delay: i * 0.05 }} />
                        <div className="absolute -top-0.5 h-5 w-0.5 bg-[var(--c-baseline)]" style={{ left: `${l.prior_go_ahead * 100}%` }} title="assumed" />
                      </div>
                      <span className="num text-right text-[12px] text-muted">
                        {pct(l.prior_go_ahead)} → <span className="text-text">{pct(l.posterior_go_ahead)}</span> · n {l.n}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Takeaway>
                Grey is what was assumed; blue is the updated estimate with its 90% band. A narrow band that has moved away
                from the grey mark means this court behaves differently from the tables.
              </Takeaway>
            </Card>
          )}
        </>
      )}
      <DisputeKinds run={run} />
    </div>
  );
}

function Cell({ r, k, kind, plain }: { r: PriorRow; k: keyof PriorValues; kind: string; plain: boolean }) {
  const eff = r.effective[k];
  const org = r.organiser[k];
  const judge = r.judge_override?.[k] !== undefined || (k === "minutes" && r.judge_override?.minutes_mult !== undefined);
  const court = r.court?.[k] !== undefined && r.court[k] !== org;
  const changed = judge || court || (typeof eff === "number" && typeof org === "number" && Math.abs(eff - org) > 1e-9);
  return (
    <td className={clsx("num px-2 py-1.5 text-right", changed && "selected-row")}>
      <span className={changed ? "font-medium text-primary" : "text-text"}>{fmt(eff, kind, plain)}</span>
      {changed && (
        <span className="block text-[11px] text-faint">
          was {fmt(org, kind, plain)}
          {judge ? " · judge" : " · court"}
        </span>
      )}
    </td>
  );
}

type DisputeKind = { kind: string; label?: string; minutes_mult: number; absent_mult: number; source?: string };
const DEFAULT_KINDS: DisputeKind[] = [
  { kind: "unspecified", label: "Not recorded in the roster (reference)", minutes_mult: 1.0, absent_mult: 1.0, source: "reference" },
  { kind: "cheque_loan", label: "Cheque / loan", minutes_mult: 1.0, absent_mult: 1.0, source: "assumed" },
  { kind: "supplier", label: "Supplier dispute", minutes_mult: 1.15, absent_mult: 0.9, source: "assumed" },
  { kind: "wages", label: "Unpaid wages", minutes_mult: 0.9, absent_mult: 1.25, source: "assumed" },
  { kind: "rent", label: "Rent", minutes_mult: 1.0, absent_mult: 1.1, source: "assumed" },
  { kind: "family_property", label: "Family property", minutes_mult: 1.3, absent_mult: 1.15, source: "assumed" },
  { kind: "other", label: "Other", minutes_mult: 1.0, absent_mult: 1.0, source: "assumed" },
];

function times(m: number): string {
  return `×${m.toFixed(2).replace(/0$/, "")}`;
}

function DisputeKinds({ run }: { run: Run | null }) {
  const plain = useExplain() === "plain";
  const own = (run as (Run & { priors?: { dispute_kinds?: DisputeKind[] } }) | null)?.priors?.dispute_kinds;
  const kinds = own?.length ? own : DEFAULT_KINDS;
  return (
    <Card className="mt-5" title="By dispute type" subtitle={own?.length ? "From this run's master list" : "Court defaults (assumed until the court's own records say otherwise)"}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kinds.map((k, i) => (
          <motion.div
            key={k.kind}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="rounded-lg border border-line bg-bg p-4"
          >
            <p className="text-[14px] font-medium text-text">{k.label ?? pretty(k.kind)}</p>
            {plain ? (
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                <li>
                  Hearings take <span className="num text-text">{times(k.minutes_mult)}</span> as long
                </li>
                <li>
                  People are <span className="num text-text">{times(k.absent_mult)}</span> as likely to miss a date
                </li>
              </ul>
            ) : (
              <p className="mono mt-2 text-[12px] text-muted">
                kind={k.kind} · minutes_mult={k.minutes_mult} · absent_mult={k.absent_mult}
              </p>
            )}
            <p className="mt-2 text-[11px] text-faint">Source: {k.source ?? "assumed"}</p>
          </motion.div>
        ))}
      </div>
      <Takeaway>
        The organiser&apos;s data does not record the kind of dispute; its stage tables are the same for every kind, so
        roster cases get no adjustment. New filings from the town carry their kind. A court&apos;s own roster can add a{" "}
        <span className="mono">dispute_type</span> column and these factors apply automatically.
      </Takeaway>
    </Card>
  );
}
