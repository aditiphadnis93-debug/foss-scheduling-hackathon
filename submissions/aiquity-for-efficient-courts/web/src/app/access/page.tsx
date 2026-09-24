"use client";

import HowLink from "@/components/ui/HowLink";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import PersonCalendar from "@/components/charts/PersonCalendar";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Segmented, Select } from "@/components/ui/Controls";
import { CountUp } from "@/components/ui/Stat";
import { availableConfigs, preferredRoster, useAsync, useRuns } from "@/lib/data";
import { accessOf, hoursSaved, ALL_ACTIONS, type Access } from "@/lib/access";
import { C } from "@/lib/theme";
import { presetLabel } from "@/lib/format";
import { EASE } from "@/lib/motion";
import type { Roster } from "@/lib/types";

const ACTION_TEXT: Record<string, string> = {
  "confirm readiness ahead (check-in)": "Confirm the day before that they are ready, so the matter is kept or moved in time",
  "told of a missing prerequisite before travelling": "Be told a summons or filing is still missing before they travel",
  "real appointment window": "Come at a set time instead of waiting all day",
  "short, firm date after a time request": "Get a short, firm date when the other side asks for time",
  "date published days ahead": "See the date published days ahead and plan leave and travel",
};

export default function AccessPage() {
  const initial = useAsync(() => preferredRoster(["optimal", "baseline"]), []);
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initial ?? "100";
  const configs = (useAsync(() => availableConfigs(roster), [roster]) ?? []).filter((c) => c !== "baseline");
  const [pick, setPick] = useState("optimal");
  const config = configs.includes(pick) ? pick : configs[0] ?? "optimal";
  const { runs, loading } = useRuns(roster, [config, "baseline"]);
  const run = runs[config];
  const baseRun = runs.baseline;
  const ours = useMemo(() => (run ? accessOf(run) : null), [run]);
  const base = useMemo(() => (baseRun ? accessOf(baseRun) : null), [baseRun]);
  const [party, setParty] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Access to justice"
        title="What people see, and what they can do"
        lede="A causelist is a promise to the people in each case: come on this day, at this time, for this reason. This page measures whether the promise is kept, and what it costs people in hours of their lives."
        right={
          <>
            <Segmented<Roster>
              id="acc-roster"
              value={roster}
              onChange={setRoster}
              options={[
                { value: "100", label: "100 cases" },
                { value: "3000", label: "3,000 cases" },
              ]}
            />
            <div className="min-w-[200px]">
              <Select value={config} onChange={setPick} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
            </div>
          </>
        }
      />
      {loading || !ours || !base || !run ? (
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : (
        <>
          <Headline ours={ours} base={base} days={run.meta.sitting_days} />
          <HowLink id="people_see" label="What people see" className="mt-2 inline-block" />

          <Card className="mt-5" title="Visibility" subtitle="Does each person know what is happening to their matter?">
            <p className="mb-4 text-[14px] text-text">Blue is the {presetLabel(config)}; grey is current practice. Longer is better on every row.</p>
            <div className="flex flex-col gap-4">
              <Pair label="Called on the day they were told to come" note="People who came were actually heard or called, not sent home at the end of the day." a={ours.visibility.date_certainty_pct} b={base.visibility.date_certainty_pct} />
              <Pair label="Given a time window" note="A set time to come instead of an all-day wait in the corridor." a={ours.visibility.time_window_pct} b={base.visibility.time_window_pct} />
              <Pair
                label="Missing prerequisite known before travelling"
                note={`When a summons, warrant or filing was missing, the matter was held back with the item named, rather than discovered in court${ours.visibility.prerequisites_count_estimated ? " (estimated from the court's readiness visibility)" : ""}.`}
                a={ours.visibility.prerequisites_known_in_advance_pct}
                b={base.visibility.prerequisites_known_in_advance_pct}
              />
              <Pair label="A reason shown for every listing and next date" note="Each listing says why it was listed; each next date names the rule that set it." a={ours.visibility.reason_shown_pct} b={base.visibility.reason_shown_pct} />
            </div>
            <Takeaway>
              Knowing when to come, and knowing when not to, is what turns a court date from a gamble into an appointment.
            </Takeaway>
          </Card>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card title="Possibility" subtitle="What coming to court costs people">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Hours per hearing that moved the case" today={base.possibility.life_hours_per_hearing_moved} ours={ours.possibility.life_hours_per_hearing_moved} unit="h" />
                <Stat label="Average wait per person" today={base.possibility.mean_wait_hours} ours={ours.possibility.mean_wait_hours} unit="h" />
                <Stat label="Trips where nothing moved" today={base.possibility.wasted_trip_pct} ours={ours.possibility.wasted_trip_pct} unit="%" />
                <Stat label="Wasted trips" today={base.possibility.wasted_trips} ours={ours.possibility.wasted_trips} />
              </div>
              <Takeaway>
                Every hearing that moves a case costs people travel and waiting. The shorter that bill, the less a case
                costs a daily-wage litigant in lost work.
              </Takeaway>
            </Card>
            <Card title="What people can do" subtitle={`Actions open to them under ${presetLabel(config)} and under current practice`}>
              <ul className="flex flex-col gap-2.5">
                {ALL_ACTIONS.map((a) => {
                  const o = ours.possibility.actions_open.includes(a);
                  const t = base.possibility.actions_open.includes(a);
                  return (
                    <li key={a} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[13px]">
                      <span className="text-text">{ACTION_TEXT[a] ?? a}</span>
                      <Mark on={t} label="current" />
                      <Mark on={o} label="recommended" strong />
                    </li>
                  );
                })}
              </ul>
              <Takeaway>Each of these gives people a way to act before the day, instead of finding out in the courtroom.</Takeaway>
            </Card>
          </div>

          <Card className="mt-5" title="The people who carry the heaviest burden" subtitle={`Under ${presetLabel(config)}: most hours spent on court trips in the period. Click a row for their calendar.`}>
            <div className="scroll-thin max-h-[480px] overflow-auto">
              <table className="w-full min-w-[620px] whitespace-nowrap text-[13px]">
                <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                  <tr>
                    {[run.cases ? "Party" : "Case", "Trips", "Nothing moved", "Moved forward", "Hours spent"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ours.parties_most_burdened.map((p) => (
                    <tr key={p.party} onClick={() => setParty(p.party)} className="cursor-pointer border-b border-line hover:bg-surface-2">
                      <td className="mono px-2 py-2 text-primary">{p.party}</td>
                      <td className="num px-2 py-2">{p.trips}</td>
                      <td className="num px-2 py-2">{p.wasted}</td>
                      <td className="num px-2 py-2">{p.moved}</td>
                      <td className="num px-2 py-2 text-text">{p.hours.toFixed(1)} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Takeaway>
              These are the people for whom a firm date, a time window or an early warning about a missing summons matters
              most.
            </Takeaway>
          </Card>

          <p className="mt-5 text-[12px] text-faint">
            Assumptions: a round trip to court takes {ours.assumptions.travel_hours} hours; without a time window a person
            waits {ours.assumptions.all_day_wait_hours} hours, with one they wait half the window on average;{" "}
            {ours.assumptions.people_per_listing} people attend each listing, one for each side.
            {ours.derived ? " Computed in the browser from this run's day records with the engine's formulas." : ""}
          </p>
        </>
      )}
      <Drawer open={!!party && !!run} onClose={() => setParty(null)} title={<span className="mono">{party}</span>}>
        {party && run && <PersonCalendar run={run} who={{ kind: run.cases ? "party" : "case", id: party }} />}
      </Drawer>
    </div>
  );
}

function Headline({ ours, base, days }: { ours: Access; base: Access; days: number }) {
  const saved = hoursSaved(ours, base);
  const trips = base.possibility.wasted_trips - ours.possibility.wasted_trips;
  const cells = [
    { v: saved, d: 0, label: "hours of people's lives saved", sub: `over ${days} sitting days` },
    { v: trips, d: 0, label: "wasted trips avoided", sub: "people who would have come for nothing" },
    { v: ours.possibility.life_hours_per_hearing_moved, d: 1, label: "hours per hearing that moved", sub: `current practice ${base.possibility.life_hours_per_hearing_moved} h` },
    { v: ours.possibility.mean_wait_hours, d: 2, label: "hours average wait", sub: `current practice ${base.possibility.mean_wait_hours} h` },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.label} className={i === 0 ? "card border-l-2 border-l-primary p-5" : "card p-5"}>
          <CountUp value={c.v} decimals={c.d} className="display text-[40px] leading-none text-text" />
          <p className="mt-2 text-[14px] text-text">{c.label}</p>
          <p className="text-[12px] text-muted">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}

function Pair({ label, note, a, b }: { label: string; note: string; a: number; b: number }) {
  const bar = (v: number, colour: string, delay: number) => (
    <div className="relative h-2.5 rounded bg-surface-2">
      <motion.div className="absolute inset-y-0 left-0 rounded" style={{ background: colour }} initial={{ width: 0 }} whileInView={{ width: `${Math.min(100, v)}%` }} viewport={{ once: true }} transition={{ duration: 0.9, delay, ease: EASE }} />
    </div>
  );
  return (
    <div className="grid gap-2 md:grid-cols-[300px_1fr_120px] md:items-center">
      <div>
        <p className="text-[14px] text-text">{label}</p>
        <p className="text-[12px] text-muted">{note}</p>
      </div>
      <div className="flex flex-col gap-1">
        {bar(a, C.ours, 0)}
        {bar(b, C.baseline, 0.15)}
      </div>
      <p className="num text-right text-[13px]">
        <span className="text-text">{a.toFixed(0)}%</span> <span className="text-faint">vs {b.toFixed(0)}%</span>
      </p>
    </div>
  );
}

function Stat({ label, today, ours, unit = "" }: { label: string; today: number; ours: number; unit?: string }) {
  const fmt = (v: number) => `${unit === "%" ? v.toFixed(1) : Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(unit === "h" ? 2 : 1)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="display mt-1 text-[22px] text-text">{fmt(ours)}</p>
      <p className="text-[12px] text-faint">current practice {fmt(today)}</p>
    </div>
  );
}

function Mark({ on, label, strong }: { on: boolean; label: string; strong?: boolean }) {
  return (
    <span
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
      style={
        on
          ? { background: strong ? "var(--primary-subtle)" : "var(--surface-2)", color: strong ? "var(--primary)" : "var(--text-muted)" }
          : { color: "var(--text-faint)" }
      }
    >
      {on ? <Check size={12} /> : <X size={12} />} {label}
    </span>
  );
}
