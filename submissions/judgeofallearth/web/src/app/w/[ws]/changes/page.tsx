"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtDay } from "@/lib/api";
import { useRole } from "@/components/role";
import { Card, Empty, Note, Tag } from "@/components/ui";

type Review = { days: number; until: string; expected: Record<string, number>; actual: Record<string, number>; affected: Record<string, number> };
type Change = {
  id: number; ts: string; role: string; day: string; label: string; reason: string; option: Record<string, unknown>;
  forecast_at_time: { weeks: number; delta: Record<string, number>; affected: Record<string, number> | null };
  sitting_days_since: number; review: Review | null;
};

const M: [string, string, boolean, "pct" | "num" | "days"][] = [
  ["substantive_per_day", "Useful hearings / day", true, "num"],
  ["utilisation", "Share of day used", true, "pct"],
  ["carried_over", "Not reached (total)", false, "num"],
  ["days_late", "Days late vs promise", false, "days"],
  ["backlog_4+_end", "4+ yr cases pending", false, "num"],
  ["backlog_5+_end", "5+ yr cases pending", false, "num"],
  ["stage_advances", "Steps forward", true, "num"],
];
const f = (v: number | undefined, k: string) => (v == null ? "—" : k === "pct" ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts` : `${v > 0 ? "+" : ""}${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)}`);

function what(c: Change): string[] {
  const o = c.option as { params?: Record<string, number>; remove?: number[]; add?: number[]; extra?: number; move?: Record<string, string>; leave?: string[]; preset?: string };
  const out: string[] = [];
  if (o.params && Object.keys(o.params).length) out.push(`rules: ${Object.entries(o.params).map(([k, v]) => `${k} → ${v}`).join(", ")}`);
  if (o.remove?.length) out.push(`removed ${o.remove.length} from the day`);
  if (o.add?.length) out.push(`added ${o.add.length}`);
  if (o.extra) out.push(`overbooked by ${o.extra}`);
  if (o.move && Object.keys(o.move).length) out.push(`moved ${Object.keys(o.move).length} to a later day`);
  if (o.leave?.length) out.push(`leave on ${o.leave.map(fmtDay).join(", ")}`);
  return out;
}

export default function ChangesPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const [list, setList] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Change[]>(`/workspaces/${ws}/changes`, role).then(setList).catch((e) => setErr(e.message));
  }, [ws, role]);
  if (!list) return <Empty>{err ?? "Loading the change journal…"}</Empty>;

  return (
    <div className="grid gap-6">
      <p className="max-w-3xl text-mut">
        Every change the Judge made to the plan or the rules: <b className="font-medium text-fg">what</b>, <b className="font-medium text-fg">why</b>, what it was{" "}
        <b className="font-medium text-fg">expected</b> to do, and, once some days have passed, what it <b className="font-medium text-fg">actually did</b>.
      </p>
      {list.length === 0 && <Card><Empty>No changes yet. Changes are made from Today, Plan, or Rules &amp; options, and each needs a reason.</Empty></Card>}
      {list.map((c) => {
        const r = c.review;
        const data = r
          ? M.filter(([k]) => r.expected[k] != null).map(([k, label, , kind]) => ({
              label,
              Expected: kind === "pct" ? r.expected[k] * 100 : r.expected[k],
              Actual: kind === "pct" ? r.actual[k] * 100 : r.actual[k],
            }))
          : [];
        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] font-semibold">{c.label}</h3>
                  <Tag>{fmtDay(c.day)}</Tag>
                  <Tag tone="blue">{c.role}</Tag>
                </div>
                <div className="mt-1 text-[13px] text-mut">{what(c).join(" · ")}</div>
              </div>
              <Tag tone={r ? "acc" : "mut"}>{r ? `reviewed after ${r.days} sitting days` : "not reviewable yet: run a day"}</Tag>
            </div>
            <div className="mt-3 rounded-xl bg-soft/70 px-4 py-3 text-[14px]">
              <span className="text-mut">Why: </span>
              {c.reason}
            </div>
            {r ? (
              <div className="mt-4 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
                <div>
                  <div className="mb-1 text-[13px] text-mut">Expected vs actual effect over the {r.days} sitting days since (change − no change)</div>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
                      <CartesianGrid stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--mut)" }} />
                      <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11.5, fill: "var(--mut)" }} />
                      <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine x={0} stroke="var(--mut)" />
                      <Bar dataKey="Expected" fill="var(--blue)" fillOpacity={0.35} isAnimationActive={false} radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Actual" fill="var(--acc)" fillOpacity={0.7} isAnimationActive={false} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-[12px] text-mut"><th className="py-1 text-left font-medium">Measure</th><th className="py-1 text-right font-medium">Expected</th><th className="py-1 text-right font-medium">Actual</th></tr>
                    </thead>
                    <tbody>
                      {M.map(([k, label, better, kind]) => {
                        const a = r.actual[k];
                        const good = a != null && Math.abs(a) > 1e-9 ? (a > 0) === better : null;
                        return (
                          <tr key={k} className="border-t border-line/60">
                            <td className="py-1.5">{label}</td>
                            <td className="py-1.5 text-right tabular-nums text-mut">{f(r.expected[k], kind)}</td>
                            <td className={`py-1.5 text-right tabular-nums ${good == null ? "text-mut" : good ? "text-acc" : "text-bad"}`}>{f(a, kind)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <Note>
                    Cases affected so far: {r.affected.earlier} heard earlier, {r.affected.later} later, {r.affected["newly heard"]} newly heard, {r.affected["no longer heard"]} not heard.
                  </Note>
                  <Note>
                    <b>Expected</b> = the forecast for this period, from what was known at the time. <b>Actual</b> = the same simulated court replayed with and without the change.
                    This hindsight is only possible in simulation; later changes aren&apos;t replayed.
                  </Note>
                </div>
              </div>
            ) : (
              c.forecast_at_time?.delta && (
                <div className="mt-3 text-[13px] text-mut">
                  Expected over the next {c.forecast_at_time.weeks} weeks: {M.map(([k, label, , kind]) => `${label} ${f(c.forecast_at_time.delta[k], kind)}`).join(" · ")}
                </div>
              )
            )}
          </Card>
        );
      })}
    </div>
  );
}
