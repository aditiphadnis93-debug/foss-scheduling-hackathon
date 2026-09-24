"use client";

import { useExplain } from "@/components/shell/Explain";

// "The maths in plain words": a worked example for everyone; the symbol table only in Technical mode.
const ROWS: [string, string, string][] = [
  ["x(c,s)", "Listed or not: matter c in sitting s today (yes/no)", "1 = listed in the morning sitting"],
  ["x(c,d)", "Dated or not: matter c given date d in the 10-day plan (yes/no)", "1 = provisionally dated for Tuesday"],
  ["u(a)", "Advocate comes today: advocate a has at least one matter (yes/no)", "1 = the advocate is in court today"],
  ["n(a)", "Advocate's matters today: how many of advocate a's matters are listed", "3 = one trip covers three matters"],
  ["v(c)", "Value: chance it moves forward × how close that brings judgment × priority weight", "0.6 × 0.5 × 2 = 0.6"],
  ["P(goes ahead)", "Chance it goes ahead: the side turns up and is ready", "0.8"],
  ["P(moves forward)", "Chance it moves forward, given it goes ahead", "0.6"],
  ["e(c)", "Expected minutes: P(goes ahead) × usual length + (1 − P(goes ahead)) × 1 minute to call it", "0.8 × 30 + 0.2 × 1 = 24.2"],
  ["J(c)", "Priority weight (at least 1): grows with age, time stuck and times passed over", "2 for a six-year-old case"],
  ["α", "Old-case share: minimum share of expected minutes for cases over 4 years", "25% (never below 20%)"],
  ["λ", "Grouping strength: reward for keeping an advocate's matters together", "0.2"],
  ["capacity(s)", "Sitting capacity: minutes in sitting s − 30-minute reserve, with a buffer for uncertainty", "210 − 30, less the buffer"],
];

const STORY = [
  "Take one matter: an evidence hearing, usually 30 minutes.",
  "Will it go ahead? The court's records say 8 in 10 such hearings go ahead, so we count 0.8 × 30 = 24 minutes of court time, plus 1 minute to call it if it doesn't.",
  "What is it worth? If heard, it moves forward 6 times in 10; moving it brings the case half-way to judgment; it is 6 years old so it counts double: 0.6 × 0.5 × 2 = 0.6 points.",
  "Pack the day: we pick the set of matters with the most points that fits in the day's minutes, keeping at least a quarter of the time for cases over 4 years old and putting each advocate's matters together.",
  "The optimiser checks every possible combination to find the best one, using a standard method called integer programming.",
];

export default function MathsPlain({ always = false }: { always?: boolean }) {
  const technical = useExplain() === "technical" || always;
  return (
    <div className="card p-5 md:p-6">
      <h3 className="text-[16px] font-semibold text-text">The maths in plain words</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-text">{STORY[0]}</p>
      <ol className="mt-2 flex flex-col gap-2">
        {STORY.slice(1).map((t, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-text">
            <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-[12px] font-medium text-primary">{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      {technical && (
        <div className="scroll-thin mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted">
              <tr>
                <th className="border-b border-line py-2 pr-3 font-medium">Symbol</th>
                <th className="border-b border-line py-2 pr-3 font-medium">What it is</th>
                <th className="border-b border-line py-2 font-medium">Example</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([sym, what, ex]) => (
                <tr key={sym} className="border-b border-line align-top">
                  <td className="mono whitespace-nowrap py-2 pr-3 text-text">{sym}</td>
                  <td className="py-2 pr-3 text-text">{what}</td>
                  <td className="py-2 text-muted">{ex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
