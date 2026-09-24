"use client";
import { Fragment } from "react";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, pct } from "@/lib/api";

export type Band = { mean: number | null; low: number | null; high: number | null };
export type ForecastOption = {
  label: string;
  totals: Record<string, Band>;
  delta?: Record<string, Band>;
  weekly: Record<string, number | string | null>[];
  today: { day: string; expected: number; used: number; listed: number } | null;
  daily?: { day: string; expected: number; used: number; listed: number }[];
  affected?: {
    counts: Record<string, number>;
    old_counts: Record<string, number>;
    cases: { case_idx: number; case_id: string; kind: string; shift_days: number | null; age_years: number; old: boolean }[];
  };
};
export type Forecast = { from: string; to: string; weeks: number; samples: number; options: ForecastOption[] };

// metric, label, format, higher-is-better
export const METRICS: [string, string, "pct" | "num" | "days", boolean][] = [
  ["utilisation", "Share of the day used", "pct", true],
  ["substantive_per_day", "Useful hearings per day", "num", true],
  ["carried_over", "Hearings not reached (carried over)", "num", false],
  ["days_late", "Days late vs the promised date", "days", false],
  ["stage_advances", "Steps forward (stage advances)", "num", true],
  ["disposals", "Cases disposed", "num", true],
  ["backlog_3+_end", "3+ yr cases pending at the end", "num", false],
  ["backlog_4+_end", "4+ yr cases pending at the end", "num", false],
  ["backlog_5+_end", "5+ yr cases pending at the end", "num", false],
];

const f = (v: number | null | undefined, kind: string) =>
  v == null ? "—" : kind === "pct" ? pct(v, 1) : kind === "days" ? `${v.toFixed(2)} d` : num(v, v < 10 ? 1 : 0);

function DeltaCell({ d, kind, better }: { d?: Band; kind: string; better: boolean }) {
  if (!d || d.mean == null) return <span className="text-mut">—</span>;
  const scale = kind === "pct" ? 100 : 1;
  const unit = kind === "pct" ? " pts" : kind === "days" ? " d" : "";
  const m = d.mean * scale;
  const lo = (d.low ?? 0) * scale, hi = (d.high ?? 0) * scale;
  const tiny = Math.abs(m) < (kind === "pct" ? 0.2 : kind === "days" ? 0.01 : 0.5);
  const good = (m > 0) === better;
  const sure = lo > 0 || hi < 0; // every imagined future agrees on the direction
  const cls = tiny ? "text-mut" : good ? "text-acc" : "text-bad";
  return (
    <span className={cls} title={`range across imagined futures: ${lo.toFixed(1)} to ${hi.toFixed(1)}`}>
      {tiny ? "no change" : `${m > 0 ? "+" : ""}${m.toFixed(kind === "num" && Math.abs(m) >= 10 ? 0 : 1)}${unit}`}
      {!tiny && !sure && <span className="ml-1 text-[11px] text-mut">(uncertain)</span>}
    </span>
  );
}

