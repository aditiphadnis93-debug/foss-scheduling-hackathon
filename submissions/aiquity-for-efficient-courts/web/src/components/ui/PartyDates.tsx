"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { dateLabel } from "@/lib/format";

export type SidePrefs = { prefer: string[]; avoid: string[] };
export type Preferences = { petitioner: SidePrefs; respondent: SidePrefs };
export const emptyPrefs = (): Preferences => ({ petitioner: { prefer: [], avoid: [] }, respondent: { prefer: [], avoid: [] } });

/** Client-side mirror of the engine rule: avoid 'cannot come' days; a preferred day wins if close enough. */
export function applyPrefs(ruleDate: string, sittings: string[], p: Preferences, oldCase: boolean): { date: string; note: string } {
  const avoid = new Set([...p.petitioner.avoid, ...p.respondent.avoid]);
  const limit = oldCase ? 7 : 14;
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const prefer = [...p.petitioner.prefer, ...p.respondent.prefer].filter((d) => !avoid.has(d) && d >= ruleDate && days(ruleDate, d) <= limit).sort();
  if (prefer.length) return { date: prefer[0], note: `a date the parties asked for, within ${limit} days of the rule's date` };
  const next = sittings.filter((d) => d >= ruleDate && !avoid.has(d))[0];
  const askedLater = [...p.petitioner.prefer, ...p.respondent.prefer].some((d) => d > ruleDate && days(ruleDate, d) > limit);
  if (next && next !== ruleDate) return { date: next, note: "the first sitting day after the rule's date that no side has said they cannot come" };
  return { date: next ?? ruleDate, note: askedLater ? "the case cannot wait longer: the rule's date stands" : "no request changes the rule's date" };
}

function Side({ title, v, onChange }: { title: string; v: SidePrefs; onChange: (v: SidePrefs) => void }) {
  const [d, setD] = useState("");
  const chip = (list: "prefer" | "avoid", x: string) => (
    <span key={list + x} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={list === "prefer" ? { background: "var(--green-subtle)", color: "var(--green-strong)" } : { background: "color-mix(in srgb, var(--c-danger) 12%, transparent)", color: "var(--c-danger)" }}>
      {list === "prefer" ? "prefers" : "cannot come"} {dateLabel(x, true)}
      <button onClick={() => onChange({ ...v, [list]: v[list].filter((y) => y !== x) })} aria-label="Remove"><X size={11} /></button>
    </span>
  );
  return (
    <div className="rounded-lg border border-line p-2.5">
      <p className="text-[12px] font-medium text-text">{title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} className="num rounded-md border border-line bg-bg px-1.5 py-0.5 text-[12px]" aria-label={`${title} date`} />
        <button disabled={!d} onClick={() => { onChange({ ...v, prefer: [...new Set([...v.prefer, d])] }); setD(""); }} className="rounded-md px-1.5 py-0.5 text-[11px] text-green-strong ring-1 ring-line disabled:opacity-40">prefers</button>
        <button disabled={!d} onClick={() => { onChange({ ...v, avoid: [...new Set([...v.avoid, d])] }); setD(""); }} className="rounded-md px-1.5 py-0.5 text-[11px] text-danger ring-1 ring-line disabled:opacity-40">cannot come</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">{v.prefer.map((x) => chip("prefer", x))}{v.avoid.map((x) => chip("avoid", x))}</div>
    </div>
  );
}

export default function PartyDates({ value, onChange }: { value: Preferences; onChange: (p: Preferences) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] uppercase tracking-[0.1em] text-muted">The parties ask for a date</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Side title="Complainant side" v={value.petitioner} onChange={(x) => onChange({ ...value, petitioner: x })} />
        <Side title="Accused side" v={value.respondent} onChange={(x) => onChange({ ...value, respondent: x })} />
      </div>
    </div>
  );
}
