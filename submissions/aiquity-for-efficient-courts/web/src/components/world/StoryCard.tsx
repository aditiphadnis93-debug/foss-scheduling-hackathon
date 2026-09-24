"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { caseHref } from "@/lib/world-case";
import { Gavel, Scale, X, FileText, MessageSquareWarning, Handshake, Mail, Hourglass, Landmark } from "lucide-react";
import clsx from "clsx";
import {
  OUTCOME_COLOR, OUTCOME_LABEL, STEP_LABEL, fmtDate, fmtMoney, isHearingType, isResolvedType, pretty,
  type World,
} from "@/lib/world";
import { Panel } from "./ui";

const KIND_LABEL: Record<string, string> = {
  lender_borrower: "Loan repaid by a bounced cheque", supplier_shop: "Supplier dues, cheque bounced",
  employer_worker: "Unpaid wages", landlord_tenant: "Rent arrears", docket: "Case already on the docket",
  cheque_bounce: "Cheque bounced", unpaid_loan: "Unpaid loan", rent_arrears: "Rent arrears", wage_dues: "Unpaid wages",
  supplier_dues: "Supplier dues",
};

function stepIcon(type: string) {
  if (type === "quarrel") return MessageSquareWarning;
  if (type === "legal_notice" || type === "notice") return Mail;
  if (type === "negotiation") return Handshake;
  if (type === "notice_expired") return Hourglass;
  if (type === "complaint_filed" || type === "filed" || type === "adopted") return FileText;
  if (type === "judgement" || type === "judgment") return Gavel;
  if (isResolvedType(type)) return Handshake;
  if (isHearingType(type)) return Scale;
  return Landmark;
}

export function StoryCard({ world, disputeIdx, personIdx, day, onClose, onJump, compact, personSlot }: {
  world: World; disputeIdx: number; personIdx: number; day: number; onClose: () => void; onJump: (dayIdx: number) => void; compact?: boolean; personSlot?: React.ReactNode;
}) {
  const d = world.disputes[disputeIdx];
  const person = personIdx >= 0 ? world.people[personIdx] : null;
  if (!d) {
    if (!person) return null;
    return (
      <Panel className="max-h-full w-full overflow-y-auto">
        <div className="sticky top-0 z-10 flex justify-end bg-[var(--surface)] px-3 pt-3">
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--text-muted,var(--muted,#65758B))] hover:bg-[var(--surface-2)]" aria-label="Close"><X size={16} /></button>
        </div>
        {personSlot}
        <p className="px-5 pb-5 text-sm text-[var(--text-muted,var(--muted,#65758B))]">No dispute in this window.</p>
      </Panel>
    );
  }
  const a = world.people[d.a], b = world.people[d.b];
  const adv = d.advocates.map((k) => world.advocates[k]?.name).filter(Boolean);
  const steps = d.steps;
  return (
    <Panel className="max-h-full w-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">{d.kindLabel ?? KIND_LABEL[d.kind] ?? pretty(d.kind)}</div>
            <div className="mt-1.5 text-lg font-semibold leading-tight text-[var(--text)]">
              {a?.name} <span className="font-normal text-[var(--text-muted,var(--muted,#65758B))]">v.</span> {b?.name}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted,var(--muted,#65758B))]">
              {a?.occupation}, {a?.neighbourhood} · {b?.occupation}, {b?.neighbourhood}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--text-muted,var(--muted,#65758B))] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" aria-label="Close story"><X size={16} /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {d.amount != null && <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono text-[var(--text)]">{fmtMoney(d.amount)}</span>}
          {d.caseId && <Link href={caseHref(d.caseId)} className="rounded-md bg-[var(--primary-subtle,#F0F6FF)] px-2 py-1 font-mono text-[var(--primary-strong,#1E3B8A)] hover:underline">{d.caseId} · case file</Link>}
          {adv.map((n) => <span key={n} className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]">{n}</span>)}
          <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[var(--text-muted,var(--muted,#65758B))]">{pretty(d.finalState)}</span>
        </div>
        {!compact && d.story && <p className="mt-3 text-[13px] leading-relaxed text-[var(--text)]">{d.story}</p>}
      </div>
      {personSlot}
      <ol className="relative px-5 py-4">
        <div className="absolute bottom-6 left-[31px] top-6 w-px bg-[var(--border,var(--line,#E1E7EF))]" aria-hidden />
        {steps.map((s, i) => {
          const Icon = stepIcon(s.type);
          const past = s.dayIdx <= day;
          const now = s.dayIdx === day;
          const color = s.outcome ? OUTCOME_COLOR[s.outcome] : isResolvedType(s.type) ? "var(--c-substantive,#10B77F)" : s.type === "quarrel" ? "var(--c-adjourned,#F59F0A)" : s.type.includes("filed") ? "var(--primary,#2463EB)" : "var(--text-muted,var(--muted,#65758B))";
          return (
            <motion.li
              key={`${s.day}-${i}`}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: past ? 1 : 0.42, x: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.03 }}
              className="relative mb-3 flex gap-3"
            >
              <button
                onClick={() => s.dayIdx >= 0 && s.dayIdx < world.days.length && onJump(s.dayIdx)}
                className={clsx("relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", now && "ring-2 ring-[var(--primary,#2463EB)]/70")}
                style={{ borderColor: color, background: past ? `color-mix(in srgb, ${color} 14%, var(--bg,var(--surface)))` : "var(--bg,var(--surface))", color }}
                title={s.dayIdx >= 0 ? "Jump to this day" : "Before the window"}
              >
                <Icon size={12} />
              </button>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium text-[var(--text)]">
                    {isHearingType(s.type) && s.outcome ? OUTCOME_LABEL[s.outcome] : STEP_LABEL[s.type] ?? pretty(s.type)}
                  </span>
                  <span className="font-mono text-[10.5px] text-[var(--text-muted,var(--muted,#65758B))]">{fmtDate(s.day, { day: "numeric", month: "short", year: s.dayIdx < 0 ? "numeric" : undefined })}</span>
                </div>
                <div className="text-[12px] leading-snug text-[var(--text-muted,var(--muted,#65758B))]">{s.text}{s.reason && !s.text.includes(s.reason) ? ` (${s.reason})` : ""}</div>
              </div>
            </motion.li>
          );
        })}
        {!steps.length && <li className="text-sm text-[var(--text-muted,var(--muted,#65758B))]">No recorded steps.</li>}
      </ol>
    </Panel>
  );
}
