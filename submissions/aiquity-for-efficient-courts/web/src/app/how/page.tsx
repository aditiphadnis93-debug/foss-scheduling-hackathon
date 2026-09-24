"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Brain, Calculator, Clock, Gavel, LayoutDashboard, Scale, Target, Trophy } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { Card, Skeleton } from "@/components/ui/Card";
import clsx from "clsx";
import { useAsync } from "@/lib/data";
import { C } from "@/lib/theme";
import { EASE } from "@/lib/motion";
// On How it works everything is shown, whatever the Explain toggle says.
const Plain = ({ children }: { children: ReactNode }) => <>{children}</>;
const Technical = ({ children }: { children: ReactNode; hint?: string }) => <>{children}</>;
import MathsPlain from "@/components/ui/MathsPlain";
import FormulaBlock, { CORE_FORMULAS } from "@/components/ui/FormulaBlock";

function V({ children }: { children: ReactNode }) {
  return <i className="font-serif italic text-text">{children}</i>;
}
function Sub({ children }: { children: ReactNode }) {
  return <sub className="text-[0.7em]">{children}</sub>;
}
function Formula({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-line bg-surface-2 px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-faint"><span>{label}</span><span className="rounded bg-surface-2 px-1.5 py-0.5 normal-case tracking-normal">for reviewers</span></div>
      <div className="mono whitespace-pre-wrap text-[13px] leading-7 text-text [&_i]:not-italic [&_i]:font-[inherit]">{children}</div>
    </div>
  );
}

type Step = { key: string; icon: typeof Gavel; title: string; plain: string; body: ReactNode };