export function ImpactTable({ fc, hideCurrent = false }: { fc: Forecast; hideCurrent?: boolean }) {
  const [cur, ...opts] = fc.options;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="border-b border-line px-2.5 py-2 text-left text-[12px] font-medium text-mut">Next {fc.weeks} weeks</th>
            {!hideCurrent && <th className="border-b border-line px-2.5 py-2 text-right text-[12px] font-medium text-mut">Current plan</th>}
            {opts.map((o) => (
              <th key={o.label} className="border-b border-line px-2.5 py-2 text-right text-[12px] font-medium text-mut" colSpan={2}>
                {o.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map(([k, label, kind, better]) => (
            <tr key={k}>
              <td className="border-b border-line/70 px-2.5 py-2">{label}</td>
              {!hideCurrent && <td className="border-b border-line/70 px-2.5 py-2 text-right tabular-nums">{f(cur.totals[k]?.mean, kind)}</td>}
              {opts.map((o) => (
                <Fragment key={o.label}>
                  <td className="border-b border-line/70 px-2.5 py-2 text-right tabular-nums text-mut">{f(o.totals[k]?.mean, kind)}</td>
                  <td className="border-b border-line/70 px-2.5 py-2 text-right tabular-nums">
                    <DeltaCell d={o.delta?.[k]} kind={kind} better={better} />
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-mut">
        Compared over {fc.samples} imagined futures, drawn only from what the court knows today (never the simulator&apos;s hidden truth). Every option faces the same futures.
        &ldquo;Uncertain&rdquo; = the futures disagree on the direction.
      </p>
    </div>
  );
}

const PAL = ["var(--mut)", "var(--acc)", "var(--blue)", "var(--warn)", "var(--bad)"];

export function WeeklyChart({ fc, metric, label }: { fc: Forecast; metric: string; label: string }) {
  const weeks = fc.options[0]?.weekly.map((w) => String(w.week)) ?? [];
  const data = weeks.map((wk, i) => {
    const row: Record<string, number | string | null> = {
      week: new Date(wk + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    };
    fc.options.forEach((o) => (row[o.label] = (o.weekly[i]?.[metric] as number) ?? null));
    return row;
  });
  return (
    <div>
      <div className="mb-1 text-[13px] text-mut">{label}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "var(--mut)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--mut)" }} width={44} domain={["auto", "auto"]} />
          <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {fc.options.map((o, i) => (
            <Line key={o.label} isAnimationActive={false} dataKey={o.label} stroke={PAL[i % PAL.length]} strokeWidth={2} dot={false} strokeDasharray={i === 0 ? "4 3" : undefined} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });

/** Day by day: how full each sitting day is expected to be, current plan vs each option. */
export function DailyLoadChart({ fc, days = 12 }: { fc: Forecast; days?: number }) {
  const base = fc.options[0]?.daily ?? [];
  const data = base.slice(0, days).map((d, i) => {
    const row: Record<string, number | string> = { day: short(d.day) };
    fc.options.forEach((o) => (row[o.label] = Math.round(o.daily?.[i]?.expected ?? 0)));
    return row;
  });
  return (
    <div>
      <div className="mb-1 text-[13px] text-mut">How full each day is expected to be (minutes planned; the line is the 420-minute day)</div>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={data}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--mut)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--mut)" }} width={40} domain={[0, (max: number) => Math.max(480, Math.ceil(max / 60) * 60)]} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={420} stroke="var(--bad)" strokeDasharray="4 4" strokeOpacity={0.6} />
          {fc.options.map((o, i) => (
            <Line key={o.label} isAnimationActive={false} dataKey={o.label} stroke={PAL[i % PAL.length]} strokeWidth={2} dot={{ r: 2 }} strokeDasharray={i === 0 ? "4 3" : undefined} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const KIND: Record<string, { label: string; tone: string }> = {
  earlier: { label: "heard earlier", tone: "text-acc" },
  later: { label: "heard later", tone: "text-warn" },
  "newly heard": { label: "newly heard in this period", tone: "text-acc" },
  "no longer heard": { label: "no longer heard in this period", tone: "text-bad" },
};

/** Who does the change affect? Cases heard earlier/later, or pushed in/out of the look-ahead window. */
export function Affected({ ws, opt, weeks }: { ws: string; opt: ForecastOption; weeks: number }) {
  const a = opt.affected;
  if (!a) return null;
  const total = Object.values(a.counts).reduce((x, y) => x + y, 0);
  return (
    <div>
      <div className="mb-2 text-[13px] text-mut">Who it affects over the next {weeks} weeks · {total} cases</div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(KIND).map(([k, v]) => (
          <div key={k} className="rounded-xl bg-soft/70 px-3 py-2">
            <div className={`text-xl font-semibold tabular-nums ${a.counts[k] ? v.tone : "text-mut"}`}>{a.counts[k] ?? 0}</div>
            <div className="text-[12px] text-mut">{v.label}</div>
            {a.old_counts[k] ? <div className="text-[11.5px] text-warn">{a.old_counts[k]} of them 4+ yr old</div> : null}
          </div>
        ))}
      </div>
      {a.cases.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <tbody>
              {a.cases.map((c) => (
                <tr key={c.case_idx} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <Link href={`/w/${ws}/cases/${c.case_idx}`} className="font-medium text-acc hover:underline">{c.case_id}</Link>
                    {c.old && <span className="ml-2 text-[11.5px] text-warn">4+ yr</span>}
                  </td>
                  <td className={`px-3 py-1.5 ${KIND[c.kind]?.tone ?? ""}`}>{KIND[c.kind]?.label ?? c.kind}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-mut">
                    {c.shift_days == null ? "" : `${c.shift_days > 0 ? "+" : ""}${c.shift_days.toFixed(0)} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12px] text-mut">Compares when each case is first heard with and without the change, in the same imagined futures.</p>
    </div>
  );
}
