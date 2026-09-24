"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate } from "@/lib/format";
import { AXIS, Tip, type TipItem } from "./Tip";

export type Series = { key: string; name: string; colour: string; dashed?: boolean };

export default function Trajectory({
  data,
  series,
  height = 260,
}: {
  data: Record<string, number | string>[];
  series: Series[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => shortDate(d)} minTickGap={40} />
          <YAxis {...AXIS} width={48} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "var(--text-faint)", strokeDasharray: "3 3" }}
            content={(p) => (
              <Tip
                active={p.active}
                payload={p.payload as ReadonlyArray<TipItem> | undefined}
                label={p.label}
                labelFmt={(l) => shortDate(String(l))}
              />
            )}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: "var(--text-muted)", paddingTop: 8 }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.colour}
              strokeWidth={2.5}
              strokeDasharray={s.dashed ? "6 5" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              animationDuration={1400}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