const STEPS: Step[] = [
  {
    key: "reality",
    icon: Gavel,
    title: "Reality",
    plain: "A judge has 420 minutes. Sixty matters are listed, twenty are reached, ten move forward.",
    body: (
      <>
        <p>
          Hearings do not fail at random. The reference data gives, for each hearing type, the chance it is substantive
          and why it fails when it does. Those reasons split by <b>when they could have been known</b>:
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          <Pill colour={C.not_ready} title="Prerequisite" text="Summons not served, filing not ready. Knowable before listing, so avoidable." />
          <Pill colour={C.adjourned} title="Attendance" text="A side absent or seeking time. Decided on the day, predictable by type and history." />
          <Pill colour={C.baseline} title="Court side" text="Administrative issue or unclear. The residual." />
        </ul>
      </>
    ),
  },
  {
    key: "model",
    icon: Brain,
    title: "Model",
    plain: "For every matter we estimate: will it go ahead, will it move forward, how long will it take.",
    body: (
      <>
        <Formula label="Chance the hearing goes ahead">
          <V>P</V>
          <Sub>ahead</Sub> = max(0.02, 1 − min(0.95, (<V>p</V>
          <Sub>absent</Sub> + <V>p</V>
          <Sub>seek</Sub>) · <V>m</V>))
        </Formula>
        <Formula label="Case history multiplier">
          <V>m</V> = 1.4<sup>[absent last time]</sup> · 1.15<sup>min(adjournments in a row, 4)</sup> · 0.5<sup>[readiness confirmed]</sup> ·
          0.85<sup>[given a time window]</sup>
        </Formula>
        <Formula label="Expected court minutes">
          E[<V>min</V>] = <V>P</V>
          <Sub>ahead</Sub> · <V>minutes</V>
          <Sub>type</Sub> + (1 − <V>P</V>
          <Sub>ahead</Sub>) · 1
        </Formula>
        <p>
          The shares are the reference numbers for the hearing type, conditional on prerequisites being met. A pending
          summons is case state, not a coin flip: the court sees most of them coming and holds those matters back.
        </p>
      </>
    ),
  },
  {
    key: "objective",
    icon: Target,
    title: "Objective",
    plain: "Value a listing by the chance it moves the case forward, weighted for justice.",
    body: (
      <>
        <Formula label="Value of listing case i">
          <V>v</V>
          <Sub>i</Sub> = <V>P</V>
          <Sub>forward,i</Sub> · (<V>w</V>
          <Sub>sub</Sub> + <V>w</V>
          <Sub>age</Sub> · age<Sub>i</Sub> + <V>w</V>
          <Sub>wait</Sub> · times listed<Sub>i</Sub> + <V>w</V>
          <Sub>fresh</Sub> · [early stage])
        </Formula>
        <p>
          Summed per judicial hour, this is the north star: <b>justice-weighted progress per judicial hour</b>. A judge&apos;s
          style is a set of weights and time slots. Two things are not configurable:
        </p>
        <Formula label="Floors enforced in code">
          <V>w</V>
          <Sub>age</Sub> ≥ 1 &nbsp;&nbsp;&nbsp; <V>α</V> ≥ 0.20 &nbsp;&nbsp;&nbsp;
          <span className="text-[14px] text-muted">(α = share of listed minutes for cases pending 4+ years)</span>
        </Formula>
        <Formula label="Automatic ageing share">
          <V>α</V>
          <Sub>auto</Sub> = min(0.6, max(0.20, 1.2 · old share of eligible minutes))
        </Formula>
      </>
    ),
  },
  {
    key: "algorithm",
    icon: Calculator,
    title: "Algorithm",
    plain: "Each sitting day, an exact optimiser picks which matters go in which slot.",
    body: (
      <>
        <p>
          <V>x</V>
          <Sub>is</Sub> = 1 if case <V>i</V> is listed in slot <V>s</V>; <V>u</V>
          <Sub>a</Sub> = 1 if advocate <V>a</V> has any matter that day.
        </p>
        <FormulaBlock lines={CORE_FORMULAS} />
        <Formula label="Maximise">
          Σ<Sub>i,s</Sub> <V>v</V>
          <Sub>i</Sub> <V>x</V>
          <Sub>is</Sub> + λ Σ<Sub>a</Sub> (<V>n</V>
          <Sub>a</Sub> − <V>u</V>
          <Sub>a</Sub>)
        </Formula>
        <Formula label="Subject to">
          Σ<Sub>s</Sub> <V>x</V>
          <Sub>is</Sub> ≤ 1 &nbsp;·&nbsp; Σ<Sub>i</Sub> E[<V>min</V>]<Sub>i</Sub> <V>x</V>
          <Sub>is</Sub> ≤ cap<Sub>s</Sub> &nbsp;·&nbsp; Σ <V>x</V> ≤ max listed &nbsp;·&nbsp; <V>u</V>
          <Sub>a</Sub> ≥ <V>x</V>
          <Sub>is</Sub> &nbsp;·&nbsp; Σ<Sub>old</Sub> E[<V>min</V>] <V>x</V> ≥ <V>α</V> Σ E[<V>min</V>] <V>x</V>
        </Formula>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Capacity is in expected minutes, so a day of short call-overs lists more than a day of evidence.</li>
          <li>Solved with the open-source CBC solver, a few seconds per day; a greedy value-per-minute planner is the fallback.</li>
          <li>Inside each slot an advocate&apos;s matters sit together; each gets a 30-minute-aligned appointment window.</li>
          <li>Next dates follow the next step&apos;s procedural gap; absence or time sought gets a short firm date.</li>
        </ul>
      </>
    ),
  },
  {
    key: "simulation",
    icon: Clock,
    title: "Simulation",
    plain: "To compare lists fairly, we run the same court forward, day by day, with the same people.",
    body: (
      <ol className="list-decimal space-y-1 pl-5">
        <li>Some cases start with an outstanding prerequisite; the court can see most, not all.</li>
        <li>Matters are called in window order. Once 420 minutes are used, the rest are not reached.</li>
        <li>Each call: prerequisite pending means not ready; otherwise the side appears, seeks time, or proceeds.</li>
        <li>A hearing that goes ahead takes a lognormal duration around the type&apos;s mean.</li>
        <li>Substantive moves the case to its next stage or disposes it; otherwise it gets a next date.</li>
        <li>Several random seeds give the spread shown on the scorecard.</li>
      </ol>
    ),
  },
  {
    key: "interface",
    icon: LayoutDashboard,
    title: "Interface",
    plain: "The judge sees the day, the reasons, and the cost of every override.",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li><b>Court day</b>: the list as a clock, with windows, chance of going ahead, why listed, outcome and next date.</li>
        <li><b>Simulation</b>: overbook, cluster, prefer fresh matters, take leave, and read the cost in one sentence.</li>
        <li><b>Backlog</b>: the age of the docket over time, cases at risk, and any case&apos;s full history.</li>
        <li><b>Annotations</b>: the judge agrees or disagrees with each prediction; that is the data that recalibrates the model.</li>
      </ul>
    ),
  },
  {
    key: "result",
    icon: Trophy,
    title: "Result",
    plain: "Same court, same people, a different list: more of the day heard, oldest cases protected, sane next dates.",
    body: (
      <p>
        See the Scorecard for every court setup against current practice on the five scored measures: utilisation,
        predictability, substantiveness, backlog age and next-date quality.
      </p>
    ),
  },
];

