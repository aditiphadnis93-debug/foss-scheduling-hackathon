"use client";

/** The key: every colour and mark on the town and what it means. Collapsible; the choice is remembered. */
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { OUTCOME_COLOR, OUTCOME_LABEL, PEOPLE_COLOR, STATE_COLOR, STATE_LABEL, type OutcomeKind } from "@/lib/world";

const STATE_HINT = ["no open dispute", "quarrel or notice, not in court yet", "has a case in court", "settled or decided"];
const OUTCOME_HINT: Record<OutcomeKind, string> = {
  substantive: "the hearing moved the case to its next stage",
  adjourned: "called, but put off to another date",
  not_reached: "the day ran out before it was called",
  not_ready: "papers or summons not ready",
};

type Shape = "dot" | "cone" | "dome" | "house" | "shop" | "ring" | "line" | "dash" | "arc" | "glow" | "band" | "walk";

function Mark({ shape, color }: { shape: Shape; color: string }) {
  const box = "inline-flex h-3.5 w-4 shrink-0 items-center justify-center";
  switch (shape) {
    case "cone": return <span className={box}><span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent" style={{ borderBottomColor: color }} /></span>;
    case "dome": return <span className={box}><span className="h-2.5 w-3.5 rounded-t-full" style={{ background: color }} /></span>;
    case "house": return <span className={box}><span className="relative h-2.5 w-3 border border-[var(--text-muted,#65758B)] bg-[var(--bg,#fff)]"><span className="absolute -top-[5px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[5px] border-x-transparent border-b-[var(--text-muted,#65758B)]" /></span></span>;
    case "shop": return <span className={box}><span className="h-3 w-3 border border-[var(--text-muted,#65758B)] bg-[var(--bg,#fff)] shadow-[inset_0_-3px_0_var(--primary,#2463EB)]" /></span>;
    case "ring": return <span className={box}><span className="h-3 w-3 rounded-full border-2" style={{ borderColor: color }} /></span>;
    case "line": return <span className={box}><span className="h-[3px] w-4 rounded" style={{ background: color }} /></span>;
    case "dash": return <span className={box}><span className="h-px w-4" style={{ background: color, opacity: 0.6 }} /></span>;
    case "arc": return <span className={box}><span className="h-2.5 w-4 rounded-t-full border-2 border-b-0" style={{ borderColor: color }} /></span>;
    case "glow": return <span className={box}><span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 30%, transparent)` }} /></span>;
    case "band": return <span className={box}><span className="h-3 w-4 rounded-sm" style={{ background: `color-mix(in srgb, ${color} 25%, transparent)` }} /></span>;
    case "walk": return <span className={box}><span className="h-3 w-1.5 rounded-full" style={{ background: color }} /><span className="ml-0.5 text-[8px] leading-none" style={{ color }}>›</span></span>;
    default: return <span className={box}><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /></span>;
  }
}

const MARKS: { shape: Shape; color: string; label: string; hint: string }[] = [
  { shape: "walk", color: PEOPLE_COLOR.court, label: "Walking figure", hint: "a party on the way to court or home on a hearing day" },
  { shape: "cone", color: "var(--text,#111827)", label: "Advocate", hint: "walks from chambers to court for their matters" },
  { shape: "dome", color: "var(--primary,#2463EB)", label: "Court", hint: "the court complex; the dome brightens while it sits" },
  { shape: "house", color: "", label: "House", hint: "one household; its people stand in the yard" },
  { shape: "shop", color: "", label: "Shop or business", hint: "taller building with a coloured awning" },
  { shape: "ring", color: "var(--border,#E1E7EF)", label: "Neighbourhood", hint: "the circle around each quarter of the town" },
  { shape: "line", color: "var(--border,#CBD5E1)", label: "Road", hint: "roads from the court to each neighbourhood" },
  { shape: "dash", color: "var(--text-faint,#9CA3B0)", label: "Faint line", hint: "who owes whom in the town" },
  { shape: "arc", color: PEOPLE_COLOR.dispute, label: "Dispute arc", hint: "an open dispute between two people; pulsing = a new quarrel today; indigo = now in court" },
  { shape: "glow", color: "var(--primary-hover,#3C83F6)", label: "Filing light", hint: "a complaint travelling from home to the court" },
  { shape: "ring", color: "var(--c-substantive,#10B77F)", label: "Outcome ring", hint: "spreads from the court when hearings end, in the outcome colour" },
  { shape: "band", color: "var(--c-adjourned,#F59F0A)", label: "Strike day", hint: "shaded day: a town event kept people from court" },
];

function readOpen(key: string, fallback: boolean) {
  // on a phone the key starts closed so it never sits over the town
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  try { const v = localStorage.getItem(key); return v == null ? fallback && !narrow : v === "1"; } catch { return fallback && !narrow; }
}

export default function ColorLegend({ row, className, storageKey = "world.key.open", defaultOpen = true, maxHeight }: {
  row?: boolean; className?: string; storageKey?: string; defaultOpen?: boolean; maxHeight?: string;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const toggle = () => setOpen((v) => { try { localStorage.setItem(storageKey, v ? "0" : "1"); } catch { /* per-viewer only */ } return !v; });
  const head = (t: string) => <div className={clsx("text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted,var(--muted,#65758B))]", row ? "font-semibold" : "pt-1.5")}>{t}</div>;
  const item = (key: string, mark: React.ReactNode, label: string, hint: string) => (
    <div key={key} className={clsx("flex gap-2 py-0.5", row ? "items-center" : "items-start")} title={hint}>
      <span className="mt-[1px]">{mark}</span>
      <span className="text-[var(--text)]">{label}</span>
      {!row && <span className="text-[var(--text-muted,var(--muted,#65758B))]">{hint}</span>}
    </div>
  );
  return (
    <div className={clsx("pointer-events-auto flex flex-col items-start gap-1.5", className)}>
      <button type="button" onClick={toggle} aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)]">
        {open ? <EyeOff size={14} /> : <Eye size={14} />} Key
      </button>
      {open && (
        <div className="w-full overflow-y-auto rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)] px-3.5 py-2.5 text-[11px] shadow-[0_1px_2px_rgba(17,24,39,.06),0_8px_24px_rgba(17,24,39,.06)]"
          style={{ maxHeight }}>
          <div className={clsx(row ? "flex flex-wrap items-center gap-x-4" : "space-y-0.5")}>
            {head("People")}
            {STATE_LABEL.map((l, i) => item(`s${i}`, <Mark shape="dot" color={STATE_COLOR[i]} />, l, STATE_HINT[i]))}
            {head(row ? "· Hearing outcomes" : "Hearing outcomes")}
            {(Object.keys(OUTCOME_COLOR) as OutcomeKind[]).map((k) => item(k, <Mark shape="ring" color={OUTCOME_COLOR[k]} />, OUTCOME_LABEL[k], OUTCOME_HINT[k]))}
            {head(row ? "· On the map" : "On the map")}
            {MARKS.map((m) => item(m.label, <Mark shape={m.shape} color={m.color} />, m.label, m.hint))}
          </div>
        </div>
      )}
    </div>
  );
}
