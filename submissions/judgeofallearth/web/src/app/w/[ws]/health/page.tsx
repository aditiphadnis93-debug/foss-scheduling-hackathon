"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, fmtDay, num, pct } from "@/lib/api";
import { useRole } from "@/components/role";
import { AgeTag, Card, CaseLink, Empty, Kpi, Tag, Td, Th } from "@/components/ui";

type Health = {
  as_of: string; days_played: number; days_total: number;
  buckets_over_time: Record<string, number | string>[];
  daily: Record<string, number | string>[];
  totals: Record<string, number | null>;
  at_risk: { case_idx: number; case_id: string; age_years: number; crosses_into: string; days_to_cross: number; stage: string; purpose: string; ready: boolean; next_listing: string | null }[];
  repeated_adjournments: { case_idx: number; case_id: string; stage: string; streak_this_posting: number; historically_heavy: boolean; last_reason: string | null; age_years: number }[];
  stage_pileup: { stage: string; pending: number }[];
};

const C = { acc: "var(--acc)", warn: "var(--warn)", bad: "var(--bad)", blue: "var(--blue)", mut: "var(--mut)", line: "var(--line)" };
const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function HealthPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Health>(`/workspaces/${ws}/health`, role).then(setH).catch((e) => setErr(e.message));
  }, [ws, role]);
  if (!h) return <Empty>{err ?? "Loading…"}</Empty>;

  const t = h.totals;
  const buckets = h.buckets_over_time.map((b) => {
    const g = (k: string) => Number(b[k] ?? 0);
    return { day: short(String(b.day)), "3+ yrs": g("3-4") + g("4-5") + g("5+"), "4+ yrs": g("4-5") + g("5+"), "5+ yrs": g("5+") };
  });
  const first = buckets[0], lastB = buckets[buckets.length - 1];
  const delta = (k: "3+ yrs" | "4+ yrs" | "5+ yrs") => (first && lastB ? lastB[k] - first[k] : 0);
  const daily = h.daily.map((d) => ({
    day: short(String(d.day)),
    utilisation: Number(d.utilisation) * 100,
    useful: (Number(d.substantive) / Math.max(1, Number(d.reached))) * 100,
    listed: Number(d.listed),
  }));

  return (
    <div className="grid gap-6">
      <p className="text-sm text-mut">
        As of {fmtDay(h.as_of)} · {h.days_played} of {h.days_total} sitting days played.{" "}
        {h.days_played === 0 && "Run a few days on the Today tab to see trends."}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Of the day used on hearings" value={pct(t.utilisation)} />
        <Kpi label="Of heard hearings were useful" value={pct(t.substantiveness)} />
        <Kpi label="4+ yr cases heard so far" value={pct(t.old_heard)} hint={`${pct(t.old_advanced)} moved forward a stage`} />
        <Kpi label="Disposed this posting" value={num(t.disposals)} hint={`${num(t.stage_advances)} stage advances · ${num(t.appearances_per_advance, 2)} appearances each`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Old backlog over time" sub="Pending cases aged 3+, 4+ and 5+ years. Cases keep ageing, so a flat line means the court is keeping up.">
          <div className="mb-2 flex gap-3 text-[13px]">
            {(["3+ yrs", "4+ yrs", "5+ yrs"] as const).map((k) => (
              <span key={k}>
                {k}: <b>{num(lastB?.[k])}</b>{" "}
                <span className={delta(k) > 0 ? "text-bad" : "text-acc"}>
                  ({delta(k) > 0 ? "+" : ""}
                  {delta(k)})
                </span>
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={buckets}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.mut }} />
              <YAxis tick={{ fontSize: 11, fill: C.mut }} width={40} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} dataKey="3+ yrs" stroke={C.blue} dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} dataKey="4+ yrs" stroke={C.warn} dot={false} strokeWidth={2} />
              <Line isAnimationActive={false} dataKey="5+ yrs" stroke={C.bad} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Is the docket drifting?" sub="Daily share of the day used and share of heard hearings that were useful. Dips flag days to look at.">
          {daily.length === 0 ? (
            <Empty>No days played yet.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={255}>
              <LineChart data={daily}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: C.mut }} />
                <YAxis tick={{ fontSize: 11, fill: C.mut }} width={40} unit="%" domain={[0, 100]} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(0)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} dataKey="utilisation" name="Day used" stroke={C.acc} dot={false} strokeWidth={2} />
                <Line isAnimationActive={false} dataKey="useful" name="Useful hearings" stroke={C.blue} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Where cases are piling up" sub="Pending cases by stage. A tall bar at Appearance/Warrant means summons and warrants are the bottleneck, not hearing time.">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={h.stage_pileup}>
            <CartesianGrid stroke={C.line} vertical={false} />
            <XAxis dataKey="stage" tick={{ fontSize: 10.5, fill: C.mut }} interval={0} angle={-18} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11, fill: C.mut }} width={40} />
            <Tooltip />
            <Bar isAnimationActive={false} dataKey="pending" fill={C.acc} fillOpacity={0.55} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`At risk of ageing (${h.at_risk.length})`} sub="Will cross into 3+, 4+ or 5+ years within 30 days, with no hearing planned before then.">
          {h.at_risk.length === 0 ? (
            <Empty>No cases about to age without a hearing.</Empty>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr><Th>Case</Th><Th>Age</Th><Th>Crosses in</Th><Th>Needs</Th><Th>Ready?</Th></tr>
                </thead>
                <tbody>
                  {h.at_risk.map((r) => (
                    <tr key={r.case_idx}>
                      <Td><CaseLink ws={ws} idx={r.case_idx} id={r.case_id} /></Td>
                      <Td><AgeTag age={r.age_years} /></Td>
                      <Td className="whitespace-nowrap">{r.days_to_cross} d → {r.crosses_into}</Td>
                      <Td className="text-mut">{r.purpose}</Td>
                      <Td>{r.ready ? <Tag tone="acc">ready</Tag> : <Tag tone="warn">process out</Tag>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Repeated adjournments (${h.repeated_adjournments.length})`} sub="3+ non-useful hearings in a row this posting, or far more hearings than typical for the stage before the posting began.">
          {h.repeated_adjournments.length === 0 ? (
            <Empty>No stuck cases detected.</Empty>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr><Th>Case</Th><Th>Stage</Th><Th>In a row</Th><Th>Last reason</Th></tr>
                </thead>
                <tbody>
                  {h.repeated_adjournments.map((r) => (
                    <tr key={r.case_idx}>
                      <Td>
                        <CaseLink ws={ws} idx={r.case_idx} id={r.case_id} /> {r.historically_heavy && <Tag tone="warn">history</Tag>}
                      </Td>
                      <Td className="text-mut">{r.stage}</Td>
                      <Td className="tabular-nums">{r.streak_this_posting || "—"}</Td>
                      <Td className="text-mut">{r.last_reason ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