const LADDER = [
  { level: "L1", title: "Fixed rules", text: "Current practice and each judge's setup as a fixed rule set." },
  { level: "L2", title: "Dynamic, realistic data", text: "Per-type distributions, case history, expected-minute capacity, the exact optimiser with the ageing floor, procedural next dates, Monte Carlo." },
  { level: "L3", title: "Behaviour and agents", text: "Advocates and parties decide attendance and readiness; confirmed readiness feeds back into the list." },
  { level: "L4", title: "World model", text: "New filings arrive while the court runs; outcomes flow back into the town the disputes come from." },
  { level: "L5", title: "Plugs into the court", text: "Built: roster in; causelist, dates and time windows out through a simple API (create a roster, generate the causelist, suggest the next date); readiness confirmation is the first web check-in. Next: the court's case system, portals and SMS for check-in and cancellation." },
];

const ASSUMPTIONS = [
  "Reference duration per hearing type is the mean; actual durations are lognormal around it.",
  "Failure reasons come from the reference counts, grouped into prerequisite, attendance and court side.",
  "A side absent last time is 1.4 times as likely to fail again; each consecutive adjournment adds 15%, capped at four.",
  "A real appointment window lowers attendance failure to 85% of the all-day-wait rate; confirmed readiness halves it.",
  "The court can see 80% of outstanding prerequisites in advance.",
  "Repeated accused absence at appearance escalates to a warrant.",
  "The optimiser plans on expected values; it never sees the day's random draws.",
];

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 70%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  return (
    <div>
      <PageHeader
        eyebrow="How it works"
        title="From a crowded courtroom to a list that fits the day"
        lede="A day in court, told plainly, then every formula, and below it the complete reference of every rule the scheduler follows."
      />
      <Story />
      <div className="mb-10">
        <MathsPlain always />
      </div>
      <div ref={ref} className="relative">
        <div className="absolute bottom-0 left-[23px] top-0 w-px bg-line" />
        <motion.div className="absolute left-[23px] top-0 w-px origin-top bg-primary" style={{ scaleY: progress, bottom: 0 }} />
        <div className="flex flex-col gap-8">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: EASE }}
              className="relative grid grid-cols-[48px_1fr] gap-5"
            >
              <div className="relative z-10 grid h-12 w-12 place-items-center rounded-lg border border-line bg-bg text-primary">
                <s.icon size={20} />
              </div>
              <div className="card min-w-0 p-6">
                <p className="text-[11px] uppercase tracking-[0.16em] text-faint">
                  Step {i + 1} of {STEPS.length}
                </p>
                <h2 className="display mt-1 text-[20px]">{s.title}</h2>
                <p className="mt-1 text-[16px] text-text">{s.plain}</p>
                <Technical hint="Switch Explain to Technical (bottom of the menu) for the formulas and method.">
                  <div className="mt-4 text-[14px] leading-relaxed text-muted [&_b]:text-text">{s.body}</div>
                </Technical>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <Plain>
        <Card className="mt-10" title="What the judge can change, and what they cannot">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-[13px] font-medium text-text">You can change</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[14px] text-muted">
                <li>When the court sits and when you do chamber work</li>
                <li>How full the day is, and whether to overbook</li>
                <li>Whether one advocate&apos;s matters are kept together</li>
                <li>Whether fresh matters or old matters come first, above the floor</li>
                <li>Leave days, and how unreached matters return</li>
              </ul>
            </div>
            <div>
              <p className="text-[13px] font-medium text-text">You cannot go below</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[14px] text-muted">
                <li>At least a fifth of listed court time for cases over four years old</li>
                <li>An average of three and a half hours of hearings a day</li>
                <li>A daily reserve for urgent and emergency matters</li>
                <li>The checklist before a matter is listed</li>
              </ul>
            </div>
          </div>
        </Card>
      </Plain>
      <Technical>
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <Card title="Stated assumptions" subtitle="Unstated assumptions are worse than stated ones.">
          <ul className="flex flex-col gap-2 text-[14px] text-muted">
            {ASSUMPTIONS.map((a) => (
              <li key={a} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ours" />
                {a}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="The complexity ladder" subtitle="Each level plugs into the same planner through a narrow interface.">
          <div className="flex flex-col gap-3">
            {LADDER.map((l, i) => (
              <motion.div
                key={l.level}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.12, ease: EASE, duration: 0.5 }}
                className="flex gap-4 rounded-lg border border-line bg-surface-2 p-3"
                style={{ marginLeft: i * 14 }}
              >
                <span className="num grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-subtle text-[14px] font-semibold text-primary">
                  {l.level}
                </span>
                <span>
                  <span className="block text-[14px] font-medium text-text">{l.title}</span>
                  <span className="block text-[13px] text-muted">{l.text}</span>
                </span>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 text-[12px] text-faint">
            <Scale size={14} /> The causelist logic never changes when behaviour gets richer.
          </div>
        </Card>
      </div>
      </Technical>
      <Reference />
    </div>
  );
}

function Pill({ colour, title, text }: { colour: string; title: string; text: string }) {
  return (
    <li className="rounded-lg border border-line bg-surface-2 p-3">
      <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: colour }}>
        <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
        {title}
      </span>
      <span className="mt-1 block text-[13px] text-muted">{text}</span>
    </li>
  );
}

