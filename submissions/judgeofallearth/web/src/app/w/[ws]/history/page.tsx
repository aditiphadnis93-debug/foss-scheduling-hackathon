"use client";
import { useParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { api, fmtDay, num, pct } from "@/lib/api";
import { useRole } from "@/components/role";
import { Card, CaseLink, Empty, Tag, Td, Th } from "@/components/ui";

type Day = { day: string; listed: number; reached: number; substantive: number; advanced: number; disposed: number; utilisation: number; old_heard: number };
type Row = { ord: number; case_idx: number; case_id: string; purpose_label: string; why: string; slot: string | null; reached: boolean; substantive: boolean; advanced_to: string | null; reason: string | null };
type Event = { ts: string; role: string; kind: string; payload: Record<string, unknown> };

export default function HistoryPage() {
  const { ws } = useParams<{ ws: string }>();
  const { role } = useRole();
  const [days, setDays] = useState<Day[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    api<Day[]>(`/workspaces/${ws}/days`, role).then(setDays);
    api<Event[]>(`/workspaces/${ws}/events`, role).then(setEvents);
  }, [ws, role]);

  const toggle = async (i: number) => {
    if (open === i) return setOpen(null);
    setOpen(i);
    setRows(await api<Row[]>(`/workspaces/${ws}/days/${i}`, role));
  };

  if (!days) return <Empty>Loading…</Empty>;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card title="Sitting days played" sub="Click a day to see its causelist and outcomes.">
        {days.length === 0 ? (
          <Empty>No days played yet.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr><Th>Day</Th><Th className="text-right">Listed</Th><Th className="text-right">Reached</Th><Th className="text-right">Useful</Th><Th className="text-right">Moved on</Th><Th className="text-right">Disposed</Th><Th className="text-right">Day used</Th></tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <Fragment key={d.day}>
                  <tr onClick={() => toggle(i)} className="cursor-pointer hover:bg-soft/60">
                    <Td className="whitespace-nowrap font-medium">{open === i ? "▾" : "▸"} {fmtDay(d.day)}</Td>
                    <Td className="text-right tabular-nums">{d.listed}</Td>
                    <Td className="text-right tabular-nums">{d.reached}</Td>
                    <Td className="text-right tabular-nums">{d.substantive}</Td>
                    <Td className="text-right tabular-nums">{d.advanced}</Td>
                    <Td className="text-right tabular-nums">{d.disposed}</Td>
                    <Td className="text-right tabular-nums">{pct(d.utilisation)}</Td>
                  </tr>
                  {open === i && (
                    <tr>
                      <td colSpan={7} className="bg-soft/50 p-2">
                        <table className="w-full text-[13px]">
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.case_idx}>
                                <Td className="text-mut">{r.ord}</Td>
                                <Td className="whitespace-nowrap">{r.slot ?? ""}</Td>
                                <Td><CaseLink ws={ws} idx={r.case_idx} id={r.case_id} /></Td>
                                <Td>{r.purpose_label}</Td>
                                <Td className="text-mut">{r.why}</Td>
                                <Td>
                                  {r.reached === false ? <Tag tone="bad">not reached</Tag> : r.advanced_to ? <Tag tone="acc">moved on</Tag> : r.substantive ? <Tag tone="acc">useful</Tag> : <Tag tone="warn">{r.reason}</Tag>}
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Activity" sub="Every approval and run, with the role that did it.">
        <ul className="grid gap-2 text-[13px]">
          {events.map((e, i) => (
            <li key={i} className="border-b border-line pb-2">
              <div className="font-medium">{e.kind.replace(".", " ")}</div>
              <div className="text-mut">
                {e.role} · {new Date(e.ts).toLocaleString("en-IN")} {e.payload.day ? `· ${fmtDay(String(e.payload.day))}` : ""}
              </div>
            </li>
          ))}
          {events.length === 0 && <Empty>No activity yet.</Empty>}
        </ul>
        <p className="mt-3 text-[12px] text-mut">{num(events.length)} most recent events shown.</p>
      </Card>
    </div>
  );
}
