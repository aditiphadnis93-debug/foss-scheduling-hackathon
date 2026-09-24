"use client";

import HowLink from "@/components/ui/HowLink";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Landmark } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { DerivedNote, useRunPicker } from "@/components/shell/RunPicker";
import StackBars from "@/components/charts/StackBars";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { CountUp } from "@/components/ui/Stat";
import { EASE } from "@/lib/motion";
import { pretty, shortDate } from "@/lib/format";
import { STAKEHOLDERS, STAKEHOLDER_COLOUR, STAKEHOLDER_LABEL, attributionOf, byWeek } from "@/lib/insights";
import { Technical } from "@/components/shell/Explain";

export default function Delays() {
  const { run, loading, controls, config } = useRunPicker("delays");
  const att = useMemo(() => (run ? attributionOf(run) : null), [run]);

  const rows = useMemo(() => {
    if (!att) return [];
    const total = Object.values(att.by_stakeholder).reduce((s, v) => s + (v?.count ?? 0), 0) || 1;
    return STAKEHOLDERS.map((s) => ({
      s,
      count: att.by_stakeholder[s]?.count ?? 0,
      minutes: att.minutes_lost[s] ?? att.by_stakeholder[s]?.minutes ?? 0,
      share: (att.by_stakeholder[s]?.count ?? 0) / total,
    })).sort((a, b) => b.count - a.count);
  }, [att]);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = rows[0];
  const agencies = rows.find((r) => r.s === "state_agencies");
  const present = STAKEHOLDERS.filter((s) => rows.find((r) => r.s === s && r.count > 0));
  const series = present.map((s) => ({ key: s, name: STAKEHOLDER_LABEL[s], colour: STAKEHOLDER_COLOUR[s] }));

  const weekly = useMemo(() => (att ? byWeek(att.by_day) : []), [att]);
  const byType = useMemo(() => {
    if (!att) return [];
    return Object.entries(att.by_type)
      .map(([type, v]) => ({ type, ...v, _total: Object.values(v).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b._total - a._total)
      .slice(0, 12) as unknown as Record<string, number | string>[];
  }, [att]);
  const agencyTypes = useMemo(
    () =>
      att
        ? Object.entries(att.by_type)
            .map(([t, v]) => [t, v.state_agencies ?? 0] as const)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
        : [],
    [att],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Who is the delay?"
        title="Every lost hearing has an owner"
        lede="Each hearing that did not move the case forward is attributed to the side that caused it: a party, both sides, the state agencies that serve process and file reports, the court itself, or a day that simply ran out."
        right={controls}
      />
      {loading || !run || !att ? (
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <>
          <DerivedNote show={!!att.derived} what="Delay attribution" />
          <HowLink id="delays" label="Who is the delay?" className="mb-4 inline-block" />
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <Card title="Lost hearings by stakeholder" subtitle={`${total.toLocaleString("en-IN")} hearings did not move forward over ${run.meta.sitting_days} sitting days`}>
              <div className="flex flex-col gap-3">
                {rows.map((r, i) => (
                  <div key={r.s} className="grid grid-cols-[150px_1fr_110px] items-center gap-3">
                    <span className="flex items-center gap-2 text-[13px] text-text">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAKEHOLDER_COLOUR[r.s] }} />
                      {STAKEHOLDER_LABEL[r.s]}
                    </span>
                    <div className="relative h-4 rounded bg-surface-2">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ background: STAKEHOLDER_COLOUR[r.s] }}
                        initial={{ width: 0 }}
                        whileInView={{ width: `${r.share * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, delay: i * 0.06, ease: EASE }}
                      />
                    </div>
                    <span className="text-right text-[12px] text-muted">
                      <span className="num text-[13px] text-text">{r.count}</span> · {Math.round(r.minutes)} min
                    </span>
                  </div>
                ))}
              </div>
              <Takeaway>
                {top && top.count > 0
                  ? `${STAKEHOLDER_LABEL[top.s]} account for ${Math.round(top.share * 100)}% of lost hearings. Each needs a different remedy: a firm date for a party, a reminder to an agency, a shorter list for a day that runs out.`
                  : "No lost hearings in this run."}
              </Takeaway>
            </Card>

            <Card title={<span className="flex items-center gap-2"><Landmark size={16} className="text-ready" /> State agencies</span>} subtitle="Process service, police, forensics and external reports">
              <div className="flex items-baseline gap-2">
                <CountUp value={agencies?.count ?? 0} className="display text-[40px] text-text" />
                <span className="text-[14px] text-muted">hearings lost</span>
              </div>
              <p className="mt-1 text-[14px] text-muted">
                <span className="num text-text">{Math.round(agencies?.minutes ?? 0)}</span> court minutes ·{" "}
                <span className="num text-text">{Math.round((agencies?.share ?? 0) * 100)}%</span> of all lost hearings
              </p>
              {agencyTypes.length > 0 && (
                <div className="mt-4 flex flex-col gap-1.5">
                  <p className="text-[12px] uppercase tracking-[0.12em] text-faint">Most affected hearings</p>
                  {agencyTypes.map(([t, n]) => (
                    <div key={t} className="flex justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-[13px]">
                      <span>{pretty(t)}</span>
                      <span className="num text-muted">{n}</span>
                    </div>
                  ))}
                </div>
              )}
              <Takeaway>
                These delays are outside the parties&apos; control. The readiness check keeps most of them off the list; the
                rest are the case for a service-of-process deadline with the agencies.
              </Takeaway>
            </Card>
          </div>

          <Technical>
            <Card className="mt-5" title="How a lost hearing is attributed (technical)" subtitle="causelist.attribution.stakeholder_for(kind, reason)">
              <ul className="grid gap-1 text-[12px] md:grid-cols-2">
                {[
                  ["not_reached", "time_ran_out"],
                  ["Petitioner Absence / Non-Compliance", "petitioner_side"],
                  ["Respondent Absence / Non-Compliance", "respondent_side"],
                  ["Both Parties Unready / Absent · Party Sought Time · Evidence / Filing Not Ready", "both_sides"],
                  ["Awaiting Process / Summons / Warrant Return · External Dependency", "state_agencies"],
                  ["Court Administrative Issue · Holiday · Unclear", "court"],
                  ["Judge emergency ...", "judge_emergency"],
                ].map(([a, b]) => (
                  <li key={a} className="flex justify-between gap-3 rounded bg-surface-2 px-2 py-1">
                    <span className="text-muted">{a}</span>
                    <span className="mono text-text">{b}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">Minutes lost = outcome.minutes of each non-substantive listing (call-over or adjournment time).</p>
            </Card>
          </Technical>

          <Card className="mt-5" title="Lost hearings by week" subtitle={`${config ? config.replace(/_/g, " ") : ""} · stacked by stakeholder`}>
            <p className="mb-3 text-[14px] text-text">A steady mix means structural causes; a spike points at one bad week (a strike, a holiday, a sick day).</p>
            <StackBars data={weekly} series={series} xKey="week" xFmt={(v) => `wk ${shortDate(v)}`} />
          </Card>

          <Card className="mt-5" title="Lost hearings by hearing type" subtitle="The twelve hearing types with the most lost hearings">
            <p className="mb-3 text-[14px] text-text">Early hearings lose time to process service; evidence and arguments lose it to the parties.</p>
            <StackBars data={byType} series={series} xKey="type" horizontal height={Math.max(260, byType.length * 30)} xFmt={pretty} />
          </Card>
        </>
      )}
    </div>
  );
}
