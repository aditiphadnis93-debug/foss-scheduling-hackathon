"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/Card";
import { C } from "@/lib/theme";
import { pretty, toMin } from "@/lib/format";
import { CHECKLISTS } from "@/lib/insights";
import { useAsync } from "@/lib/data";
import type { Day, Listing, Run } from "@/lib/types";

type Conf = "asked" | "confirmed" | "not_confirmed";
type Row = { l: Listing; pet: Conf; acc: Conf; items: { item: string; ok: boolean; why?: string }[] };
export type ReadyChange = { case_id: string; what: string; why: string; field: "readiness" | "prerequisite"; item: string; value: string };

async function confirmations(): Promise<Set<string>> {
  try {
    const r = await fetch("/data/agents_100_combined.json");
    if (!r.ok) return new Set();
    const d = (await r.json()) as { journeys?: Record<string, { day: string; case_id: string; decision?: { confirmed_in_advance?: boolean; c?: number } }[]> };
    const s = new Set<string>();
    for (const list of Object.values(d.journeys ?? {})) for (const j of list) if (j.decision?.confirmed_in_advance || j.decision?.c === 1) s.add(`${j.day}|${j.case_id}`);
    return s;
  } catch {
    return new Set();
  }
}

function build(day: Day, conf: Set<string>): Row[] {
  const held = new Map(day.held_back.map((h) => [h.case_id, h.reason]));
  return [...day.listings]
    .sort((a, b) => toMin(a.start) - toMin(b.start) || b.score - a.score)
    .map((l) => {
      const confirmed = l.why.some((w) => /readiness confirmed|preparedness confirmed/i.test(w)) || conf.has(`${day.date}|${l.case_id}`);
      const reason = l.outcome?.kind === "not_ready" ? l.outcome.reason ?? "not ready" : held.get(l.case_id);
      const items = (CHECKLISTS[l.purpose] ?? []).map((item, i) => {
        const named = reason && reason.toLowerCase().includes(item.split(" ")[0].toLowerCase());
        const bad = l.outcome?.kind === "not_ready" ? i === 0 || named : !!named;
        return { item, ok: !bad, why: bad ? reason ?? undefined : undefined };
      });
      return { l, pet: confirmed ? "confirmed" : "asked", acc: "asked", items };
    });
}

function status(r: Row): { label: string; colour: string; kind: "ready" | "hold" | "risk" } {
  const miss = r.items.find((i) => !i.ok);
  if (miss) return { label: `Hold: ${miss.item}`, colour: C.danger, kind: "hold" };
  if (r.pet === "not_confirmed" || r.acc === "not_confirmed") return { label: "At risk: readiness not confirmed", colour: C.adjourned, kind: "risk" };
  return { label: "Ready to list", colour: C.substantive, kind: "ready" };
}

export default function Readiness({ run, dayIdx, onChange }: { run: Run; dayIdx: number; onChange: (c: ReadyChange) => void }) {
  const confRaw = useAsync(confirmations, []);
  const conf = useMemo(() => confRaw ?? new Set<string>(), [confRaw]);
  const [tomorrow, setTomorrow] = useState(false);
  const day = run.days[Math.min(run.days.length - 1, dayIdx + (tomorrow ? 1 : 0))];
  const key = `${day.date}|${conf.size}`;
  const base = useMemo(() => build(day, conf), [day, conf]);
  const [state, setState] = useState<{ key: string; rows: Row[] } | null>(null);
  const rows = state && state.key === key ? state.rows : base;
  const set = (i: number, r: Row) => setState({ key, rows: rows.map((x, k) => (k === i ? r : x)) });
  const counts = rows.reduce((a, r) => ({ ...a, [status(r).kind]: a[status(r).kind] + 1 }), { ready: 0, hold: 0, risk: 0 });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {[false, true].map((t) => (
            <button key={String(t)} onClick={() => setTomorrow(t)} className={clsx("rounded-md px-2.5 py-1 text-[12px]", tomorrow === t ? "bg-primary-subtle font-medium text-primary" : "text-muted")}>
              {t ? "Tomorrow's list" : "Today's list"}
            </button>
          ))}
        </div>
        <Badge colour={C.substantive}>{counts.ready} ready</Badge>
        <Badge colour={C.danger}>{counts.hold} hold</Badge>
        <Badge colour={C.adjourned}>{counts.risk} at risk</Badge>
      </div>
      <p className="text-[12px] text-muted">
        Staff tick items as the registry records them (summons served, papers filed). A matter with an unticked item is not listed and keeps no reserved slot; the scheduler reads these ticks when a court&apos;s system provides them.
      </p>
      <div className="scroll-thin max-h-[680px] overflow-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr>{["Case", "Purpose", "Complainant side", "Accused side", "Checklist", "Status"].map((h) => <th key={h} className="border-b border-line px-2 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const st = status(r);
              const confChip = (side: "pet" | "acc") => (
                <div className="inline-flex rounded-md border border-line p-0.5">
                  {(["asked", "confirmed", "not_confirmed"] as Conf[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        set(i, { ...r, [side]: c });
                        onChange({ case_id: r.l.case_id, what: `${side === "pet" ? "Complainant side" : "Accused side"} readiness: ${c.replace("_", " ")}`, why: "readiness check", field: "readiness", item: side, value: c });
                      }}
                      className={clsx("rounded px-1.5 py-0.5 text-[11px]", r[side] === c ? "bg-primary-subtle text-primary" : "text-faint")}
                    >
                      {c === "not_confirmed" ? "Not confirmed" : c.charAt(0).toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              );
              return (
                <tr key={r.l.case_id} className="border-b border-line align-top">
                  <td className="mono px-2 py-2">{r.l.case_id}</td>
                  <td className="px-2 py-2">{pretty(r.l.purpose)}</td>
                  <td className="px-2 py-2">{confChip("pet")}</td>
                  <td className="px-2 py-2">{confChip("acc")}</td>
                  <td className="px-2 py-2">
                    {r.items.length === 0 ? (
                      <span className="text-[12px] text-faint">no checklist for this hearing</span>
                    ) : (
                      r.items.map((it, j) => (
                        <label key={it.item} className="flex cursor-pointer items-start gap-1.5 text-[12px]">
                          <input
                            type="checkbox"
                            checked={it.ok}
                            onChange={(e) => {
                              const items = r.items.map((x, k) => (k === j ? { ...x, ok: e.target.checked, why: e.target.checked ? undefined : x.why } : x));
                              set(i, { ...r, items });
                              onChange({ case_id: r.l.case_id, what: `${e.target.checked ? "Ticked" : "Unticked"}: ${it.item}`, why: "registry record", field: "prerequisite", item: it.item, value: e.target.checked ? "done" : "pending" });
                            }}
                            className="mt-0.5 accent-[var(--primary)]"
                          />
                          <span className={it.ok ? "text-text" : "text-danger"}>
                            {it.ok ? <Check size={11} className="mr-0.5 inline text-green-strong" /> : <X size={11} className="mr-0.5 inline" />}
                            {it.item}
                            {it.why && <span className="block text-[11px] text-muted">{it.why}</span>}
                          </span>
                        </label>
                      ))
                    )}
                  </td>
                  <td className="px-2 py-2"><Badge colour={st.colour}>{st.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
