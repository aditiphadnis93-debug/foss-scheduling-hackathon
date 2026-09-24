"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BacklogRow } from "@/lib/types";
import { AGE_COLOUR, AGE_KEYS, AGE_LABEL } from "@/lib/theme";
import { shortDate } from "@/lib/format";
import { AXIS, Tip, type TipItem } from "./Tip";

export default function AgeArea({ data, height = 260 }: { data: BacklogRow[]; height?: number; id?: string }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => shortDate(d)} minTickGap={40} />
          <YAxis {...AXIS} width={48} />
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
          {AGE_KEYS.map((k) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={AGE_LABEL[k]}
              stackId="1"
              stroke={AGE_COLOUR[k]}
              strokeWidth={0}
              fill={AGE_COLOUR[k]}
              fillOpacity={0.9}
              animationDuration={1200}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
