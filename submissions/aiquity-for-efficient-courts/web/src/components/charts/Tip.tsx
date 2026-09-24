"use client";

export type TipItem = { name?: unknown; value?: unknown; color?: string; dataKey?: unknown };

export function Tip({
  active,
  payload,
  label,
  fmt = (v) => String(v),
  labelFmt = (l) => String(l),
}: {
  active?: boolean;
  payload?: ReadonlyArray<TipItem>;
  label?: unknown;
  fmt?: (v: unknown) => string;
  labelFmt?: (l: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="float rounded-lg border border-line bg-bg px-3 py-2 text-[12px]">
      <div className="mb-1 font-medium text-text">{labelFmt(label)}</div>
      {[...payload].reverse().map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="flex-1">{String(p.name ?? p.dataKey ?? "")}</span>
          <span className="num text-text">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export const AXIS = {
  stroke: "var(--border)",
  tick: { fill: "var(--text-muted)", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;
