"use client";

/** Who this person is, what the court has cost them, and how their decisions are made. */
import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { PEOPLE_COLOR, STATE_COLOR, STATE_LABEL, fmtDate, fmtMoney, type World } from "@/lib/world";
import { TRAIT_LABEL, traitValue, type Agent } from "@/lib/people";
import { caseHref, isAiDecision } from "@/lib/world-case";

export type AiPrompts = { agent?: { system_prompt?: string; what_the_agent_is_given?: Record<string, string> | string[]; what_it_returns?: string } };

const MUTED = "text-[var(--text-muted,var(--muted,#65758B))]";
const STATE_MEANING = [
  "No open dispute in this window.",
  "Has an open quarrel or legal notice, not yet in court.",
  "Has a case in court in this window.",
  "Their dispute has been settled or decided.",
];

export default function PersonCard({ world, personIdx, day, agent, prompts }: { world: World; personIdx: number; day: number; agent: Agent | null; prompts: AiPrompts | null }) {
  const [showGiven, setShowGiven] = useState(false);
  const [tech, setTech] = useState(false);
  const p = world.people[personIdx];
  if (!p) return null;
  const st = world.days[day]?.states[personIdx] ?? 0;
  const dx = p.x - world.court.x, dy = p.y - world.court.y;
  const km = agent?.traits.find(([k]) => k === "travel_km")?.[1];
  const cases = [...new Set(world.disputesOf[personIdx].map((k) => world.disputes[k].caseId).filter((c): c is string => !!c))];
  const steps = agent?.steps.filter((s) => s.called) ?? [];
  const ai = steps.some((s) => isAiDecision(s.source));
  const given = prompts?.agent?.what_the_agent_is_given;
  const givenList = Array.isArray(given) ? given.map((g) => ["", String(g)]) : Object.entries(given ?? {});
  const frustration = agent?.drift.length ? agent.drift[agent.drift.length - 1].value : null;
  return (
    <div className="border-b border-[var(--border,var(--line,#E1E7EF))] p-5">
      <div className={clsx("text-[11px] uppercase tracking-[0.2em]", MUTED)}>Resident</div>
      <div className="mt-1 text-lg font-semibold">{p.name}</div>
      <div className={clsx("text-sm", MUTED)}>{p.occupation} · {p.neighbourhood} · wage {fmtMoney(p.wage)}/day</div>
      <div className={clsx("text-xs", MUTED)}>{km != null ? `${km.toFixed(1)} km from the court` : `${Math.round(Math.hypot(dx, dy))} map units from the court`}</div>
      <div className="mt-3 flex items-start gap-2 text-sm">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[st] }} />
        <span><span className="font-medium">{STATE_LABEL[st]}</span> <span className={MUTED}>· {STATE_MEANING[st]}</span></span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md bg-[var(--surface-2)] py-1.5"><div className="font-mono text-sm font-semibold">{world.personTrips[personIdx]}</div><div className={MUTED}>trips to court</div></div>
        <div className="rounded-md bg-[var(--surface-2)] py-1.5"><div className="font-mono text-sm font-semibold">{fmtMoney(world.personWages[personIdx])}</div><div className={MUTED}>wages lost</div></div>
        <div className="rounded-md bg-[var(--surface-2)] py-1.5"><div className="font-mono text-sm font-semibold">{frustration != null ? `${Math.round(frustration * 100)}%` : "-"}</div><div className={MUTED}>willing to come</div></div>
      </div>
      {cases.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {cases.map((c) => <Link key={c} href={caseHref(c)} className="rounded-md bg-[var(--primary-subtle,#F0F6FF)] px-2 py-1 font-mono text-[var(--primary-strong,#1E3B8A)] hover:underline">{c}</Link>)}
        </div>
      )}
      {agent && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            How this person decides
            {ai && <span className="rounded bg-[var(--primary-subtle,#F0F6FF)] px-1.5 py-px text-[10px] font-semibold text-[var(--primary-strong,#1E3B8A)]">AI agent</span>}
          </div>
          {agent.traits.length > 0 && (
            <div className={clsx("mt-1 text-xs", MUTED)}>{agent.traits.map(([k, v]) => `${TRAIT_LABEL[k] ?? k} ${traitValue(k, v)}`).join(" · ")}</div>
          )}
          <ul className="mt-2 space-y-2">
            {steps.slice(-6).map((s, i) => (
              <li key={i} className="rounded-md border border-[var(--border,var(--line,#E1E7EF))] p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{fmtDate(s.day, { day: "numeric", month: "short" })}</span>
                  <span className="font-mono text-[var(--primary-strong,#1E3B8A)]">{s.caseId}</span>
                  <span style={{ color: s.appear ? PEOPLE_COLOR.court : PEOPLE_COLOR.dispute }}>{s.appear ? (s.seek ? "came, asked for time" : s.ready ? "came, ready" : "came, not ready") : "stayed away"}</span>
                  {isAiDecision(s.source) && <span className="ml-auto rounded bg-[var(--primary-subtle,#F0F6FF)] px-1 text-[9.5px] font-semibold text-[var(--primary-strong,#1E3B8A)]">AI</span>}
                </div>
                {s.pAppear != null && <div className={MUTED}>Chance they turn up {Math.round(s.pAppear * 100)}%{s.pAppearStat != null && ` (court-wide average ${Math.round(s.pAppearStat * 100)}%)`}</div>}
                {s.rationale && <div className="mt-0.5">{s.rationale}</div>}
              </li>
            ))}
            {!steps.length && <li className={clsx("text-xs", MUTED)}>No listing called in this run.</li>}
          </ul>
          {ai && prompts?.agent && (
            <div className="mt-3 text-xs">
              <button type="button" onClick={() => setShowGiven((v) => !v)} className="font-medium text-[var(--primary,#2463EB)] hover:underline">
                {showGiven ? "Hide" : "Show"} what the AI is given and asked
              </button>
              {showGiven && (
                <div className="mt-2 space-y-1.5">
                  <ul className="list-disc space-y-1 pl-4">
                    {givenList.map(([k, v]) => <li key={k + v}>{k && <span className="font-medium">{(k as string).replace(/_/g, " ")}: </span>}{v as string}</li>)}
                  </ul>
                  {prompts.agent.what_it_returns && <p><span className="font-medium">It returns: </span>{prompts.agent.what_it_returns}</p>}
                  <button type="button" onClick={() => setTech((v) => !v)} className={clsx("hover:underline", MUTED)}>{tech ? "Hide" : "Show"} technical detail</button>
                  {tech && <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-2)] p-2 font-mono text-[10.5px]">{prompts.agent.system_prompt}</pre>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
