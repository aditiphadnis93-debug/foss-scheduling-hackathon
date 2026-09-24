"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, Send, Sparkles } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import { ask, loadAssistant, type Assistant, type AssistantAnswer } from "@/lib/agents";
import { apiHealthy } from "@/lib/api";
import { dateLabel } from "@/lib/format";

/** Court assistant: recorded answers from the day's record, and live answers when the local engine runs. */
export default function CourtAssistant({ day, onCite, runFile }: { day: string; onCite: (caseId: string) => void; runFile?: string }) {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<Assistant | null>(null);
  const [q, setQ] = useState<string | null>(null);
  const [free, setFree] = useState("");
  const [live, setLive] = useState<{ q: string; a: AssistantAnswer | null; day: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    loadAssistant().then((d) => on && setData(d));
    apiHealthy().then((ok) => on && setEngine(ok));
    return () => {
      on = false;
    };
  }, []);
  const recorded = q && data ? data.answers?.[day]?.[q] ?? null : null;
  const shown: { q: string; a: AssistantAnswer | null } | null = live && live.day === day ? live : q ? { q, a: recorded } : null;

  const submit = async () => {
    const text = free.trim();
    if (!text) return;
    setBusy(true);
    const a = await ask(text, day, runFile);
    setLive({ q: text, a, day });
    if (!a) setEngine(false);
    setBusy(false);
  };

  return (
    <div className="card overflow-hidden border-l-2 border-l-primary">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left">
        <span className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-on-primary">
            <Sparkles size={15} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold text-text">Court assistant (AI)</span>
            <span className="block text-[12px] text-muted">Answers from the record of {dateLabel(day, true)}</span>
          </span>
        </span>
        <ChevronDown size={16} className={clsx("text-muted transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="flex flex-col gap-3 px-5 pb-5">
              {data?.questions?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.questions.slice(0, 3).map((x) => (
                    <button
                      key={x}
                      onClick={() => {
                        setQ(x);
                        setLive(null);
                      }}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-left text-[12px] transition-colors",
                        q === x && !live ? "border-primary bg-primary-subtle text-primary" : "border-line text-text hover:bg-surface-2",
                      )}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted">Recorded answers for this roster arrive with the next data update.</p>
              )}
              <AnimatePresence mode="wait">
                {shown && (
                  <motion.div key={`${shown.q}-${day}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg bg-surface-2 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[12px] font-medium text-muted">{shown.q}</p>
                      {shown.a?.source && (
                        <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">
                          {/ai|llm|sarvam|model/i.test(shown.a.source) ? "AI" : "from the record"}
                        </span>
                      )}
                    </div>
                    {shown.a ? (
                      <>
                        <p className="text-[14px] leading-relaxed text-text">{shown.a.answer}</p>
                        {!!shown.a.suggestions?.length && (
                          <ul className="mt-2 flex flex-col gap-1">
                            {shown.a.suggestions.map((s) => (
                              <li key={s} className="flex gap-2 text-[13px] text-text">
                                <Check size={14} className="mt-0.5 shrink-0 text-green-strong" /> {s}
                              </li>
                            ))}
                          </ul>
                        )}
                        {!!shown.a.cited_cases?.length && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {shown.a.cited_cases.map((c) => (
                              <button key={c} onClick={() => onCite(c)} className="mono rounded bg-bg px-1.5 py-0.5 text-[11px] text-primary ring-1 ring-line hover:underline">
                                {c}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[13px] text-muted">
                        {live ? "Live answers need the local engine; recorded answers are shown." : "No recorded answer for this day."}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-2">
                <input
                  value={free}
                  onChange={(e) => setFree(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Ask about today's list"
                  className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:ring-2 focus:ring-primary/40"
                />
                <button onClick={submit} disabled={busy || !free.trim()} className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-on-primary disabled:opacity-40" aria-label="Ask">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              {engine === false && <p className="text-[11px] text-faint">Live answers need the local engine; recorded answers are shown.</p>}
              <Link href="/assistant" className="text-[13px] font-medium text-primary hover:underline">
                Open the full assistant: propose and test changes
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
