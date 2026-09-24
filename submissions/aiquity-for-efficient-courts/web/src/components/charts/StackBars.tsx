"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Tip, type TipItem } from "./Tip";

export type StackSeries = { key: string; name: string; colour: string };

/** Stacked bars (vertical categories on x, or horizontal with layout="vertical"). */
export default function StackBars({
  data,
  series,
  xKey,
  height = 280,
  horizontal = false,
  xFmt = (v: string) => v,
}: {
  data: Record<string, number | string>[];
  series: StackSeries[];
  xKey: string;
  height?: number;
  horizontal?: boolean;
  xFmt?: (v: string) => string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, left: horizontal ? 8 : -12, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--border)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey={xKey} {...AXIS} width={170} interval={0} tickFormatter={(v: string) => xFmt(v)} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...AXIS} tickFormatter={(v: string) => xFmt(v)} minTickGap={16} />
              <YAxis {...AXIS} width={44} allowDecimals={false} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={(p) => (
              <Tip active={p.active} payload={p.payload as ReadonlyArray<TipItem> | undefined} label={p.label} labelFmt={(l) => xFmt(String(l))} />
            )}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="s" fill={s.colour} radius={i === series.length - 1 ? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0} animationDuration={900} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
