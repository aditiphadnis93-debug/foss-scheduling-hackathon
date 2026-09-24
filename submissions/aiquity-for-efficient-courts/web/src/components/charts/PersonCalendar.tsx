"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Day, Listing, Run } from "@/lib/types";
import { C, OUTCOME_COLOUR, OUTCOME_LABEL } from "@/lib/theme";
import { dateLabel, pretty, toMin } from "@/lib/format";
import { hhmm, toMinutes, weekOf, type Win } from "@/lib/dayprofile";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type Who = { kind: "advocate" | "party" | "case"; id: string };

function matches(run: Run, who: Who, l: Listing): boolean {
  if (who.kind === "advocate") return l.advocate === who.id;
  if (who.kind === "case") return l.case_id === who.id;
  return run.cases?.[l.case_id]?.party === who.id;
}

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 };
}

type RawWin = [string | number, string | number];
function windowsFor(run: Run, day: Day, key: "sitting_windows" | "admin_windows"): Win[] {
  const own = (day as Day & Record<string, RawWin[] | undefined>)[key];
  if (Array.isArray(own)) return own.map(([a, b]) => [toMinutes(a), toMinutes(b)] as Win);
  const wk = weekOf(run);
  const d = wk.days[parse(day.date).dow];
  if (!d) return [];
  return key === "sitting_windows" ? d.sittings : d.admin;
}

