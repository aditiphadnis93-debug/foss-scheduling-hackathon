"use client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDay, num, pct } from "@/lib/api";
import { useRole } from "@/components/role";
import { AgeTag, Button, Card, CaseLink, Empty, Note, Tag, Td, Th } from "@/components/ui";
import { Affected, DailyLoadChart, ImpactTable, type Forecast } from "@/components/impact";

type Row = {
  ord: number; case_idx: number; case_id: string; advocate: string; purpose_label: string; age_years: number; old: boolean;
  why: string; slot: string | null; exp_minutes: number; status: string;
  reached: boolean | null; substantive: boolean | null; advanced_to: string | null; reason: string | null; minutes: number | null; next_gap: number | null;
};
type Today = {
  day: string | null; day_idx: number; days_total: number; status: string; finished?: boolean;
  capacity: { minutes: number; expected: number; p80: number; p_overrun: number; count: number; old_minutes: number };
  blocked_by_process: number; listings: Row[];
};
type RunResult = { played: string; metrics: Record<string, number>; outcomes: Row[]; next_day: string | null };
type Cand = { case_idx: number; case_id: string; advocate: string; purpose_label: string; age_years: number };
type Pending = { remove: number[]; add: number[]; extra: number; move: Record<number, string> };
type Applied = { removed: { case_id: string }[]; added: { case_id: string }[]; extra: number; moved: { case_id: string; to: string }[] };

const EMPTY: Pending = { remove: [], add: [], extra: 0, move: {} };

