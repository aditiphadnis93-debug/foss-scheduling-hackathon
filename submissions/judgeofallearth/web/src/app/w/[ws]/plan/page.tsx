"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDay, num } from "@/lib/api";
import { useRole } from "@/components/role";
import { Button, Card, Empty, Note, Tag } from "@/components/ui";
import { Affected, DailyLoadChart, ImpactTable, WeeklyChart, type Forecast } from "@/components/impact";

type Day = { date: string; past: boolean; today: boolean; sitting: boolean; leave: boolean; holiday: string | null; weekly_off: boolean; promised: number; budget: number };
type Cal = { from: string; weeks: number; capacity: number; days: Day[]; moves: Record<string, string> };

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PlanPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const [cal, setCal] = useState<Cal | null>(null);
  const [leave, setLeave] = useState<string[]>([]);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api<Cal>(`/workspaces/${ws}/calendar?weeks=6`, role).then(setCal).catch((e) => setErr(e.message)), [ws, role]);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = (d: string) => {
    setLeave((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d].sort()));
    setFc(null);
  };
  const option = { label: `Leave on ${leave.length} day${leave.length === 1 ? "" : "s"}`, leave };

  const preview = async () => {
    setBusy("preview");
    setErr(null);
    try {
      setFc(await api<Forecast>(`/workspaces/${ws}/forecast`, role, { method: "POST", body: JSON.stringify({ options: [option], weeks: 6 }) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy("apply");
    setErr(null);
    try {
      await api(`/workspaces/${ws}/apply`, role, { method: "POST", body: JSON.stringify({ option: { ...option, weeks: 6, reason } }) });
      setLeave([]);
      setFc(null);
      setReason("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!cal) return <Empty>{err ?? "Loading…"}</Empty>;
  const weeks: Day[][] = [];
  cal.days.forEach((d, i) => {
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(d);
  });
  const moves = Object.entries(cal.moves);

  return (
    <div className="grid gap-6">
      <Card
        title="The next six weeks"
        sub="Each sitting day shows how many minutes are already promised to cases that were given a next date, out of the share of the day the planner may promise in advance. The rest of the day is filled on the day from ready cases, by priority."
      >
        <div className="grid grid-cols-7 gap-2 text-[12px] text-mut">
          {DOW.map((d) => (
            <div key={d} className="px-1">{d}</div>
          ))}
        </div>
        <div className="mt-1 grid gap-2">
          {weeks.map((w, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-2">
              {w.map((d) => {
                const picked = leave.includes(d.date);
                const canPick = d.sitting && !d.today && role === "Judge";
                const fill = Math.min(100, (d.promised / Math.max(1, d.budget)) * 100);
                return (
                  <button
                    key={d.date}
                    disabled={!canPick}
                    onClick={() => toggle(d.date)}
                    title={canPick ? "Click to mark the Judge's leave" : ""}
                    className={`min-h-[78px] rounded-xl border p-2 text-left transition ${
                      d.today ? "border-acc bg-acc/5" : picked ? "border-bad/50 bg-bad/5" : d.sitting ? "border-line bg-card hover:border-acc/40" : "border-transparent bg-soft/60"
                    } ${canPick ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <div className="flex items-center justify-between text-[12px]">
                      <span className={d.past ? "text-mut/60" : "font-medium"}>{new Date(d.date + "T00:00:00").getDate()}</span>
                      {d.today && <Tag tone="acc">today</Tag>}
                      {picked && <Tag tone="bad">leave?</Tag>}
                      {d.leave && !picked && <Tag tone="bad">leave</Tag>}
                    </div>
                    {d.holiday && <div className="mt-1 truncate text-[11px] text-warn">{d.holiday}</div>}
                    {d.sitting && !picked && (
                      <div className="mt-3">
                        <div className="relative h-1.5 rounded-full bg-soft">
                          <div className="absolute inset-y-0 left-0 rounded-full bg-blue/50" style={{ width: `${fill}%` }} />
                        </div>
                        <div className="mt-1 text-[11px] text-mut">{num(d.promised)} / {num(d.budget)} min promised</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {role !== "Judge" ? (
            <Note>Switch to the Judge role to mark leave.</Note>
          ) : leave.length ? (
            <>
              <span className="text-[13px] text-mut">Leave:</span>
              {leave.map((d) => <Tag key={d} tone="bad">{fmtDay(d)}</Tag>)}
              <div className="ml-auto flex gap-2">
                <Button kind="ghost" onClick={() => { setLeave([]); setFc(null); }}>Clear</Button>
                <Button onClick={preview} disabled={!!busy}>{busy === "preview" ? "Forecasting…" : "Preview impact"}</Button>
                <input placeholder="Why? (required)" className="w-56 rounded-xl border border-line bg-card px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button kind="primary" onClick={apply} disabled={!!busy || !reason.trim()}>{busy === "apply" ? "Applying…" : "Apply leave"}</Button>
              </div>
            </>
          ) : (
            <Note>Click future sitting days to mark the Judge&apos;s leave, then preview what it does to the next weeks.</Note>
          )}
        </div>
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      </Card>

      {fc && (
        <Card title="What the leave would do" sub="Cases due on those days move to the next sitting day; the old-case guarantee still applies.">
          <div className="grid gap-6 lg:grid-cols-2">
            <DailyLoadChart fc={fc} days={15} />
            <WeeklyChart fc={fc} metric="backlog_4+" label="4+ yr cases pending (end of week)" />
          </div>
          {fc.options[1] && <div className="mt-6"><Affected ws={ws} opt={fc.options[1]} weeks={fc.weeks} /></div>}
          <div className="mt-4"><ImpactTable fc={fc} /></div>
        </Card>
      )}

      <Card title="Cases moved to a later day" sub="Promised a specific date by the Judge; not listed before it.">
        {moves.length === 0 ? <Empty>No moved cases.</Empty> : (
          <div className="flex flex-wrap gap-2">
            {moves.map(([c, d]) => <Tag key={c} tone="blue">{c} → {fmtDay(d)}</Tag>)}
          </div>
        )}
      </Card>
    </div>
  );
}
