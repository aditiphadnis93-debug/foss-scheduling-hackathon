"use client";

/**
 * "From population to court": a vertical funnel from the town's population to the complaints
 * that reach this court. Kinds heard elsewhere peel off to their own forum; every rate shows
 * its source label (most are "assumed").
 */
import { motion } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import type { PopulationFunnel as PF } from "@/lib/world";

const MUTED = "text-[var(--text-muted,var(--muted,#65758B))]";
const n0 = (v: number) => Math.round(v).toLocaleString("en-IN");

const STEPS: { key: string; label: string; peel?: boolean }[] = [
  { key: "arisen", label: "Disputes arise" },
  { key: "legal_notice", label: "Legal notice sent" },
  { key: "paid_on_notice", label: "Paid on notice", peel: true },
  { key: "negotiation", label: "Try to negotiate" },
  { key: "settled_in_negotiation", label: "Settled in negotiation", peel: true },
  { key: "complaint_filed", label: "Complaint filed" },
  { key: "reaches_court", label: "Reach this court" },
];

function Source({ s }: { s?: string }) {
  if (!s) return null;
  return <span title={s} className="inline-block max-w-[120px] truncate rounded-full bg-[var(--surface-2)] px-1.5 py-px align-middle text-[9.5px] uppercase tracking-wider text-[var(--text-muted,var(--muted,#65758B))]">{s}</span>;
}

export default function PopulationFunnel({ funnel, onClose }: { funnel: PF; onClose: () => void }) {
  const kinds = Object.entries(funnel.config?.kinds ?? {});
  const exp = funnel.expected_per_year ?? {};
  const here = kinds.filter(([, k]) => (k.forum ?? "this_court") === "this_court");
  const away = kinds.filter(([, k]) => (k.forum ?? "this_court") !== "this_court");
  const sum = (ks: typeof kinds, stage: string) => ks.reduce((t, [id]) => t + (exp[id]?.[stage] ?? 0), 0);
  const pop = funnel.config?.city_population;
  const allArisen = sum(kinds, "arisen");
  const top = Math.max(1, sum(here, "arisen"));
  // rate for a stage: the main kind's value + source (kinds may differ; the row shows the range)
  const rate = (stage: string) => {
    const vals = here.map(([, k]) => k.stages?.[stage]).filter((v): v is { value: number; source?: string } => !!v);
    if (!vals.length) return null;
    const lo = Math.min(...vals.map((v) => v.value)), hi = Math.max(...vals.map((v) => v.value));
    return { text: lo === hi ? `${Math.round(lo * 100)}%` : `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, source: vals[0].source };
  };

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] shadow-[0_1px_2px_rgba(17,24,39,.06),0_8px_24px_rgba(17,24,39,.06)]">
      <div className="flex items-start justify-between border-b border-[var(--border,var(--line,#E1E7EF))] px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">From population to court</div>
          <div className="mt-1 text-sm">Expected per year. Most disputes never reach this court.</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={clsx("rounded-md p-1 hover:bg-[var(--surface-2)]", MUTED)}><X size={16} /></button>
      </div>
      <div className="overflow-y-auto px-5 py-4">
        {/* population */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm">People in the town</span>
          <span className="flex items-center gap-2"><span className="font-mono text-lg font-semibold">{n0(pop?.value ?? 0)}</span><Source s={pop?.source} /></span>
        </div>

        {/* disputes by kind */}
        <div className="mt-4 text-sm">Disputes a year, by kind <span className={clsx("font-mono", MUTED)}>{n0(allArisen)}</span></div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-[var(--surface-2)]">
          {kinds.map(([id, k], i) => (
            <motion.div key={id} initial={{ width: 0 }} animate={{ width: `${((exp[id]?.arisen ?? 0) / Math.max(1, allArisen)) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.05 }}
              className="h-full border-r border-[var(--surface)]" title={k.label}
              style={{ background: (k.forum ?? "this_court") === "this_court" ? (i % 2 ? "var(--primary-hover,#3C83F6)" : "var(--primary,#2463EB)") : "var(--c-baseline,#9CA3B0)" }} />
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {kinds.map(([id, k]) => (
            <div key={id} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: (k.forum ?? "this_court") === "this_court" ? "var(--primary,#2463EB)" : "var(--c-baseline,#9CA3B0)" }} />
              <span className="min-w-0 flex-1 truncate">{k.label ?? id}</span>
              <span className={clsx("font-mono", MUTED)}>{k.per_1000_per_year?.value ?? "?"}/1,000</span>
              <Source s={k.per_1000_per_year?.source} />
              <span className="w-12 text-right font-mono">{n0(exp[id]?.arisen ?? 0)}</span>
            </div>
          ))}
        </div>

        {away.length > 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--border,var(--line,#E1E7EF))] px-3 py-2 text-xs">
            <div className={MUTED}>Peel off to other forums</div>
            {away.map(([id, k]) => (
              <div key={id} className="mt-1 flex justify-between"><span>{k.label ?? id} → {k.forum}</span><span className="font-mono">{n0(exp[id]?.arisen ?? 0)}</span></div>
            ))}
          </div>
        )}

        {/* the cheque kinds that can come here */}
        <div className="mt-5 text-sm">The kinds this court hears</div>
        <div className="mt-2 space-y-1.5">
          {STEPS.map((st, i) => {
            const v = sum(here, st.key);
            const r = i > 0 ? rate(st.key) : null;
            const last = st.key === "reaches_court";
            return (
              <div key={st.key} className={clsx(st.peel && "pl-6")}>
                <div className="flex items-center justify-between text-xs">
                  <span className={clsx(last && "font-semibold")}>{st.peel ? "↳ " : ""}{st.label}</span>
                  <span className="flex items-center gap-1.5">
                    {r && <span className={clsx("font-mono", MUTED)}>{r.text}</span>}
                    {r && <Source s={r.source} />}
                    <span className="w-12 text-right font-mono font-semibold">{n0(v)}</span>
                  </span>
                </div>
                <div className="mt-1 flex h-2.5 justify-center">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${(v / top) * 100}%` }} transition={{ duration: 0.7, delay: 0.2 + i * 0.06 }}
                    className="h-full rounded-full"
                    style={{ background: st.peel ? "var(--c-substantive,#10B77F)" : last ? "var(--primary-strong,#1E3B8A)" : "var(--primary,#2463EB)", opacity: st.peel ? 0.8 : 1 }} />
                </div>
              </div>
            );
          })}
        </div>

        {(funnel.expected_filings_per_sitting_day != null || funnel.observed_filings_per_sitting_day != null) && (
          <div className="mt-5 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-[var(--surface-2)] py-2">
              <div className="font-mono text-lg font-semibold">{funnel.expected_filings_per_sitting_day ?? "-"}</div>
              <div className={clsx("text-[10px] uppercase tracking-wider", MUTED)}>expected filings / sitting day</div>
            </div>
            <div className="rounded-lg bg-[var(--surface-2)] py-2">
              <div className="font-mono text-lg font-semibold">{funnel.observed_filings_per_sitting_day ?? "-"}</div>
              <div className={clsx("text-[10px] uppercase tracking-wider", MUTED)}>observed in this run</div>
            </div>
          </div>
        )}
        <p className={clsx("mt-3 text-[11px] leading-relaxed", MUTED)}>Rates marked &ldquo;assumed&rdquo; are modelling assumptions, not measured figures. They are there to be questioned and changed.</p>
      </div>
    </div>
  );
}
