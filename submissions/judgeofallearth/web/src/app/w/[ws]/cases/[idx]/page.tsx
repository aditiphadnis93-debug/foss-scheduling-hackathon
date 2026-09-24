"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDay, num, pct } from "@/lib/api";
import { useRole } from "@/components/role";
import { AgeTag, Card, Empty, Tag, Td, Th } from "@/components/ui";

type CaseView = {
  case_id: string; advocate: string; filing_date: string; as_of: string; disposed: boolean;
  chain: {
    age_years: number; age_bucket: string; old: boolean; stage: string; purpose: string; side_purpose: boolean; expected_minutes: number | null;
    can_happen: boolean | null; can_happen_note: string | null; p_substantive_type: number | null; p_substantive_case: number | null;
    p_move_on: number | null; published_gap_days: number | null; next_listing: string | null; next_reason: string | null;
  };
  history: { hearings_so_far: number; hearings_by_type: Record<string, number>; last_hearing_summary: string | null; adjournment_heavy: boolean };
  timeline: { day: string; ord: number; purpose_label: string; why: string; reached: boolean | null; substantive: boolean | null; advanced_to: string | null; reason: string | null; next_gap: number | null; status: string }[];
};

export default function CasePage() {
  const { ws, idx } = useParams<{ ws: string; idx: string }>();
  const { role } = useRole();
  const [c, setC] = useState<CaseView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<CaseView>(`/workspaces/${ws}/cases/${idx}`, role).then(setC).catch((e) => setErr(e.message));
  }, [ws, idx, role]);
  if (!c) return <Empty>{err ?? "Loading…"}</Empty>;
  const k = c.chain;
  const maxType = Math.max(1, ...Object.values(c.history.hearings_by_type));

  const steps: { label: string; value: React.ReactNode; note?: string }[] = [
    { label: "How old?", value: <AgeTag age={k.age_years} />, note: `filed ${fmtDay(c.filing_date)} · bucket ${k.age_bucket}` },
    { label: "Where in its life?", value: k.stage, note: "stage of 11" },
    { label: "What hearing next?", value: k.purpose, note: k.side_purpose ? "side matter; returns to its stage" : undefined },
    { label: "How long?", value: k.expected_minutes ? `${k.expected_minutes} min` : "—", note: "if it goes ahead; ~2 min if adjourned" },
    { label: "Can it happen?", value: k.can_happen == null ? "—" : k.can_happen ? "Yes" : "Not yet", note: k.can_happen_note ?? "no summons/warrant outstanding" },
    { label: "Likely useful?", value: pct(k.p_substantive_case), note: `typical for this hearing: ${pct(k.p_substantive_type)} · adjusted for this case's history` },
    { label: "Moves on if useful?", value: pct(k.p_move_on), note: "some stages need several useful hearings" },
    { label: "When back?", value: k.next_listing ? fmtDay(k.next_listing) : c.disposed ? "Disposed" : "By priority", note: k.next_reason ?? undefined },
  ];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{c.case_id}</h2>
        <span className="text-sm text-mut">{c.advocate}</span>
        {c.disposed && <Tag tone="acc">Disposed</Tag>}
        {k.old && <Tag tone="warn">4+ yr old case</Tag>}
        {c.history.adjournment_heavy && <Tag tone="bad">Adjournment-heavy history</Tag>}
      </div>

      <Card title="The case, step by step" sub={`As of ${fmtDay(c.as_of)}. Each step is what the planner knows before the day; it never sees the simulated court's hidden outcomes.`}>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.label} className="rounded-xl bg-soft/70 p-3.5">
              <div className="text-[12px] text-mut">
                {i + 1}. {s.label}
              </div>
              <div className="mt-0.5 text-[17px] font-semibold">{s.value}</div>
              {s.note && <div className="mt-1 text-[12px] text-mut">{s.note}</div>}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`History before this posting: ${num(c.history.hearings_so_far)} hearings`} sub="Hearings of each type, from the roster.">
          <div className="grid gap-1">
            {Object.entries(c.history.hearings_by_type).map(([t, n]) => (
              <div key={t} className="grid grid-cols-[170px_1fr_28px] items-center gap-2 text-sm">
                <span className="truncate text-mut">{t}</span>
                <span className="h-1.5 rounded-full bg-acc/40" style={{ width: `${(n / maxType) * 100}%` }} />
                <span className="text-right tabular-nums">{n}</span>
              </div>
            ))}
          </div>
          {c.history.last_hearing_summary && (
            <div className="mt-4 rounded-xl bg-soft/70 p-3.5 text-[13px] whitespace-pre-line">
              <div className="mb-1 text-[12px] uppercase tracking-wide text-mut">Last hearing (roster)</div>
              {c.history.last_hearing_summary}
            </div>
          )}
        </Card>

        <Card title="This posting" sub="Every listing so far and what happened.">
          {c.timeline.length === 0 ? (
            <Empty>Not listed yet in this posting.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr><Th>Day</Th><Th>Hearing</Th><Th>Why</Th><Th>Outcome</Th></tr>
              </thead>
              <tbody>
                {c.timeline.map((r, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{fmtDay(r.day)}</Td>
                    <Td>{r.purpose_label}</Td>
                    <Td className="text-mut">{r.why}</Td>
                    <Td>
                      {r.status !== "played" ? (
                        <Tag tone="blue">{r.status}</Tag>
                      ) : r.reached === false ? (
                        <Tag tone="bad">not reached</Tag>
                      ) : r.advanced_to ? (
                        <Tag tone="acc">{r.advanced_to === "DISPOSED" ? "disposed" : "moved on"}</Tag>
                      ) : r.substantive ? (
                        <Tag tone="acc">useful</Tag>
                      ) : (
                        <Tag tone="warn">{r.reason}</Tag>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
