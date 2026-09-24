import { useState, type ReactNode } from 'react'

const W = 720
const AX = '#52627A', GRID = '#DDE5EE'

type Series = { label: string; color: string; values: number[]; dashed?: boolean }

function ticks(max: number, n = 4) {
  if (!(max > 0) || !isFinite(max)) max = 1
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw || 1)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

function Frame({ h, labels, yMax, yFmt, children, hover, setHover, pad = { l: 48, r: 96, t: 12, b: 28 }, tip }: {
  h: number; labels: string[]; yMax: number; yFmt: (v: number) => string; children: (x: (i: number) => number, y: (v: number) => number) => ReactNode
  hover: number | null; setHover: (i: number | null) => void; pad?: { l: number; r: number; t: number; b: number }; tip?: (i: number) => ReactNode
}) {
  const n = labels.length
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r))
  const ts = ticks(yMax)
  const top = ts[ts.length - 1]
  const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b)
  const every = Math.ceil(n / 8)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-auto" aria-hidden
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)); setHover(i >= 0 && i < n ? i : null) }}>
        {ts.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX}>{yFmt(v)}</text></g>)}
        {labels.map((l, i) => (i % every === 0 || i === n - 1) && <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="11" fill={AX}>{l}</text>)}
        {children(x, y)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke={AX} strokeWidth="1" strokeDasharray="3 3" />}
      </svg>
      {hover != null && tip && (
        <div className="absolute top-2 z-10 pointer-events-none rounded-btn bg-navy text-white text-xs p-2.5 shadow-lg num min-w-[150px]"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}>
          <div className="font-semibold mb-1">{labels[hover]}</div>{tip(hover)}
        </div>
      )}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map((s) => <li key={s.label} className="flex items-center gap-1.5"><span className="w-4 h-0 border-t-[3px]" style={{ borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' }} />{s.label}</li>)}
    </ul>
  )
}

export function TableFallback({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="text-sm mt-2">
      <summary className="link cursor-pointer min-h-[36px] inline-flex items-center">Show as table</summary>
      <div className="max-h-64 overflow-auto mt-2">
        <table className="w-full num">
          <thead className="text-left text-muted sticky top-0 bg-white"><tr>{head.map((h, i) => <th key={h} className={i ? 'text-right pl-3' : ''}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`py-1 ${j ? 'text-right pl-3' : ''}`}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}

/** Stacked area; series[0] sits at the bottom. */
export function StackedArea({ labels, series, height = 320, label }: { labels: string[]; series: Series[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const totals = labels.map((_, i) => series.reduce((s, x) => s + x.values[i], 0))
  const max = Math.max(...totals) * 1.05
  return (
    <figure aria-label={label}>
      <Legend items={series} />
      <Frame h={height} labels={labels} yMax={max} yFmt={(v) => Math.round(v).toLocaleString('en-IN')} hover={hover} setHover={setHover}
        tip={(i) => <>{[...series].reverse().map((s) => <div key={s.label} className="flex justify-between gap-3"><span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: s.color }} />{s.label}</span><span>{s.values[i].toLocaleString('en-IN')}</span></div>)}<div className="flex justify-between gap-3 border-t border-white/20 mt-1 pt-1"><span>Total</span><span>{totals[i].toLocaleString('en-IN')}</span></div></>}>
        {(x, y) => {
          const cum = labels.map(() => 0)
          return series.map((s) => {
            const lo = cum.slice(); s.values.forEach((v, i) => (cum[i] += v))
            const d = `M${labels.map((_, i) => `${x(i)},${y(cum[i])}`).join('L')}L${[...labels.keys()].reverse().map((i) => `${x(i)},${y(lo[i])}`).join('L')}Z`
            const last = labels.length - 1
            return <g key={s.label}><path d={d} fill={s.color} fillOpacity="0.85" stroke="#fff" strokeWidth="1" />
              <text x={x(last) + 8} y={y((lo[last] + cum[last]) / 2) + 4} fontSize="11" fontWeight="600" fill={AX}>{s.label}</text></g>
          })
        }}
      </Frame>
      <TableFallback head={['Week', ...series.map((s) => s.label)]} rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i])])} />
    </figure>
  )
}

