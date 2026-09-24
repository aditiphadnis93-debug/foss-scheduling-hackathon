"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useRole } from "@/components/role";
import { Card, Empty, Tag } from "@/components/ui";

type Val = { mean: number; ci: number };
type Step = { key: string; title: string; why: string; planner: string; values: Record<string, Val>; delta: Record<string, Val> | null };
type Metric = { key: string; label: string; higher_is_better: boolean; kind: "pct" | "num" };
type Story = { seeds: number; cases: number; metrics: Metric[]; steps: Step[] };

const fmt = (m: Metric, v: number) => (m.kind === "pct" ? `${(v * 100).toFixed(1)}%` : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
const fmtD = (m: Metric, v: number) => (m.kind === "pct" ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts` : `${v > 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}`);
const KEY = ["utilisation", "substantive_per_day", "old_heard", "predictability_days", "appearances_per_advance", "wasted_on_pending_process"];

export default function StoryPage() {
  const { role } = useRole();
  const [s, setS] = useState<Story | null>(null);
  const [metric, setMetric] = useState("old_heard");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Story>("/story", role).then(setS).catch((e) => setErr(e.message));
  }, [role]);
  if (!s) return <Empty>{err ?? "Loading the model story… (first time it's computed: ~15 s)"}</Empty>;

  const m = s.metrics.find((x) => x.key === metric)!;
  const data = s.steps.map((st, i) => {
    const d = st.delta?.[metric];
    const good = d ? (d.mean > 0) === m.higher_is_better : null;
    const tiny = d ? Math.abs(d.mean) <= Math.max(d.ci, m.kind === "pct" ? 0.002 : 0.01) : true;
    return { name: `${i}. ${st.title}`, short: `${i}`, value: st.values[metric].mean, label: fmt(m, st.values[metric].mean), tone: i === 0 ? "base" : tiny ? "flat" : good ? "good" : "bad" };
  });
  const color = { base: "var(--mut)", flat: "var(--line)", good: "var(--acc)", bad: "var(--bad)" } as const;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">How the planner was built</h1>
        <p className="max-w-3xl text-mut">
          We started from current practice and switched on one rule at a time. Each step says <b className="font-medium text-fg">why</b> we added it and{" "}
          <b className="font-medium text-fg">what it did</b>. Every step ran on the same {s.cases.toLocaleString("en-IN")}-case simulated courts ({s.seeds} of them, same dice), so the
          difference between two steps is the effect of that one rule.
        </p>
      </div>

      <Card title="Pick a measure, see which rule moved it" sub="Bar = value after that step. Green = the step improved it, red = it made it worse, grey = no real change.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {s.metrics.map((x) => (
            <button key={x.key} onClick={() => setMetric(x.key)} className={`rounded-full px-3 py-1 text-[13px] ${metric === x.key ? "bg-acc/10 text-acc" : "bg-soft text-mut hover:text-fg"}`}>
              {x.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={290}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--mut)" }} interval={0} height={70} angle={-14} textAnchor="end" />
            <YAxis tick={{ fontSize: 11, fill: "var(--mut)" }} width={48} tickFormatter={(v) => (m.kind === "pct" ? `${Math.round(v * 100)}%` : String(v))} />
            <Tooltip formatter={(v) => fmt(m, Number(v))} />
            <Bar dataKey="value" isAnimationActive={false} radius={[6, 6, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={color[d.tone as keyof typeof color]} fillOpacity={d.tone === "flat" ? 1 : 0.6} />
              ))}
              <LabelList dataKey="label" position="top" style={{ fontSize: 11, fill: "var(--fg)" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[12.5px] text-mut">{m.higher_is_better ? "Higher is better." : "Lower is better."}</p>
      </Card>

      <div className="grid gap-4">
        {s.steps.map((st, i) => (
          <Card key={st.key}>
            <div className="grid gap-4 md:grid-cols-[1fr_1.1fr]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-acc/10 text-[13px] font-semibold text-acc">{i}</span>
                  <h3 className="text-[16px] font-semibold">{st.title}</h3>
                  {st.planner === "adaptive" && <Tag tone="blue">adaptive planner</Tag>}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed">
                  <span className="text-mut">Why: </span>
                  {st.why}
                </p>
              </div>
              <div>
                <div className="mb-1 text-[12.5px] text-mut">{i === 0 ? "Where we start" : "What it did (vs the step before)"}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                  {KEY.map((k) => {
                    const mm = s.metrics.find((x) => x.key === k)!;
                    const d = st.delta?.[k];
                    const tiny = d ? Math.abs(d.mean) <= Math.max(d.ci, mm.kind === "pct" ? 0.002 : 0.01) : true;
                    const good = d ? (d.mean > 0) === mm.higher_is_better : false;
                    return (
                      <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1">
                        <span className="text-mut">{mm.label}</span>
                        <span className="tabular-nums">
                          {!d ? fmt(mm, st.values[k].mean) : <span className={tiny ? "text-mut" : good ? "text-acc" : "text-bad"}>{tiny ? "—" : fmtD(mm, d.mean)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