/** A person's calendar: month grid of their listings (by outcome), and a day view of all their matters. */
export default function PersonCalendar({ run, who, initialDay }: { run: Run; who: Who; initialDay?: string }) {
  const mine = useMemo(() => {
    const m = new Map<string, Listing[]>();
    for (const d of run.days) {
      const ls = d.listings.filter((l) => matches(run, who, l));
      if (ls.length) m.set(d.date, ls);
    }
    return m;
  }, [run, who]);
  const sitting = useMemo(() => new Set(run.days.map((d) => d.date)), [run]);
  const months = useMemo(() => {
    const s = new Set(run.days.map((d) => d.date.slice(0, 7)));
    return [...s].sort();
  }, [run]);
  const firstDay = initialDay && mine.has(initialDay) ? initialDay : [...mine.keys()][0] ?? run.days[0]?.date;
  const [picked, setPicked] = useState<string | null>(null);
  const selDay = picked ?? firstDay;
  const [monthPick, setMonth] = useState<string | null>(null);
  const month = monthPick ?? selDay?.slice(0, 7) ?? months[0];
  const mi = months.indexOf(month);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = parse(`${month}-01`).dow;
  const total = [...mine.values()].reduce((s, v) => s + v.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <button disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])} className="rounded-md p-1 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span className="text-[13px] font-medium text-text">
            {MONTHS[m - 1]} {y}
            <span className="ml-2 font-normal text-muted">
              {total} listing{total === 1 ? "" : "s"} in the period
            </span>
          </span>
          <button disabled={mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])} className="rounded-md p-1 text-muted hover:bg-surface-2 disabled:opacity-30" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.08em] text-faint">
          {WD.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: lead }).map((_, i) => (
            <span key={`l${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
            const ls = mine.get(iso) ?? [];
            const sits = sitting.has(iso);
            return (
              <button
                key={iso}
                disabled={!ls.length}
                onClick={() => setPicked(iso)}
                className={clsx(
                  "flex h-11 flex-col items-center justify-start gap-1 rounded-md border pt-1 text-[11px] transition-colors",
                  iso === selDay ? "border-primary bg-primary-subtle" : "border-line",
                  sits ? "bg-bg" : "bg-surface-2 text-faint",
                  ls.length ? "cursor-pointer hover:border-primary" : "cursor-default",
                )}
              >
                <span className={clsx("num", ls.length ? "text-text" : "text-faint")}>{i + 1}</span>
                <span className="flex gap-0.5">
                  {ls.slice(0, 4).map((l) => (
                    <span key={l.case_id} className="h-1.5 w-1.5 rounded-full" style={{ background: l.outcome ? OUTCOME_COLOUR[l.outcome.kind] : C.baseline }} />
                  ))}
                  {ls.length > 4 && <span className="text-[9px] leading-none text-muted">+{ls.length - 4}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {selDay && (
          <motion.div key={selDay} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <DayView run={run} day={run.days.find((d) => d.date === selDay)} listings={mine.get(selDay) ?? []} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DayView({ run, day, listings }: { run: Run; day?: Day; listings: Listing[] }) {
  if (!day) return null;
  const sits = windowsFor(run, day, "sitting_windows");
  const adm = windowsFor(run, day, "admin_windows");
  const all = [...sits, ...adm, ...listings.map((l) => [toMin(l.start), toMin(l.end)] as Win)];
  const t0 = Math.floor(Math.min(...all.map((w) => w[0]), 10 * 60) / 30) * 30;
  const t1 = Math.ceil(Math.max(...all.map((w) => w[1]), 17 * 60) / 30) * 30;
  const x = (mm: number) => `${((mm - t0) / (t1 - t0)) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / (t1 - t0)) * 100}%`;
  const sorted = [...listings].sort((a, b) => toMin(a.start) - toMin(b.start));
  const ticks: number[] = [];
  for (let t = t0; t <= t1; t += 60) ticks.push(t);
  const span = sorted.length ? `${sorted[0].start}-${sorted[sorted.length - 1].end}` : "";
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <p className="mb-2 text-[13px] text-text">
        <span className="font-medium">{dateLabel(day.date, true)}</span>
        <span className="text-muted">
          {" "}
          · {sorted.length} matter{sorted.length === 1 ? "" : "s"}
          {span && `, ${span}`}
        </span>
      </p>
      <div className="relative ml-[108px] h-4 text-[10px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2" style={{ left: x(t) }}>
            {hhmm(t)}
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[108px] right-0">
          {sits.map(([a, b]) => (
            <span key={`s${a}`} className="absolute inset-y-0 bg-primary-subtle" style={{ left: x(a), width: w(a, b) }} />
          ))}
          {adm.map(([a, b]) => (
            <span
              key={`a${a}`}
              className="absolute inset-y-0 opacity-60"
              style={{ left: x(a), width: w(a, b), backgroundImage: "repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 6px)" }}
            />
          ))}
        </div>
        <div className="relative flex flex-col gap-1 py-1">
          {sorted.length === 0 && <p className="py-2 pl-[108px] text-[12px] text-muted">No matters this day.</p>}
          {sorted.map((l, i) => {
            const a = toMin(l.start);
            const b = toMin(l.end);
            const col = l.outcome ? OUTCOME_COLOUR[l.outcome.kind] : C.baseline;
            return (
              <div key={l.case_id} className="flex items-center" title={`${l.case_id} ${pretty(l.purpose)} ${l.start}-${l.end}${l.outcome ? ` · ${OUTCOME_LABEL[l.outcome.kind]}` : ""}`}>
                <span className="w-[108px] shrink-0 truncate pr-2">
                  <span className="mono block truncate text-[11px] text-text">{l.case_id}</span>
                </span>
                <span className="relative h-5 flex-1">
                  <motion.span
                    className="absolute inset-y-0.5 flex items-center overflow-hidden rounded-sm px-1.5 text-[10px] text-on-primary"
                    style={{ left: x(a), background: col }}
                    initial={{ width: 0 }}
                    animate={{ width: w(a, b) }}
                    transition={{ duration: 0.5, delay: i * 0.05 }}
                  >
                    <span className="truncate">{pretty(l.purpose)}</span>
                  </motion.span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint">Blue background: the court is sitting. Hatched: the judge&apos;s administrative time. Bars: appointment windows, coloured by outcome.</p>
    </div>
  );
}
