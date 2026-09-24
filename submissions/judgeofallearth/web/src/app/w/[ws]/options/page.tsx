"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useRole } from "@/components/role";
import { Button, Card, Empty, Note, Tag } from "@/components/ui";
import { Affected, DailyLoadChart, ImpactTable, WeeklyChart, type Forecast } from "@/components/impact";

type Rule = { key: string; label: string; help: string; value: number; min: number; max: number; step: number; policy: { op: string; bound: number } | null; within_policy: boolean };
type Rules = { strategy: string; editable: boolean; rules: Rule[]; presets: { id: string; label: string }[] };
type Opt = { label: string; values: Record<string, number>; reason?: string };

const fmt = (r: Rule, v: number) => (["fill", "old_share", "due_share"].includes(r.key) ? `${Math.round(v * 100)}%` : ["gap_mult", "age_weight", "adv_bonus"].includes(r.key) ? v.toFixed(2) : `${v} ${r.key.includes("gap") || r.key.includes("wait") ? "days" : ""}`);
const breaks = (r: Rule, v: number) => (r.policy ? (r.policy.op === ">=" ? v < r.policy.bound : v > r.policy.bound) : false);

export default function OptionsPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const [rules, setRules] = useState<Rules | null>(null);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [weeks, setWeeks] = useState(4);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api<Rules>(`/workspaces/${ws}/rules`, role).then(setRules).catch((e) => setErr(e.message)), [ws, role]);
  useEffect(() => {
    load();
  }, [load]);

  if (!rules) return <Empty>{err ?? "Loading…"}</Empty>;
  if (!rules.editable) return <Card title="Rules">This court runs today&apos;s baseline, which has no adjustable rules. Create a court with one of the planner presets to try options.</Card>;

  const current = Object.fromEntries(rules.rules.map((r) => [r.key, r.value]));
  const diff = (o: Opt) => Object.fromEntries(Object.entries(o.values).filter(([k, v]) => v !== current[k]));

  const addOption = async (preset?: string) => {
    let values = { ...current };
    let label = `Option ${String.fromCharCode(65 + opts.length)}`;
    if (preset) {
      values = { ...values, ...(await api<Record<string, number>>(`/presets/${preset}/params`, role)) };
      label = rules.presets.find((p) => p.id === preset)?.label ?? label;
    }
    setOpts((o) => [...o, { label, values }].slice(0, 3));
    setFc(null);
  };

  const compare = async () => {
    setBusy("fc");
    setErr(null);
    try {
      const body = { options: opts.map((o) => ({ label: o.label, params: diff(o) })), weeks };
      setFc(await api<Forecast>(`/workspaces/${ws}/forecast`, role, { method: "POST", body: JSON.stringify(body) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const adopt = async (o: Opt) => {
    setBusy("adopt:" + o.label);
    setErr(null);
    try {
      await api(`/workspaces/${ws}/apply`, role, { method: "POST", body: JSON.stringify({ option: { label: `Adopted: ${o.label}`, params: diff(o), weeks, reason: o.reason } }) });
      setMsg(`“${o.label}” is now the court's rules, from today.`);
      setOpts([]);
      setFc(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6">
      <Card title="The rules this court runs on" sub="What the planner follows every day. Two are protected by policy: a judge can make them stricter, never looser.">
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {rules.rules.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-3 border-b border-line/70 pb-2">
              <div>
                <div className="text-sm font-medium">
                  {r.label} {r.policy && <span title={`Policy: ${r.policy.op} ${r.policy.bound}`}>🔒</span>}
                </div>
                <div className="text-[12.5px] text-mut">{r.help}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{fmt(r, r.value)}</div>
                {!r.within_policy && <Tag tone="bad">below policy (demo preset)</Tag>}
              </div>
            </div>
          ))}
        </div>
        {msg && <p className="mt-3 rounded-xl bg-acc/5 px-3 py-2 text-sm text-acc">{msg}</p>}
      </Card>

      <Card
        title="Try other options"
        sub="Build up to three alternatives, from a scheduling style or by adjusting the rules, and compare the next weeks under each against the current rules."
        right={
          <div className="flex flex-wrap gap-2">
            <Button disabled={opts.length >= 3} onClick={() => addOption()}>+ Adjust current rules</Button>
            <select
              className="rounded-xl border border-line bg-card px-2 py-2 text-sm"
              value=""
              disabled={opts.length >= 3}
              onChange={(e) => e.target.value && addOption(e.target.value)}
            >
              <option value="">+ Start from a scheduling style…</option>
              {rules.presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        }
      >
        {opts.length === 0 ? (
          <Empty>No options yet. Add one above: for example, the oldest-first style, or pack the day fuller.</Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {opts.map((o, oi) => {
              const violations = rules.rules.filter((r) => breaks(r, o.values[r.key]));
              return (
                <div key={oi} className="rounded-xl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <input className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-line" value={o.label} onChange={(e) => setOpts((all) => all.map((x, i) => (i === oi ? { ...x, label: e.target.value } : x)))} />
                    <button className="text-[12px] text-mut hover:text-bad" onClick={() => { setOpts((all) => all.filter((_, i) => i !== oi)); setFc(null); }}>remove</button>
                  </div>
                  <div className="grid gap-2.5">
                    {rules.rules.map((r) => {
                      const v = o.values[r.key];
                      const changed = v !== current[r.key];
                      return (
                        <label key={r.key} className="grid gap-0.5 text-[12.5px]">
                          <span className="flex justify-between">
                            <span className={changed ? "font-medium text-fg" : "text-mut"}>{r.label}</span>
                            <span className={`tabular-nums ${breaks(r, v) ? "text-bad" : changed ? "text-acc" : "text-mut"}`}>{fmt(r, v)}</span>
                          </span>
                          <input
                            type="range" min={r.min} max={r.max} step={r.step} value={v}
                            className="accent-[var(--acc)]"
                            onChange={(e) => { const nv = Number(e.target.value); setOpts((all) => all.map((x, i) => (i === oi ? { ...x, values: { ...x.values, [r.key]: nv } } : x))); setFc(null); }}
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    {violations.length > 0 ? (
                      <Note>
                        <span className="text-bad">Can be compared, not adopted:</span> {violations.map((r) => r.label).join(", ")} breaks policy.
                      </Note>
                    ) : (
                      <>
                      <input placeholder="Why adopt this? (required)" className="mb-2 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm" value={o.reason ?? ""} onChange={(e) => setOpts((all) => all.map((x, i) => (i === oi ? { ...x, reason: e.target.value } : x)))} />
                      <Button kind="primary" className="w-full" disabled={role !== "Judge" || !!busy || Object.keys(diff(o)).length === 0 || !(o.reason ?? "").trim()} onClick={() => adopt(o)} title={role !== "Judge" ? "Only the Judge can adopt rules" : ""}>
                        {busy === "adopt:" + o.label ? "Adopting…" : "Adopt from today (Judge)"}
                      </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {opts.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <span className="text-sm text-mut">Look ahead</span>
            {[2, 4, 8].map((w) => (
              <button key={w} onClick={() => { setWeeks(w); setFc(null); }} className={`rounded-full px-3 py-1 text-sm ${weeks === w ? "bg-acc/10 text-acc" : "text-mut hover:text-fg"}`}>{w} weeks</button>
            ))}
            <Button kind="primary" className="ml-auto" onClick={compare} disabled={!!busy}>{busy === "fc" ? "Forecasting…" : "Compare options"}</Button>
          </div>
        )}
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      </Card>

      {fc && (
        <Card title={`What the next ${fc.weeks} weeks look like`} sub="Dashed line = the current rules.">
          <div className="grid gap-5 lg:grid-cols-3">
            <WeeklyChart fc={fc} metric="backlog_4+" label="4+ yr cases pending (end of week)" />
            <WeeklyChart fc={fc} metric="substantive" label="Useful hearings per week" />
            <WeeklyChart fc={fc} metric="carried" label="Hearings not reached per week" />
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <DailyLoadChart fc={fc} days={15} />
            <div className="grid gap-4">
              {fc.options.slice(1).map((o) => (
                <div key={o.label}>
                  <div className="mb-1 text-sm font-medium">{o.label}</div>
                  <Affected ws={ws} opt={o} weeks={fc.weeks} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6"><ImpactTable fc={fc} /></div>
        </Card>
      )}
    </div>
  );
}