/** `dashFrom`: index of the first forecast point. Lines are solid before it and dashed from the point before it onward. */
export function LineChart({ labels, series, yFmt, yMax, refLine, height = 240, label, dashFrom }: {
  labels: string[]; series: Series[]; yFmt: (v: number) => string; yMax?: number; refLine?: { value: number; label: string }; height?: number; label: string; dashFrom?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!labels.length) return <p className="text-sm text-muted py-8 text-center">No data yet.</p>
  const max = yMax ?? Math.max(1, ...series.flatMap((s) => s.values), refLine?.value ?? 0) * 1.08
  const last = labels.length - 1
  const df = dashFrom != null && dashFrom >= 0 && dashFrom <= last ? dashFrom : null
  return (
    <figure aria-label={label}>
      {(series.length > 1 || df != null) && <Legend items={[...series, ...(df != null ? [{ label: 'Forecast', color: AX, dashed: true }] : [])]} />}
      <Frame h={height} labels={labels} yMax={max} yFmt={yFmt} hover={hover} setHover={setHover}
        tip={(i) => <>{series.map((s) => <div key={s.label} className="flex justify-between gap-3"><span>{s.label}</span><span>{yFmt(s.values[i])}</span></div>)}{df != null && i >= df && <div className="text-white/70 mt-1">Forecast</div>}</>}>
        {(x, y) => <>
          {df != null && <rect x={x(Math.max(0, df - 0.5))} y={0} width={x(last) - x(Math.max(0, df - 0.5))} height={height - 28} fill="#F6F9FC" />}
          {refLine && <g><line x1={x(0)} x2={x(last)} y1={y(refLine.value)} y2={y(refLine.value)} stroke={AX} strokeDasharray="6 4" /><text x={x(last) + 8} y={y(refLine.value) + 4} fontSize="11" fill={AX}>{refLine.label}</text></g>}
          {series.map((s) => (
            <g key={s.label}>
              {df == null
                ? <polyline fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '6 4' : undefined} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                : <>
                  {df > 0 && <polyline fill="none" stroke={s.color} strokeWidth="2" points={s.values.slice(0, df).map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
                  <polyline fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="6 4" points={s.values.map((v, i) => [v, i] as const).slice(Math.max(0, df - 1)).map(([v, i]) => `${x(i)},${y(v)}`).join(' ')} />
                </>}
              {hover != null && <circle cx={x(hover)} cy={y(s.values[hover])} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />}
              <text x={x(last) + 8} y={y(s.values[last]) + 4} fontSize="11" fontWeight="700" fill={s.color}>{yFmt(s.values[last])}</text>
            </g>
          ))}
        </>}
      </Frame>
      <TableFallback head={['', ...series.map((s) => s.label)]} rows={labels.map((l, i) => [l, ...series.map((s) => yFmt(s.values[i]))])} />
    </figure>
  )
}

/** `faded[i]` draws bar i lighter (used for forecast weeks). */
export function StackedBars({ labels, keys, colors, data, height = 260, label, faded }: { labels: string[]; keys: string[]; colors: string[]; data: number[][]; height?: number; label: string; faded?: boolean[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!labels.length) return <p className="text-sm text-muted py-8 text-center">No data yet.</p>
  const totals = data.map((r) => r.reduce((s, v) => s + v, 0))
  const pad = { l: 48, r: 16, t: 12, b: 28 }
  const ts = ticks(Math.max(...totals) * 1.05), top = ts[ts.length - 1]
  const bw = (W - pad.l - pad.r) / labels.length
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b)
  const every = Math.ceil(labels.length / 8)
  return (
    <figure aria-label={label}>
      <Legend items={keys.map((k, i) => ({ label: k, color: colors[i] }))} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${height}`} className="w-full h-auto" aria-hidden onMouseLeave={() => setHover(null)}>
          {ts.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AX}>{v}</text></g>)}
          {data.map((row, i) => {
            let acc = 0
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={height - pad.t - pad.b} fill="transparent" />
                {row.map((v, j) => { const y0 = y(acc); acc += v; return <rect key={j} x={pad.l + i * bw + bw * 0.15} width={bw * 0.7} y={y(acc)} height={Math.max(0, y0 - y(acc) - 1)} fill={colors[j]} opacity={(hover == null || hover === i ? 1 : 0.55) * (faded?.[i] ? 0.5 : 1)} /> })}
                {(i % every === 0) && <text x={pad.l + i * bw + bw / 2} y={height - 8} textAnchor="middle" fontSize="11" fill={AX}>{labels[i]}</text>}
              </g>
            )
          })}
        </svg>
        {hover != null && (
          <div className="absolute top-2 z-10 pointer-events-none rounded-btn bg-navy text-white text-xs p-2.5 shadow-lg num min-w-[190px]"
            style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, transform: hover > labels.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}>
            <div className="font-semibold mb-1">{labels[hover]}{faded?.[hover] && ' · forecast'}</div>
            {keys.map((k, j) => <div key={k} className="flex justify-between gap-3"><span>{k}</span><span>{data[hover][j]}</span></div>)}
          </div>
        )}
      </div>
      <TableFallback head={['Week', ...keys]} rows={labels.map((l, i) => [l, ...data[i]])} />
    </figure>
  )
}

export function HBars({ rows, color = '#0F8B8D', fmt = (v) => String(v), labelWidth = 190 }: { rows: { label: string; value: number }[]; color?: string; fmt?: (v: number) => string; labelWidth?: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((d) => (
        <li key={d.label} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: `${labelWidth}px 1fr` }} title={`${d.label}: ${fmt(d.value)}`}>
          <span className="text-muted truncate">{d.label}</span>
          <div className="flex items-center gap-2"><div className="h-5 rounded-r" style={{ width: `${(d.value / max) * 85}%`, background: color, minWidth: d.value ? 2 : 0 }} /><span className="num font-semibold">{fmt(d.value)}</span></div>
        </li>
      ))}
    </ul>
  )
}
