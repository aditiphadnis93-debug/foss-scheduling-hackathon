"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FlaskConical, Loader2, Send, Sparkles, Wand } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Controls";
import { DeltaPill } from "@/components/ui/Stat";
import { apiHealthy } from "@/lib/api";
import { LEVERS, PREFILL_KEY, askForProposal, leverValue, loadAssistant, loadProposals, type Proposal } from "@/lib/agents";
import { fmtMetric, meta } from "@/lib/metrics";
import { EASE } from "@/lib/motion";

type Msg = { id: number; role: "judge"; text: string } | { id: number; role: "assistant"; item: Proposal | null; pending?: boolean; note?: string };

export default function AssistantPage() {
  const router = useRouter();
  const [examples, setExamples] = useState<Proposal[]>([]);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [day, setDay] = useState("2026-09-28");
  const idRef = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    loadProposals().then(async (items) => {
      if (!on) return;
      if (items.length) {
        setExamples(items);
        if (items[0].day) setDay(items[0].day);
        return;
      }
      // Until proposals are exported, offer the recorded questions as examples (answers without a proposal).
      const a = await loadAssistant();
      const first = a ? Object.keys(a.answers ?? {})[0] : undefined;
      if (a && first && on) {
        setDay(first);
        setExamples((a.questions ?? []).map((q) => ({ question: q, day: first, ...(a.answers[first]?.[q] ?? { answer: "" }) })));
      }
    });
    apiHealthy().then((ok) => on && setEngine(ok));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  const next = () => idRef.current++;
  const pick = (p: Proposal) => {
    setThread((t) => [...t, { id: next(), role: "judge", text: p.question }, { id: next(), role: "assistant", item: p }]);
  };
  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    const aid = next();
    setThread((t) => [...t, { id: next(), role: "judge", text: q }, { id: aid, role: "assistant", item: null, pending: true }]);
    const res = engine === false ? null : await askForProposal(q, day);
    if (!res) setEngine(false);
    setThread((t) =>
      t.map((m) =>
        m.id === aid
          ? { id: aid, role: "assistant", item: res, note: res ? undefined : "Live answers need the local engine. Try one of the recorded examples above." }
          : m,
      ),
    );
  };
  const apply = (p: Proposal) => {
    try {
      localStorage.setItem(PREFILL_KEY, JSON.stringify({ overrides: p.proposal ?? {}, why: p.why ?? p.answer, question: p.question }));
    } catch {}
    router.push("/whatif?from=assistant");
  };

  return (
    <div>
      <PageHeader
        eyebrow="Court assistant"
        title="Describe a problem. Get a change you can test."
        lede="The assistant explains, proposes and tests. You decide."
        right={
          <span className="flex items-center gap-2 text-[12px] text-muted">
            <span className={clsx("h-2 w-2 rounded-full", engine ? "bg-green" : "bg-[var(--c-baseline)]")} />
            {engine ? "Live engine connected" : engine === false ? "Recorded examples (live needs the local engine)" : "Checking the engine…"}
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="flex min-h-[560px] flex-col">
          <div className="mb-4 flex flex-wrap gap-2">
            {examples.slice(0, 3).map((p) => (
              <button key={p.question} onClick={() => pick(p)} className="rounded-full border border-line px-3 py-1.5 text-left text-[13px] text-text transition-colors hover:border-primary hover:bg-primary-subtle">
                {p.question}
              </button>
            ))}
          </div>
          <div className="scroll-thin flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {thread.length === 0 && (
              <div className="grid flex-1 place-items-center text-center text-[14px] text-muted">
                <div>
                  <Sparkles className="mx-auto mb-2 text-primary" size={22} />
                  Pick an example above, or type what is going wrong in your court.
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {thread.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  {m.role === "judge" ? (
                    <div className="ml-auto max-w-[80%] rounded-lg bg-primary px-4 py-2.5 text-[14px] text-on-primary">{m.text}</div>
                  ) : m.pending ? (
                    <div className="flex max-w-[90%] items-center gap-2 rounded-lg bg-surface-2 px-4 py-3 text-[14px] text-muted">
                      <Loader2 size={15} className="animate-spin text-primary" /> Testing on your court… this takes about ten seconds.
                    </div>
                  ) : m.item ? (
                    <Reply p={m.item} onApply={apply} />
                  ) : (
                    <div className="max-w-[90%] rounded-lg bg-surface-2 px-4 py-3 text-[14px] text-muted">{m.note}</div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={endRef} />
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="e.g. Too many matters weren't reached this week"
              className="flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-primary/40"
            />
            <Button onClick={send} disabled={!text.trim()}>
              <Send size={15} /> Ask
            </Button>
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card title="What the assistant can change" subtitle="Every proposal uses these settings; you see the effect before anything changes.">
            <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
              {["reserve_minutes", "overbook", "ageing_share", "max_listed", "cluster", "fresh", "give_appointments", "use_readiness"].map((k) => (
                <li key={k} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> {LEVERS[k]}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="What it cannot change">
            <p className="text-[13px] text-muted">
              The floors stay: old cases keep at least a fifth of listed time, the daily urgent reserve, the checklists, and an
              average of three and a half hours of hearings a day.
            </p>
          </Card>
          <Link href="/court" className="text-[13px] text-primary hover:underline">
            Back to the court day
          </Link>
        </div>
      </div>
    </div>
  );
}

function Reply({ p, onApply }: { p: Proposal; onApply: (p: Proposal) => void }) {
  const [tested, setTested] = useState(false);
  const levers = Object.entries(p.proposal ?? {});
  const effect = Object.entries(p.effect ?? {});
  const ai = /ai|llm|sarvam|model/i.test(p.source ?? "");
  return (
    <div className="max-w-[92%] rounded-lg border border-line bg-bg p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-on-primary">
          <Sparkles size={13} />
        </span>
        <span className="text-[13px] font-medium text-text">Court assistant</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">{ai ? "AI" : "from the record"}</span>
      </div>
      <p className="text-[14px] leading-relaxed text-text">{p.answer}</p>
      {!!p.cited_cases?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.cited_cases.map((c) => (
            <Link key={c} href={`/case/${encodeURIComponent(c)}`} className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-primary hover:underline">
              {c}
            </Link>
          ))}
        </div>
      )}
      {levers.length > 0 && (
        <div className="selected-row mt-3 rounded-lg p-3">
          <p className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.1em] text-primary">
            <Wand size={13} /> Proposed change
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {levers.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-3 text-[13px]">
                <span className="text-text">{LEVERS[k] ?? k.replace(/_/g, " ")}</span>
                <span className="num text-primary">{leverValue(k, v)}</span>
              </li>
            ))}
          </ul>
          {p.why && <p className="mt-2 text-[13px] text-muted">{p.why}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {effect.length > 0 && (
              <Button variant="ghost" onClick={() => setTested(true)} className="px-3 py-1.5 text-[13px]">
                <FlaskConical size={14} /> Test this on my court
              </Button>
            )}
            <Button onClick={() => onApply(p)} className="px-3 py-1.5 text-[13px]">
              Apply to my setup
            </Button>
          </div>
        </div>
      )}
      <AnimatePresence>
        {tested && effect.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
            <table className="mt-3 w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Measure</th>
                  <th className="py-1.5 text-right font-medium">Now</th>
                  <th className="py-1.5 text-right font-medium">With the change</th>
                  <th className="py-1.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {effect.map(([k, e]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 text-text">{meta(k).label}</td>
                    <td className="num py-1.5 text-right text-muted">{fmtMetric(k, e.now)}</td>
                    <td className="num py-1.5 text-right text-text">{fmtMetric(k, e.with_change)}</td>
                    <td className="py-1.5 text-right">
                      <DeltaPill k={k} a={e.with_change} b={e.now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