const STORY: { title: string; text: string }[] = [
  {
    title: "Every morning, a list that fits the day",
    text: "Before court opens, the judge gets a list sized to the hours the court actually sits, not a pile of sixty files. Each matter has a time window, so parties come at eleven, not at ten to wait all day.",
  },
  {
    title: "Why a matter is on the list",
    text: "Each matter says why it was chosen: how likely it is to move forward today, how long it has waited, whether it missed its turn last time. Cases over four years old always get their share of the day.",
  },
  {
    title: "Why a matter is not on the list",
    text: "If a summons has not been served or a filing is missing, the matter is kept off the list and the parties are told before they travel. It returns when it is ready.",
  },
  {
    title: "Why this next date",
    text: "The next date follows what the next step needs: a short date to return a summons, a longer one before evidence. When someone asks for time, the date is short and firm.",
  },
  {
    title: "When people do not come",
    text: "If a side is absent or unready, the matter is adjourned with a short firm date, and time freed up is given to standby matters whose advocates are already in court.",
  },
  {
    title: "When the day changes",
    text: "An urgent bail matter is heard from the reserve kept each day. If the judge is called away, the rest of the list moves to the next sitting with priority. Every change is written down with its reason.",
  },
];

function Story() {
  return (
    <div className="mb-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {STORY.map((x, i) => (
        <motion.div
          key={x.title}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: i * 0.06, ease: EASE }}
          className="card p-5"
        >
          <p className="num text-[12px] text-primary">{String(i + 1).padStart(2, "0")}</p>
          <p className="mt-1 text-[16px] font-semibold text-text">{x.title}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{x.text}</p>
        </motion.div>
      ))}
    </div>
  );
}

type Section = {
  id: string;
  title: string;
  plain?: string[];
  steps?: string[];
  table?: { head: string[]; rows: (string | number)[][] };
  technical?: string[];
};

const load = () =>
  fetch("/data/how_it_works.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ sections: Section[] }>) : null))
    .then((d) => d?.sections ?? [])
    .catch(() => [] as Section[]);


function Reference() {
  const sections = useAsync(load, []);
  const [active, setActive] = useState<string>("overview");
  useEffect(() => {
    if (!sections?.length) return;
    const obs = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [sections]);

  return (
    <div className="mt-12">
      <p className="text-[12px] uppercase tracking-[0.14em] text-primary">The complete reference</p>
      <h2 className="display mb-6 mt-1 text-[28px]">Every rule, section by section</h2>
      {!sections ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          <nav className="hidden lg:block" aria-label="Sections">
            <ol className="scroll-thin sticky top-6 flex max-h-[calc(100vh-48px)] flex-col gap-0.5 overflow-y-auto pr-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={clsx("block rounded-md px-2 py-1 text-[13px] leading-snug transition-colors", active === s.id ? "bg-primary-subtle font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-text")}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="flex min-w-0 flex-col gap-5">
            {sections.map((s) => (
              <motion.section
                key={s.id}
                id={s.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.45, ease: EASE }}
                className="card scroll-mt-6 p-5 md:p-6"
              >
                <h2 className="display text-[20px] md:text-[22px]">{s.title}</h2>
                {s.plain?.map((p, i) => (
                  <p key={i} className="mt-3 text-[15px] leading-relaxed text-text">
                    {p}
                  </p>
                ))}
                {!!s.steps?.length && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {s.steps.map((st, i) => (
                      <span key={i} className="flex items-center gap-2">
                        <span className="rounded-full bg-primary-subtle px-3 py-1 text-[13px] text-primary">{st}</span>
                        {i < s.steps!.length - 1 && <ArrowRight size={14} className="text-faint" />}
                      </span>
                    ))}
                  </div>
                )}
                {s.table && (
                  <div className="scroll-thin mt-4 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-[13px]">
                      <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
                        <tr>
                          {s.table.head.map((h) => (
                            <th key={h} className="border-b border-line py-2 pr-4 font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.table.rows.map((r, i) => (
                          <tr key={i} className="border-b border-line align-top">
                            {r.map((c, j) => (
                              <td key={j} className={clsx("py-2 pr-4", j === 0 ? "font-medium text-text" : "text-muted")}>
                                {String(c)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!s.technical?.length && (
                  <div className="mt-4">
                    <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-faint">The exact rule</p>
                    <pre className="mono scroll-thin overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-4 text-[12.5px] leading-6 text-text">
                      {s.technical.join("\n")}
                    </pre>
                  </div>
                )}
              </motion.section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
