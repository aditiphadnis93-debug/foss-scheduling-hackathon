// Formulas as an aligned monospace block: one labelled statement per line.
export default function FormulaBlock({ lines }: { lines: [string, string][] }) {
  const w = Math.max(...lines.map(([l]) => l.length));
  return (
    <pre className="mono scroll-thin overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 text-[12.5px] leading-6 text-text">
      {lines.map(([label, expr], i) => (
        <div key={i}>
          <span className="text-muted">{label.padEnd(w + 2, " ")}</span>
          {expr}
        </div>
      ))}
    </pre>
  );
}

export const CORE_FORMULAS: [string, string][] = [
  ["Chance it goes ahead:", "P_ahead = max(0.02, 1 − min(0.95, (p_absent + p_seek) · m))"],
  ["History multiplier:", "m = 1.4^[absent last] · 1.15^min(adjournments in a row, 4) · 0.5^[confirmed] · 0.85^[window]"],
  ["Chance it moves forward:", "P_forward = P_ahead · (1 − min(0.9, p_court))"],
  ["Expected minutes:", "e(c) = P_ahead · minutes_type + (1 − P_ahead) · 1"],
  ["Value:", "v(c) = P_forward · progress(c) · J(c)"],
  ["Maximise:", "Σ_c,s v(c)·x(c,s) + λ · Σ_a (n(a) − u(a))"],
  ["Subject to:", "Σ_s x(c,s) ≤ 1                          (listed at most once)"],
  ["", "Σ_c e(c)·x(c,s) ≤ capacity(s)             (each sitting)"],
  ["", "Σ_old e(c)·x ≥ α · Σ_c e(c)·x,  α ≥ 0.20  (old cases)"],
  ["", "u(a) ≥ x(c,s) for each matter c of a      (grouping)"],
  ["Capacity:", "capacity(s) = sitting minutes − 30 reserve − κ · sd(expected minutes)"],
  ["Solver:", "CBC (open source), per day inside a rolling 10-day date plan"],
];