export default function TodayPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const router = useRouter();
  const [t, setT] = useState<Today | null>(null);
  const [last, setLast] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Pending>(EMPTY);
  const [impact, setImpact] = useState<Forecast | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setT(await api<Today>(`/workspaces/${ws}/today`, role));
      setApplied(await api<Applied>(`/workspaces/${ws}/overrides`, role));
      const cal = await api<{ days: { date: string; sitting: boolean; today: boolean }[] }>(`/workspaces/${ws}/calendar?weeks=4`, role);
      setDays(cal.days.filter((d) => d.sitting && !d.today).map((d) => d.date));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [ws, role]);
  useEffect(() => {
    load();
  }, [load]);

  const hasPending = pending.remove.length + pending.add.length + pending.extra + Object.keys(pending.move).length > 0;
  const option = useMemo(() => ({ label: "Change to today's list", ...pending }), [pending]);

  const act = async (label: string, path: string, body?: unknown) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await api<RunResult | Today>(path, role, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      if ("played" in r) setLast(r as RunResult);
      await load();
      router.refresh();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    setBusy("preview");
    setErr(null);
    try {
      setImpact(await api<Forecast>(`/workspaces/${ws}/forecast`, role, { method: "POST", body: JSON.stringify({ options: [option], weeks: 4 }) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applyChange = async () => {
    if (await act("apply", `/workspaces/${ws}/apply`, { option: { ...option, reason } })) {
      setReason("");
      setPending(EMPTY);
      setSel(new Set());
      setImpact(null);
    }
  };

  const edit = (fn: (p: Pending) => Pending) => {
    setPending((p) => fn({ ...p, move: { ...p.move } }));
    setImpact(null);
  };

  if (!t) return <Empty>{err ?? "Loading today's list…"}</Empty>;
  if (t.finished || !t.day) return <Card title="Posting finished">All sitting days have been played. See Docket health for how it went.</Card>;

  const approved = t.status === "approved";
  const canApprove = role === "Judge" && !approved;
  const canRun = (role === "Court Master" || role === "Judge") && approved;
  const label = (i: number) => t.listings.find((r) => r.case_idx === i)?.case_id ?? `#${i}`;
  const appliedAny = applied && (applied.removed.length || applied.added.length || applied.extra || applied.moved.length);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wider text-mut">Causelist</div>
          <h2 className="text-[22px] font-semibold tracking-tight">
            {fmtDay(t.day)} <span className="font-normal text-mut">· sitting day {t.day_idx + 1} of {t.days_total}</span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={approved ? "acc" : "warn"}>{approved ? "Approved by the Judge" : "Draft · awaiting the Judge"}</Tag>
          <Button kind="secondary" disabled={!canApprove || !!busy} onClick={() => act("approve", `/workspaces/${ws}/approve`)} title={role !== "Judge" ? "Switch to the Judge role to approve" : ""}>
            {busy === "approve" ? "Approving…" : "Approve list"}
          </Button>
          <Button kind="primary" disabled={!canRun || !!busy} onClick={() => act("run", `/workspaces/${ws}/run`)} title={!approved ? "The Judge must approve first" : role === "Analyst" ? "Court Master or Judge runs the day" : ""}>
            {busy === "run" ? "Running…" : "Run the day"}
          </Button>
          <Button kind="ghost" disabled={!!busy} onClick={() => act("ff", `/workspaces/${ws}/run-days?n=5`)} title="Demo: approve and run the next 5 sitting days">
            {busy === "ff" ? "…" : "Fast-forward 5 days →"}
          </Button>
        </div>
      </div>
      {err && <p className="rounded-xl bg-bad/5 px-4 py-2 text-sm text-bad">{err}</p>}

      <Capacity c={t.capacity} blocked={t.blocked_by_process} />

      {last && <LastDay r={last} ws={ws} />}

      {appliedAny ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-mut">
          <span>Changes already applied today:</span>
          {applied!.removed.map((c) => <Tag key={"r" + c.case_id}>removed {c.case_id}</Tag>)}
          {applied!.added.map((c) => <Tag key={"a" + c.case_id} tone="blue">added {c.case_id}</Tag>)}
          {applied!.extra > 0 && <Tag tone="warn">overbooked +{applied!.extra}</Tag>}
          {applied!.moved.map((c) => <Tag key={"m" + c.case_id}>{c.case_id} → {fmtDay(c.to)}</Tag>)}
        </div>
      ) : null}

      <Card
        title={`${t.listings.length} hearings, in calling order`}
        sub="Order = priority. Each advocate's matters sit together and share a slot. Tick cases to remove or move them; add or overbook below. Preview the effect before the Judge applies it."
      >
        {t.listings.length === 0 ? (
          <Empty>Nothing ready to list today.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th className="w-8" />
                  <Th>#</Th><Th>Slot</Th><Th>Case</Th><Th>Advocate</Th><Th>Hearing</Th><Th>Age</Th><Th>Why it&apos;s listed</Th><Th className="text-right">Exp. min</Th>
                </tr>
              </thead>
              <tbody>
                {t.listings.map((r) => {
                  const removed = pending.remove.includes(r.case_idx);
                  const moved = pending.move[r.case_idx];
                  return (
                    <tr key={r.case_idx} className={`${removed || moved ? "opacity-40" : ""} hover:bg-soft/60`}>
                      <Td>
                        <input
                          type="checkbox"
                          className="accent-[var(--acc)]"
                          checked={sel.has(r.case_idx)}
                          onChange={(e) => {
                            const s = new Set(sel);
                            if (e.target.checked) s.add(r.case_idx);
                            else s.delete(r.case_idx);
                            setSel(s);
                          }}
                        />
                      </Td>
                      <Td className="tabular-nums text-mut">{r.ord}</Td>
                      <Td className="whitespace-nowrap tabular-nums text-mut">{r.slot ?? "—"}</Td>
                      <Td>
                        <CaseLink ws={ws} idx={r.case_idx} id={r.case_id} />
                        {removed && <span className="ml-2 text-[12px] text-bad">to remove</span>}
                        {moved && <span className="ml-2 text-[12px] text-blue">→ {fmtDay(moved)}</span>}
                      </Td>
                      <Td className="text-mut">{r.advocate}</Td>
                      <Td>{r.purpose_label}</Td>
                      <Td><AgeTag age={r.age_years} /></Td>
                      <Td><WhyTag why={r.why} /></Td>
                      <Td className="text-right tabular-nums text-mut">{r.exp_minutes}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ChangeBar
        ws={ws}
        role={role}
        sel={sel}
        days={days}
        pending={pending}
        label={label}
        onRemove={() => {
          edit((p) => ({ ...p, remove: [...new Set([...p.remove, ...sel])] }));
          setSel(new Set());
        }}
        onMove={(to) => {
          edit((p) => {
            sel.forEach((i) => (p.move[i] = to));
            return p;
          });
          setSel(new Set());
        }}
        onAdd={(i) => edit((p) => ({ ...p, add: [...new Set([...p.add, i])] }))}
        onExtra={(n) => edit((p) => ({ ...p, extra: n }))}
        onClear={() => {
          setPending(EMPTY);
          setImpact(null);
        }}
        hasPending={hasPending}
        onPreview={preview}
        onApply={applyChange}
        busy={busy}
        impact={impact}
        reason={reason}
        setReason={setReason}
      />
    </div>
  );
}

function ChangeBar(p: {
  ws: string; role: string; sel: Set<number>; days: string[]; pending: Pending; label: (i: number) => string;
  onRemove: () => void; onMove: (to: string) => void; onAdd: (i: number) => void; onExtra: (n: number) => void; onClear: () => void;
  hasPending: boolean; onPreview: () => void; onApply: () => void; busy: string | null; impact: Forecast | null;
  reason: string; setReason: (s: string) => void;
}) {
  const { role } = { role: p.role };
  const [q, setQ] = useState("");
  const [cands, setCands] = useState<Cand[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const { role: r } = useRole();
  useEffect(() => {
    const id = setTimeout(() => {
      api<Cand[]>(`/workspaces/${p.ws}/candidates?limit=8${q ? `&q=${encodeURIComponent(q)}` : ""}`, r).then(setCands).catch(() => {});
    }, 250);
    return () => clearTimeout(id);
  }, [q, p.ws, r]);

  return (
    <Card title="Change today's plan" sub="Try a change, preview what it does to the next 4 weeks, then the Judge applies it. Nothing changes until it's applied.">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl bg-soft/70 p-3">
          <div className="mb-2 text-[13px] font-medium">Selected: {p.sel.size || "none"}</div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!p.sel.size} onClick={p.onRemove}>Remove from today</Button>
            <select className="rounded-xl border border-line bg-card px-2 py-2 text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Move to…</option>
              {p.days.slice(0, 15).map((d) => (
                <option key={d} value={d}>{fmtDay(d)}</option>
              ))}
            </select>
            <Button disabled={!p.sel.size || !moveTo} onClick={() => p.onMove(moveTo)}>Move</Button>
          </div>
          <Note>Moved cases are promised that date and won&apos;t be listed before it.</Note>
        </div>
        <div className="rounded-xl bg-soft/70 p-3">
          <div className="mb-2 text-[13px] font-medium">Add a case that&apos;s ready</div>
          <input placeholder="Search case number…" className="mb-2 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-36 overflow-auto">
            {cands.map((c) => (
              <div key={c.case_idx} className="flex items-center justify-between gap-2 py-1 text-[13px]">
                <span>
                  <b className="font-medium">{c.case_id}</b> <span className="text-mut">{c.purpose_label} · {c.age_years.toFixed(1)} yr</span>
                </span>
                <button className="text-acc hover:underline disabled:text-mut" disabled={p.pending.add.includes(c.case_idx)} onClick={() => p.onAdd(c.case_idx)}>
                  {p.pending.add.includes(c.case_idx) ? "added" : "add"}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-soft/70 p-3">
          <div className="mb-2 text-[13px] font-medium">Overbook the day</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-mut">Add the next best</span>
            <input type="number" min={0} max={30} className="w-16 rounded-xl border border-line bg-card px-2 py-1.5" value={p.pending.extra} onChange={(e) => p.onExtra(Math.max(0, Number(e.target.value)))} />
            <span className="text-mut">cases</span>
          </div>
          <Note>Past the 80% line, the chance of running over rises and late cases carry over to the next day.</Note>
        </div>
      </div>

      {p.hasPending && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[13px]">
          <span className="text-mut">Your change:</span>
          {p.pending.remove.map((i) => <Tag key={"r" + i} tone="bad">remove {p.label(i)}</Tag>)}
          {Object.entries(p.pending.move).map(([i, d]) => <Tag key={"m" + i} tone="blue">{p.label(Number(i))} → {fmtDay(d)}</Tag>)}
          {p.pending.add.map((i) => <Tag key={"a" + i} tone="acc">add #{i}</Tag>)}
          {p.pending.extra > 0 && <Tag tone="warn">overbook +{p.pending.extra}</Tag>}
          <div className="ml-auto flex gap-2">
            <Button kind="ghost" onClick={p.onClear}>Clear</Button>
            <Button onClick={p.onPreview} disabled={!!p.busy}>{p.busy === "preview" ? "Forecasting…" : "Preview impact"}</Button>
            <input placeholder="Why? (required to apply)" className="w-72 rounded-xl border border-line bg-card px-3 py-2 text-sm" value={p.reason} onChange={(e) => p.setReason(e.target.value)} />
            <Button kind="primary" onClick={p.onApply} disabled={role !== "Judge" || !!p.busy || !p.reason.trim()} title={role !== "Judge" ? "Only the Judge can apply changes" : !p.reason.trim() ? "Say why first" : ""}>
              {p.busy === "apply" ? "Applying…" : "Apply (Judge)"}
            </Button>
          </div>
        </div>
      )}
      {p.impact && (
        <div className="mt-5 grid gap-6">
          <TodayEffect fc={p.impact} />
          <div className="grid gap-6 lg:grid-cols-2">
            <DailyLoadChart fc={p.impact} />
            {p.impact.options[1] && <Affected ws={p.ws} opt={p.impact.options[1]} weeks={p.impact.weeks} />}
          </div>
          <ImpactTable fc={p.impact} />
        </div>
      )}
    </Card>
  );
}

function TodayEffect({ fc }: { fc: Forecast }) {
  const [cur, opt] = fc.options;
  if (!cur?.today || !opt?.today) return null;
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2">
      {[cur, opt].map((o) => (
        <div key={o.label} className="rounded-xl border border-line px-3 py-2 text-[13px]">
          <div className="font-medium">{o.label} · today</div>
          <div className="text-mut">
            {o.today!.listed} hearings · expected {num(o.today!.expected)} min of 420 ·{" "}
            <span className={o.today!.expected > 420 ? "text-bad" : ""}>{o.today!.expected > 420 ? "likely to overrun" : "fits"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Capacity({ c, blocked }: { c: Today["capacity"]; blocked: number }) {
  const max = Math.max(c.minutes, c.p80, c.expected) * 1.08;
  const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const over = c.p_overrun;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Will today fit?</h3>
        <span className="text-sm text-mut">
          Expected <b className="font-semibold text-fg">{num(c.expected)}</b> of {c.minutes} min · 80% of days like this finish by <b className="font-semibold text-fg">{num(c.p80)}</b> ·{" "}
          <span className={over > 0.25 ? "text-bad" : over > 0.15 ? "text-warn" : "text-acc"}>{pct(over)} chance of running over</span>
        </span>
      </div>
      <div className="relative h-6 w-full overflow-hidden rounded-full bg-soft">
        <div className="absolute inset-y-0 left-0 rounded-full bg-acc/25" style={{ width: w(c.expected) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-warn/35" style={{ width: w(c.old_minutes) }} title="Minutes on 4+ year-old cases" />
        <div className="absolute inset-y-0 border-l-2 border-fg/60" style={{ left: w(c.minutes) }} title="Judge's time: 420 min" />
        <div className="absolute inset-y-0 border-l-2 border-dashed border-bad/70" style={{ left: w(c.p80) }} title="80% line" />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-mut">
        <span><span className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-warn/50" />4+ yr cases: {num(c.old_minutes)} min ({pct(c.old_minutes / Math.max(1, c.expected))})</span>
        <span><span className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-acc/40" />{c.count} hearings listed</span>
        <span>│ 420-minute day</span>
        <span className="text-bad/80">┆ 80% line</span>
        <span><b className="font-semibold text-fg">{num(blocked)}</b> cases held back: summons/warrant not yet returned</span>
      </div>
    </Card>
  );
}

function WhyTag({ why }: { why: string }) {
  const tone = why.startsWith("carry") ? "bad" : why.startsWith("old") ? "warn" : why === "due" ? "blue" : why.includes("judge") ? "acc" : "mut";
  return <Tag tone={tone}>{why}</Tag>;
}

function Outcome({ r }: { r: Row }) {
  if (r.reached === false) return <Tag tone="bad">not reached · carried over</Tag>;
  if (r.advanced_to === "DISPOSED") return <Tag tone="acc">disposed</Tag>;
  if (r.advanced_to) return <Tag tone="acc">moved on</Tag>;
  if (r.substantive) return <Tag tone="acc">useful, same stage</Tag>;
  return <Tag tone="warn">adjourned · {r.reason}</Tag>;
}

function LastDay({ r, ws }: { r: RunResult; ws: string }) {
  const m = r.metrics;
  return (
    <Card title={`What happened on ${fmtDay(r.played)}`} sub={`${m.reached} of ${m.listed} reached · ${m.substantive} useful · ${m.advanced} moved on · ${m.disposed} disposed · ${pct(m.utilisation)} of the day used`}>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr><Th>#</Th><Th>Case</Th><Th>Hearing</Th><Th>Outcome</Th><Th className="text-right">Back in</Th></tr>
          </thead>
          <tbody>
            {r.outcomes.map((o) => (
              <tr key={o.case_idx}>
                <Td className="text-mut">{o.ord}</Td>
                <Td><CaseLink ws={ws} idx={o.case_idx} id={o.case_id} /></Td>
                <Td>{o.purpose_label}</Td>
                <Td><Outcome r={o} /></Td>
                <Td className="text-right tabular-nums text-mut">{o.reached === false ? "next day" : o.next_gap == null ? (o.advanced_to === "DISPOSED" ? "—" : "when process returns") : `${o.next_gap} days`}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
