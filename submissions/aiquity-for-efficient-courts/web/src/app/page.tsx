"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Lock, SlidersHorizontal } from "lucide-react";
import Funnel from "@/components/charts/Funnel";
import { BigMetric } from "@/components/ui/Stat";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { useAsync } from "@/lib/data";
import { headline, livesSaved } from "@/lib/scenario";
import { sampleRationale } from "@/lib/agents";
import { Bot, MessageSquareText, RefreshCw } from "lucide-react";
import { dateLabel } from "@/lib/format";
import { CountUp } from "@/components/ui/Stat";
import { C } from "@/lib/theme";
import { EASE } from "@/lib/motion";
import { SCORED, meta } from "@/lib/metrics";

const EXTRA = ["justice_weighted_progress_per_hour", "disposed", "cases_5y_pending_end"];

export default function Home() {
  const h = useAsync(headline, []);
  const lives = useAsync(livesSaved, []);
  const quote = useAsync(sampleRationale, []);
  return (
    <div className="flex flex-col gap-10">
      {/* hero */}
      <section className="relative overflow-hidden rounded-lg border border-line bg-surface p-6 md:p-10">
        <div className="relative grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-primary"
            >
              AIQuity for Efficient Courts
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
              className="display text-[40px] leading-[1.05] md:text-[56px]"
            >
              Sixty listed.
              <br />
              <span className="text-muted">Twenty heard.</span>
              <br />
              <span className="text-primary">Ten move forward.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
              className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted"
            >
              A judge has 420 minutes a day. Today most of the people told to come to court go home unheard. AIQuity for Efficient Courts
              builds the day&apos;s list from what the court can actually reach, tells every party when to
              come and why their matter is listed, and never lets the oldest cases slip.
            </motion.p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-7 flex flex-wrap gap-3"
            >
              <Link
                href="/court"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
              >
                <Clock size={16} /> Watch a court day
              </Link>
              <Link
                href="/scorecard"
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-5 py-2.5 text-[14px] text-text transition-colors hover:bg-surface-2"
              >
                See the scorecard <ArrowRight size={16} />
              </Link>
              <Link
                href="/whatif"
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-bg px-5 py-2.5 text-[14px] text-text transition-colors hover:bg-surface-2"
              >
                <SlidersHorizontal size={16} /> Override the plan
              </Link>
            </motion.div>
          </div>
          <div className="rounded-lg border border-line bg-bg p-5 md:p-6">
            <p className="mb-5 text-[12px] uppercase tracking-[0.16em] text-muted">One typical court day today</p>
            <Funnel
              max={60}
              steps={[
                { label: "Listed", value: 60, colour: C.baseline, note: "told to come" },
                { label: "Heard", value: 20, colour: C.adjourned, note: "reached before the day ends" },
                { label: "Effective", value: 10, colour: C.substantive, note: "the case moves forward" },
              ]}
            />
            <p className="mt-5 text-[13px] text-muted">
              Forty people wait all day for nothing; then the next date is a flat sixty days away, whatever the next
              step needs.
            </p>
          </div>
        </div>
      </section>

      {/* people's time */}
      {lives && lives.hours > 0 && (
        <Link href="/access" className="card group flex flex-col gap-2 border-l-2 border-l-primary p-6 transition-colors hover:bg-surface-2 md:flex-row md:items-center md:gap-8">
          <div className="flex items-baseline gap-3">
            <CountUp value={lives.hours} className="display text-[48px] leading-none text-text md:text-[56px]" />
            <span className="text-[16px] text-text">hours of people&apos;s lives saved</span>
          </div>
          <p className="text-[14px] text-muted md:ml-auto md:max-w-md">
            Travel and waiting that litigants no longer spend at court over {lives.days} sitting days, and{" "}
            <span className="num text-text">{lives.trips.toLocaleString("en-IN")}</span> wasted trips avoided
            ({lives.roster === "3000" ? "3,000-case roster" : "100-case sample"}).{" "}
            <span className="text-primary group-hover:underline">What people see</span>
          </p>
        </Link>
      )}

      {/* AI inside the court */}
      <section>
        <p className="text-[12px] uppercase tracking-[0.14em] text-primary">AI inside the court</p>
        <h2 className="display mt-1 text-[28px]">The people, the assistant, and a plan that learns</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {[
            {
              icon: Bot,
              title: "Every party and advocate is an AI agent",
              text: "Each one decides, hearing by hearing, whether to turn up, whether they are ready, or whether to ask for time, and says why. The court day is played out with their decisions.",
              href: "/court",
              cta: "Watch a court day",
            },
            {
              icon: MessageSquareText,
              title: "A court assistant for the judge",
              text: "Ask about today's list: who is likely to seek time, which old matters are at risk, what to take first. It answers from the day's record and names the cases.",
              href: "/court",
              cta: "Ask the assistant",
            },
            {
              icon: RefreshCw,
              title: "A plan that learns every evening",
              text: "After each sitting the court's estimates update from what actually happened, and tomorrow's list is re-planned: who came, who was ready, what overran.",
              href: "/people",
              cta: "See the people",
            },
          ].map((c, i) => (
            <Card key={c.title} delay={i * 0.08}>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-subtle text-primary">
                <c.icon size={18} />
              </span>
              <p className="mt-3 text-[16px] font-semibold text-text">{c.title}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">{c.text}</p>
              <Link href={c.href} className="mt-3 inline-flex items-center gap-1 text-[13px] text-primary hover:underline">
                {c.cta} <ArrowRight size={14} />
              </Link>
            </Card>
          ))}
        </div>
        {quote && (
          <motion.blockquote
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="card mt-4 border-l-2 border-l-primary p-5"
          >
            <p className="text-[18px] leading-relaxed text-text">&ldquo;{quote.text}&rdquo;</p>
            <footer className="mt-2 text-[12px] text-muted">
              An AI agent&apos;s own reasoning for <span className="mono">{quote.case_id}</span>, {dateLabel(quote.day, true)}
            </footer>
          </motion.blockquote>
        )}
      </section>

      {/* north star */}
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <Card>
          <p className="text-[11px] uppercase tracking-[0.16em] text-primary">North star</p>
          <p className="mt-2 text-[20px] font-medium leading-snug tracking-tight">
            Justice-weighted progress per judicial hour: every minute goes to the hearing most likely to move a case
            forward, weighted for how long it has waited.
          </p>
        </Card>
        <Card delay={0.1}>
          <div className="flex items-center gap-2 text-old">
            <Lock size={16} />
            <p className="text-[11px] uppercase tracking-[0.16em]">Ageing floor, cannot be switched off</p>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            At least <span className="num text-text">20%</span> of listed court minutes go to cases pending four years
            or more whenever they are ready. A judge can raise it, never lower it.
          </p>
        </Card>
      </div>

      {/* ours vs today */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-primary">Recommended list vs current practice</p>
            <h2 className="display mt-1 text-[28px]">Same cases. Same people. A different list.</h2>
          </div>
          {h && (
            <p className="text-[12px] text-muted">
              {h.roster === "3000" ? "3,000-case roster" : "100-case sample roster"} ·{" "}
              {h.sittingDays ? `${h.sittingDays} sitting days` : "full horizon"} · simulated
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SCORED.map((k) =>
            h ? (
              <BigMetric
                key={k}
                k={k}
                label={meta(k).dim ?? meta(k).label}
                value={h.ours[k]}
                base={h.base[k]}
                sub={`current practice ${h.base[k] ?? "--"}`}
                highlight={k === "backlog_4y_heard_pct"}
              />
            ) : (
              <Skeleton key={k} className="h-[132px]" />
            ),
          )}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {EXTRA.map((k) =>
            h ? (
              <BigMetric key={k} k={k} label={meta(k).label} value={h.ours[k]} base={h.base[k]} sub={`current practice ${h.base[k] ?? "--"}`} />
            ) : (
              <Skeleton key={k} className="h-[132px]" />
            ),
          )}
        </div>
        <Takeaway>
          Green is better for the court. The recommended plan reaches what it lists, hears the oldest cases, and gives
          next dates that match the next procedural step instead of a flat sixty days.
        </Takeaway>
      </section>
    </div>
  );
}
