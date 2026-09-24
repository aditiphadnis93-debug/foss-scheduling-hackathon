"use client";

/**
 * /case/[id]: the Case File. Where the dispute began in the town, then the court lifecycle
 * phase by phase: every listing, outcome, reason, who the delay was on, the next date and the
 * rule behind it, what it cost each party.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Briefcase, CheckCircle2, Circle, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  OUTCOME_COLOR, OUTCOME_LABEL, STEP_LABEL, fmtDate, fmtMoney, isHearingType, loadWorld, pretty, type OutcomeKind, type World,
} from "@/lib/world";
import { listAgentScenarios, loadAgents, type Agent, type AgentsData } from "@/lib/people";
import { STAGES, auditFor, fetchRun, inferStakeholder, parseWindow, type RawRun } from "@/lib/world-case";
import { Panel } from "./ui";

const MUTED = "text-[var(--text-muted,var(--muted,#65758B))]";
const BORDER = "border-[var(--border,var(--line,#E1E7EF))]";

type Row = {
  day: string; window: string; purpose: string; outcome: OutcomeKind | null; reason: string | null;
  nextDate: string | null; nextPurpose: string | null; stakeholder: string | null; inferred: boolean; why: string[]; rule: string | null;
};

const OUTCOMES: OutcomeKind[] = ["substantive", "adjourned", "not_reached", "not_ready"];
const asOutcome = (v: unknown) => (OUTCOMES.includes(v as OutcomeKind) ? (v as OutcomeKind) : null);

export default function CaseFile({ caseId }: { caseId: string }) {
  const [world, setWorld] = useState<World | null>(null);
  const [run, setRun] = useState<RawRun | null>(null);
  const [agents, setAgents] = useState<AgentsData[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadWorld().catch(() => null),
      fetchRun<RawRun>(),
      listAgentScenarios().then((l) => Promise.all(l.filter((s) => s.id !== "demo").map((s) => loadAgents(s.id).catch(() => null)))).catch(() => []),
    ]).then(([w, r, a]) => {
      if (!alive) return;
      setWorld(w);
      setRun(r);
      const list: (AgentsData | null)[] = a ?? [];
      setAgents(list.filter((x): x is AgentsData => x != null && !x.mock));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);

  const dispute = useMemo(() => {
    if (!world) return null;
    const k = world.disputeOfCase.get(caseId);
    return k != null ? world.disputes[k] : null;
  }, [world, caseId]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const runByDay = new Map<string, NonNullable<RawRun["days"]>[number]["listings"]>();
    for (const d of run?.days ?? []) runByDay.set(d.date, d.listings);
    // the town's own causelist first (same simulation as the dispute), else the run export
    const fromWorld = world ? world.days.flatMap((d) => d.lines.filter((l) => l.caseId === caseId).map((l) => ({ d, l }))) : [];
    if (fromWorld.length) {
      for (const { d, l } of fromWorld) {
        const rl = runByDay.get(d.date)?.find((x) => x.case_id === caseId);
        const sh = l.stakeholder ?? rl?.outcome?.stakeholder ?? rl?.stakeholder ?? null;
        out.push({
          day: d.date, window: l.window, purpose: l.purpose, outcome: l.outcome, reason: l.reason, nextDate: l.nextDate,
          nextPurpose: rl?.outcome?.next_purpose ?? null, stakeholder: sh ?? inferStakeholder(l.outcome, l.reason), inferred: !sh,
          why: rl?.why ?? [], rule: rl?.outcome?.rule ?? null,
        });
      }
    } else {
      for (const d of run?.days ?? []) for (const l of d.listings ?? []) {
        if (l.case_id !== caseId) continue;
        const kind = asOutcome(l.outcome?.kind);
        const sh = l.outcome?.stakeholder ?? l.stakeholder ?? null;
        out.push({
          day: d.date, window: l.start && l.end ? `${l.start}-${l.end}` : "", purpose: String(l.purpose ?? ""), outcome: kind,
          reason: l.outcome?.reason ?? null, nextDate: l.outcome?.next_date ?? null, nextPurpose: l.outcome?.next_purpose ?? null,
          stakeholder: sh ?? inferStakeholder(kind, l.outcome?.reason ?? null), inferred: !sh, why: l.why ?? [], rule: l.outcome?.rule ?? null,
        });
      }
    }
    return out;
  }, [world, run, caseId]);

  const audit = useMemo(() => auditFor(run, caseId), [run, caseId]);
  const info = run?.cases?.[caseId] as Record<string, unknown> | undefined;
  const parties = useMemo(() => {
    const seen = new Map<string, Agent>();
    for (const a of agents) for (const ag of a.agents) if (ag.caseIds.includes(caseId) && !seen.has(ag.id)) seen.set(ag.id, ag);
    return [...seen.values()];
  }, [agents, caseId]);
  const checklist = (Array.isArray(info?.checklist) ? info!.checklist : []) as unknown[];

  if (!loaded) return <div className={clsx("py-20 text-center text-sm", MUTED)}>Opening the case file</div>;

  const visited = new Set(rows.map((r) => r.purpose));
  const current = String(info?.stage_end ?? info?.purpose_end ?? rows[rows.length - 1]?.nextPurpose ?? rows[rows.length - 1]?.purpose ?? "");
  const origin = dispute?.steps.filter((s) => !isHearingType(s.type) && s.type !== "judgement") ?? [];
  const a = dispute && world ? world.people[dispute.a] : null;
  const b = dispute && world ? world.people[dispute.b] : null;
  const delays = rows.filter((r) => r.outcome && r.outcome !== "substantive");
  const byStake = new Map<string, number>();
  for (const r of delays) if (r.stakeholder) byStake.set(r.stakeholder, (byStake.get(r.stakeholder) ?? 0) + 1);

  return (
    <div className="pb-16 text-[var(--text)]">
      <Link href="/world" className={clsx("inline-flex items-center gap-1 text-xs hover:underline", MUTED)}><ArrowLeft size={12} /> Back to the town</Link>
      <header className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--primary,#2463EB)]">Case file</div>
        <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight">{caseId}</h1>
        <p className={clsx("mt-1 text-sm", MUTED)}>
          {a && b ? <>{a.name} v. {b.name}{dispute?.kindLabel && <> · {dispute.kindLabel}</>}{dispute?.amount != null && <> · {fmtMoney(dispute.amount)}</>}</> : info?.party ? <>Party {String(info.party)}</> : "Case"}
          {info?.filing_date ? <> · filed {fmtDate(String(info.filing_date))}</> : dispute?.filedDay != null && dispute.filedDay >= 0 && world ? <> · filed {fmtDate(world.days[Math.min(dispute.filedDay, world.days.length - 1)].date)}</> : null}
          {info?.status_end ? <> · {String(info.status_end)} at the end of the window</> : dispute ? <> · {pretty(dispute.finalState)}</> : null}
        </p>
      </header>

      {!rows.length && !dispute && <Panel flat className="mt-6 p-5 text-sm">No record of this case yet.</Panel>}

      {(rows.length > 0 || dispute) && (
        <SidesPanel world={world} dispute={dispute} rows={rows} checklist={checklist} parties={parties} />
      )}

      {/* 1. origin in the town */}
      {dispute && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">1 · Where it began</h2>
          <Panel flat className="mt-2 p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="space-y-2 text-sm">
                {[{ p: a, role: "Complainant", idx: dispute.a }, { p: b, role: "Accused", idx: dispute.b }].map(({ p, role, idx }) => p && (
                  <div key={role} className={clsx("rounded-lg border p-3", BORDER)}>
                    <div className={clsx("text-[11px] uppercase tracking-wider", MUTED)}>{role}</div>
                    <div className="font-medium">{p.name}</div>
                    <div className={clsx("text-xs", MUTED)}>{p.occupation}, {p.neighbourhood} · wage {fmtMoney(p.wage)}/day</div>
                    <div className="mt-1 text-xs">{world!.personTrips[idx]} trips to court · <span className="text-[var(--c-adjourned,#F59F0A)]">{fmtMoney(world!.personWages[idx])} wages lost</span> in this window</div>
                  </div>
                ))}
                <div className={clsx("text-xs", MUTED)}>{dispute.kindLabel ?? pretty(dispute.kind)}{dispute.amount != null && <> · {fmtMoney(dispute.amount)} at stake</>}{dispute.forum && dispute.forum !== "this_court" && <> · heard by {dispute.forum}</>} · origin: {dispute.origin === "world" ? "a quarrel in the town" : "already on the docket"}</div>
              </div>
              <ol className="space-y-2">
                {origin.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={clsx("w-20 shrink-0 font-mono text-xs", MUTED)}>{fmtDate(s.day, { day: "numeric", month: "short", year: "2-digit" })}</span>
                    <span><span className="font-medium">{STEP_LABEL[s.type] ?? pretty(s.type)}.</span> <span className={MUTED}>{s.text}</span></span>
                  </li>
                ))}
                {dispute.story && <li className={clsx("border-t pt-2 text-xs leading-relaxed", BORDER, MUTED)}>{dispute.story}</li>}
              </ol>
            </div>
          </Panel>
        </section>
      )}

      {/* 2. the court lifecycle */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">{dispute ? "2 · " : ""}The court&apos;s record</h2>
        <Panel flat className="mt-2 overflow-x-auto p-5">
          <div className="flex min-w-[860px] items-center">
            {STAGES.map((st, i) => {
              const here = st === current;
              const done = visited.has(st) || (STAGES.indexOf(current) > i && current !== "");
              return (
                <div key={st} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <span className={clsx("flex h-6 w-6 items-center justify-center rounded-full border-2",
                      here ? "border-[var(--primary,#2463EB)] bg-[var(--primary,#2463EB)] text-white" : done ? "border-[var(--c-substantive,#10B77F)] text-[var(--c-substantive,#10B77F)]" : clsx(BORDER, MUTED))}>
                      {done && !here ? <CheckCircle2 size={13} /> : <Circle size={8} fill="currentColor" />}
                    </span>
                    <span className={clsx("w-[74px] text-[10px] leading-tight", here ? "font-semibold" : MUTED)}>{pretty(st)}</span>
                  </div>
                  {i < STAGES.length - 1 && <div className={clsx("mx-1 mb-5 h-0.5 flex-1", done ? "bg-[var(--c-substantive,#10B77F)]" : "bg-[var(--border,var(--line,#E1E7EF))]")} />}
                </div>
              );
            })}
          </div>
          {byStake.size > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className={MUTED}>Delays in this window were on:</span>
              {[...byStake.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => (
                <span key={k} className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5">{k} <span className="font-mono">{v}</span></span>
              ))}
            </div>
          )}
        </Panel>

        <div className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const col = r.outcome ? OUTCOME_COLOR[r.outcome] : "var(--c-baseline,#9CA3B0)";
            const dayAudit = audit.filter((x) => x.day === r.day);
            return (
              <motion.div key={`${r.day}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }}>
                <Panel flat className="grid gap-3 p-4 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]" >
                  <div>
                    <div className="font-mono text-sm font-semibold">{fmtDate(r.day, { day: "numeric", month: "short" })}</div>
                    <div className={clsx("font-mono text-xs", MUTED)}>{r.window}</div>
                  </div>
                  <div className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{pretty(r.purpose)}</span>
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: col, background: `color-mix(in srgb, ${col} 12%, transparent)` }}>
                        {r.outcome ? OUTCOME_LABEL[r.outcome] : "Not recorded"}
                      </span>
                    </div>
                    {r.reason && <div className={clsx("mt-1 text-xs", MUTED)}>Reason: {r.reason}</div>}
                    {r.stakeholder && <div className="mt-1 text-xs">Responsible: <span className="font-medium">{r.stakeholder}</span>{r.inferred && <span className={MUTED}> (inferred from the reason)</span>}</div>}
                  </div>
                  <div className="text-xs">
                    {r.nextDate ? <div>Next date <span className="font-mono font-semibold">{fmtDate(r.nextDate, { day: "numeric", month: "short" })}</span>{r.nextPurpose && <> for {pretty(r.nextPurpose)}</>}</div> : <div className={MUTED}>No next date in the window</div>}
                    {(r.rule || dayAudit.length > 0) && <div className="mt-1">Rule: {[r.rule, ...dayAudit.map((x) => x.text)].filter(Boolean).join(" · ")}</div>}
                    {r.why.length > 0 && <div className={clsx("mt-1", MUTED)}>Why listed: {r.why.join(" · ")}</div>}
                  </div>
                </Panel>
              </motion.div>
            );
          })}
          {!rows.length && <div className={clsx("text-sm", MUTED)}>No listings for this case in the window.</div>}
        </div>
      </section>

      {/* 3. the people */}
      {parties.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">What it cost the people</h2>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {parties.map((p) => (
              <Panel flat key={p.id} className="p-4">
                <div className="flex items-center gap-2 text-sm">
                  {p.role === "advocate" ? <Briefcase size={14} /> : <User size={14} />}
                  <span className="font-mono font-semibold">{p.name}</span>
                  <span className={clsx("text-xs capitalize", MUTED)}>{p.role}</span>
                  <Link href={`/people?agent=${encodeURIComponent(p.id)}`} className="ml-auto text-xs text-[var(--primary,#2463EB)] hover:underline">Every listing</Link>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                  {[["Listed", p.totals.listings], ["Trips", p.totals.trips], ["Wasted", p.totals.wasted], ["Wages lost", fmtMoney(p.totals.wages)]].map(([k, v]) => (
                    <div key={String(k)} className="rounded-md bg-[var(--surface-2)] py-1.5"><div className="font-mono text-sm font-semibold">{v}</div><div className={MUTED}>{k}</div></div>
                  ))}
                </div>
                {p.steps.filter((s) => s.caseId === caseId).slice(-3).map((s, i) => (
                  <div key={i} className={clsx("mt-2 text-xs", MUTED)}><span className="font-mono">{fmtDate(s.day, { day: "numeric", month: "short" })}</span> {s.appear ? "came" : "stayed away"}: {s.rationale}</div>
                ))}
              </Panel>
            ))}
          </div>
        </section>
      )}

      {/* 4. checklist */}
      {checklist.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Before the next hearing</h2>
          <Panel flat className="mt-2 space-y-1.5 p-4 text-sm">
            {checklist.map((c, i) => {
              const o = (typeof c === "object" && c ? c : { item: String(c) }) as { item?: string; text?: string; done?: boolean; owner?: string };
              return (
                <div key={i} className="flex items-center gap-2">
                  {o.done ? <CheckCircle2 size={14} className="text-[var(--c-substantive,#10B77F)]" /> : <Circle size={14} className={MUTED} />}
                  <span>{o.item ?? o.text}</span>{o.owner && <span className={clsx("text-xs", MUTED)}>· {o.owner}</span>}
                </div>
              );
            })}
          </Panel>
        </section>
      )}
    </div>
  );
}

type Party = { key: string; role: string; name: string; hood: string; trips: number; wagesLost: number | null };

/** plain-language view for the people in the case: what they can see, what they can do, who can help */
function SidesPanel({ world, dispute, rows, checklist, parties }: {
  world: World | null; dispute: World["disputes"][number] | null; rows: Row[]; checklist: unknown[]; parties: Agent[];
}) {
  const last = rows[rows.length - 1];
  const nextDate = last?.nextDate ?? null;
  const windowMins = rows.map((r) => r.window).filter(Boolean).map((w) => { const [a, b] = parseWindow(w); return b - a; }).filter((x) => x > 0);
  const hasWindow = windowMins.length > 0;
  const halfWindowH = hasWindow ? windowMins.reduce((t, x) => t + x, 0) / windowMins.length / 2 / 60 : 0;
  const waitPerTrip = hasWindow ? halfWindowH : 5;
  const published = !!(last && dispute?.published.some((d) => d >= last.day));

  const open = checklist
    .map((c) => (typeof c === "object" && c ? c : { item: String(c) }) as { item?: string; text?: string; done?: boolean; owner?: string })
    .filter((c) => !c.done)
    .map((c) => `${c.item ?? c.text ?? ""}${c.owner ? ` (${c.owner})` : ""}`)
    .filter(Boolean);
  const lastReason = (last?.reason ?? "").toLowerCase();
  const summonsPending = rows.some((r) => /summons|process|warrant/i.test(r.reason ?? ""));
  if (!open.length && last && last.outcome !== "substantive") {
    if (/summons|process|warrant/.test(lastReason)) open.push("Summons or warrant to be served on the accused");
    else if (/evidence|filing/.test(lastReason)) open.push("Papers or evidence still to be filed");
  }
  const reasonText = !last ? "No hearing yet in this window."
    : last.outcome === "substantive" && !last.nextDate && last.purpose === "JUDGEMENT" ? "Judgement was delivered; there is no further date."
    : last.outcome === "substantive" ? `The last hearing moved the case forward${last.nextPurpose ? ` to ${pretty(last.nextPurpose).toLowerCase()}` : ""}.`
    : last.reason ? `Last time: ${last.reason}.` : `Last time the case was ${OUTCOME_LABEL[last.outcome ?? "adjourned"].toLowerCase()}.`;

  const sides: Party[] = [];
  if (dispute && world) {
    const a = world.people[dispute.a], b = world.people[dispute.b];
    sides.push({ key: "c", role: "Complainant", name: a.name, hood: a.neighbourhood, trips: world.personTrips[dispute.a], wagesLost: world.personWages[dispute.a] });
    if (dispute.b !== dispute.a) sides.push({ key: "a", role: "Accused", name: b.name, hood: b.neighbourhood, trips: world.personTrips[dispute.b], wagesLost: world.personWages[dispute.b] });
  } else {
    for (const p of parties.filter((x) => x.role === "litigant")) sides.push({ key: p.id, role: "Party", name: p.name, hood: "", trips: p.totals.trips, wagesLost: p.totals.wages });
  }
  const advocate = dispute && world ? dispute.advocates.map((i) => world.advocates[i]?.name).filter(Boolean)[0] : parties.find((p) => p.role === "advocate")?.name;
  const courtName = world?.court.name ?? "The court";
  const accusedHood = dispute && world ? world.people[dispute.b]?.neighbourhood : "";

  const chip = (label: string) => (
    <span key={label} aria-disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-dashed border-[var(--border,var(--line,#E1E7EF))] px-3 py-1 text-xs text-[var(--text-muted,var(--muted,#65758B))]">
      {label}<span className="rounded-full bg-[var(--surface-2)] px-1.5 py-px text-[9.5px] uppercase tracking-wider">portal: next stage</span>
    </span>
  );

  return (
    <section className="mt-6 grid gap-3 lg:grid-cols-3">
      <Panel flat className="p-4">
        <h2 className="text-sm font-semibold">What each side can see</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className={clsx("text-xs", MUTED)}>Next date</dt>
            <dd className="font-medium">{nextDate ? fmtDate(nextDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Not fixed yet"}
              {nextDate && last?.window && <span className={clsx("ml-1 font-mono text-xs", MUTED)}>usual window {last.window}</span>}</dd></div>
          <div><dt className={clsx("text-xs", MUTED)}>Is it firm?</dt>
            <dd>{nextDate ? (published ? "Published on the court\u2019s list" : "Provisional, not yet published") : "-"}</dd></div>
          <div><dt className={clsx("text-xs", MUTED)}>Still to be done before it</dt>
            <dd>{open.length ? <ul className="list-disc pl-4">{open.map((o) => <li key={o}>{o}</li>)}</ul> : "Nothing pending on record"}</dd></div>
          <div><dt className={clsx("text-xs", MUTED)}>Why this date</dt><dd>{reasonText}</dd></div>
        </dl>
      </Panel>
      <Panel flat className="p-4">
        <h2 className="text-sm font-semibold">What they can do</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {chip("Confirm they are ready, ahead of the date")}
          {chip("Check in on the day")}
          {chip("Ask to reschedule in advance, instead of not turning up")}
          {chip("File the missing paper")}
        </div>
        <h3 className="mt-5 text-sm font-semibold">Hours of life this case has cost</h3>
        <div className="mt-2 space-y-2">
          {sides.map((p) => {
            const hours = p.trips * (2 + waitPerTrip);
            return (
              <div key={p.key} className="flex items-baseline justify-between text-sm">
                <span>{p.name} <span className={clsx("text-xs", MUTED)}>{p.role.toLowerCase()}</span></span>
                <span className="font-mono"><span className="font-semibold">{Math.round(hours)} h</span>
                  <span className={clsx("ml-1 text-xs", MUTED)}>{p.trips} trips{p.wagesLost ? ` · ${fmtMoney(p.wagesLost)} wages` : ""}</span></span>
              </div>
            );
          })}
          {!sides.length && <div className={clsx("text-sm", MUTED)}>No party record.</div>}
          <p className={clsx("text-[11px]", MUTED)}>2 hours of travel per trip, plus waiting: {hasWindow ? `half the time window (about ${halfWindowH.toFixed(1)} h)` : "5 hours when no time window is given"}.</p>
        </div>
      </Panel>
      <Panel flat className="p-4">
        <h2 className="text-sm font-semibold">Who can help</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li><div className="font-medium">{advocate ?? "Their advocate"}</div><div className={clsx("text-xs", MUTED)}>Advocate on record{advocate ? "" : " (not named in the data)"}</div></li>
          <li><div className="font-medium">{courtName} help desk</div><div className={clsx("text-xs", MUTED)}>Dates, copies of orders, where to go on the day</div></li>
          <li><div className="font-medium">Legal aid clinic{sides[1]?.hood ? `, ${sides[1].hood}` : sides[0]?.hood ? `, ${sides[0].hood}` : ""}</div><div className={clsx("text-xs", MUTED)}>Free advice, and an advocate for a side that has none</div></li>
          {summonsPending && (
            <li><div className="font-medium">{accusedHood ? `${accusedHood} police station` : "Local police station"} and the court process server</div><div className={clsx("text-xs", MUTED)}>Responsible for serving the pending summons or warrant</div></li>
          )}
        </ul>
      </Panel>
    </section>
  );
}
