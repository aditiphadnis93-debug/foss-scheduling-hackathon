import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Check, Info, Lightbulb, Lock, Minus, Plus, X } from 'lucide-react'
import type { DayStatus, Kpi, Likelihood } from '../api/types'
import { AGE_COLOR, ageLabel, bucketOf, fmtKpi, fmtKpiDelta, LIKELIHOOD } from '../lib/format'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

export type Tone = 'green' | 'amber' | 'red' | 'grey' | 'blue' | 'teal' | 'purple'
const TONE: Record<Tone, string> = {
  green: 'bg-green-bg text-green-text', amber: 'bg-amber-bg text-amber-text', red: 'bg-red-bg text-red-text',
  grey: 'bg-grey-bg text-grey-text', blue: 'bg-blue-sel text-blue', teal: 'bg-teal-light text-teal-text',
  purple: 'bg-purple-bg text-purple-text',
}
const DOT: Record<Tone, string> = { green: 'bg-green', amber: 'bg-amber', red: 'bg-red', grey: 'bg-grey', blue: 'bg-blue', teal: 'bg-teal', purple: 'bg-purple' }

export function Pill({ tone = 'grey', dot, children, className, title }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('pill', TONE[tone], className)}>{dot && <span className={cx('w-2 h-2 rounded-full', DOT[tone])} />}{children}</span>
}
export const Dot = ({ tone, title }: { tone: Tone; title?: string }) => <span title={title} aria-label={title} className={cx('inline-block w-2.5 h-2.5 rounded-full shrink-0', DOT[tone])} />

export function LikelihoodDot({ l, p }: { l: Likelihood; p?: number }) {
  const m = LIKELIHOOD[l] ?? LIKELIHOOD.UNCERTAIN
  const title = `${m.label}${p != null ? ` (${Math.round(p * 100)}% chance it moves forward)` : ''}`
  return <Dot tone={m.tone} title={title} />
}

const STATUS: Record<DayStatus, { tone: Tone; label: string }> = {
  DRAFT: { tone: 'grey', label: 'Draft' }, TENTATIVE: { tone: 'teal', label: 'Tentative' }, PUBLISHED: { tone: 'blue', label: 'Published' }, CLOSED: { tone: 'green', label: 'Closed' },
}
export function DayStatusBadge({ status }: { status: DayStatus | null | undefined }) {
  if (!status) return <Pill tone="grey">Not planned</Pill>
  const s = STATUS[status]
  return <Pill tone={s.tone} dot className={status === 'TENTATIVE' ? 'border border-dashed border-teal' : undefined}>{s.label}</Pill>
}

export function StatCard({ label, value, sub, tone, selected, onClick, children }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'amber'; selected?: boolean; onClick?: () => void; children?: ReactNode
}) {
  const El = onClick ? 'button' : 'div'
  return (
    <El onClick={onClick} aria-pressed={onClick ? selected : undefined}
      className={cx('card p-5 text-left flex flex-col gap-1', tone === 'amber' && 'border-amber bg-amber-bg',
        selected && 'border-blue border-2 bg-blue-sel', onClick && 'hover:border-blue transition-colors')}>
      <span className="label">{label}</span>
      <span className={cx('text-[28px] leading-9 font-bold num', tone === 'amber' && 'text-amber-text')}>{value}</span>
      {sub && <span className="text-sm text-muted">{sub}</span>}
      {children}
    </El>
  )
}

export function CapacityBar({ used, cap, small }: { used: number; cap: number; small?: boolean }) {
  const over = used > cap
  return (
    <div className={cx('w-full rounded-full bg-[#E9EEF4] overflow-hidden', small ? 'h-1.5' : 'h-2.5')}
      role="meter" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={cap} aria-label={`${Math.round(used)} of ${cap} minutes`}>
      <div className={cx('h-full rounded-full transition-all duration-500', over ? 'bg-amber' : 'bg-blue')} style={{ width: `${Math.min(100, cap ? (used / cap) * 100 : 0)}%` }} />
    </div>
  )
}

export function SuggestionCard({ title, reason, children }: { title?: ReactNode; reason: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-card bg-teal-light border border-[#BFE3E3] p-4 flex flex-col gap-3">
      <div className="flex gap-3">
        <Lightbulb size={20} strokeWidth={1.8} className="text-teal-text shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1">
          {title && <div className="font-semibold">{title}</div>}
          <div className="text-sm text-teal-text">{reason}</div>
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2 pl-8">{children}</div>}
    </div>
  )
}

export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} disabled={disabled}
      className="inline-flex items-center min-h-[44px] gap-3 text-left disabled:opacity-50">
      <span className={cx('w-11 h-6 rounded-full relative transition-colors shrink-0', on ? 'bg-teal' : 'bg-[#C5CFDB]')}>
        <span className={cx('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
      </span>
      <span className="flex flex-col"><span className="text-sm font-medium">{label}</span>{hint && <span className="text-xs text-muted">{hint}</span>}</span>
    </button>
  )
}

export function Stepper({ value, onChange, label, min = 0, max, step = 1 }: { value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number }) {
  const clamp = (v: number) => Math.max(min, max != null ? Math.min(max, v) : v)
  return (
    <div className="flex items-center justify-between gap-3 card px-3 py-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" className="icon-btn" aria-label={`Less ${label}`} onClick={() => onChange(clamp(value - step))}><Minus size={18} strokeWidth={1.8} /></button>
        <span className="w-12 text-center font-semibold num" aria-live="polite">{value}</span>
        <button type="button" className="icon-btn" aria-label={`More ${label}`} onClick={() => onChange(clamp(value + step))}><Plus size={18} strokeWidth={1.8} /></button>
      </div>
    </div>
  )
}

export function Segmented<V extends string>({ value, options, onChange, label, dark }: { value: V; options: { value: V; label: ReactNode }[]; onChange: (v: V) => void; label: string; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex p-1 rounded-btn', dark ? 'bg-white/10' : 'bg-grey-bg')}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('px-4 min-h-[36px] rounded-[6px] text-sm font-semibold transition-colors',
            value === o.value ? (dark ? 'bg-white text-navy' : 'bg-white text-blue shadow-sm') : dark ? 'text-white/80 hover:text-white' : 'text-muted hover:text-navy')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<V extends string>({ value, options, onChange, label }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line overflow-x-auto">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('px-4 min-h-[44px] text-sm font-semibold border-b-2 -mb-px whitespace-nowrap',
            value === o.value ? 'border-blue text-blue' : 'border-transparent text-muted hover:text-navy')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Drawer({ open, onClose, width = 580, labelledBy, children }: { open: boolean; onClose: () => void; width?: number; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-navy/45 animate-[fade_.15s]" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={{ width }}
        className="absolute right-0 top-0 h-full max-w-full bg-white shadow-2xl flex flex-col animate-[slide_.2s_ease-out]">
        {children}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/45 animate-[fade_.15s]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" style={{ width }} className="relative max-w-full bg-white rounded-card shadow-2xl flex flex-col max-h-[90vh]">
        <header className="flex items-start gap-3 px-6 pt-5 pb-3">
          <h2 id="modal-title" className="flex-1 text-lg font-bold">{title}</h2>
          <CloseBtn onClick={onClose} />
        </header>
        <div className="px-6 pb-4 overflow-y-auto text-sm flex flex-col gap-3">{children}</div>
        {footer && <footer className="flex justify-end gap-3 px-6 py-4 border-t border-line">{footer}</footer>}
      </div>
    </div>
  )
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 flex-wrap">
      <div>
        <h1 className="text-[28px] leading-9 font-bold">{title}</h1>
        {sub && <p className="text-muted mt-1">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-3 flex-wrap">{children}</div>}
    </div>
  )
}

export const CloseBtn = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="icon-btn" aria-label="Close" onClick={onClick}><X size={20} strokeWidth={1.8} /></button>
)

export function Toast({ msg, tone = 'ok', action, onAction, onDone }: { msg: string; tone?: 'ok' | 'error'; action?: string; onAction?: () => void; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, tone === 'error' ? 9000 : 6000); return () => clearTimeout(t) }, [msg, onDone, tone])
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] text-white rounded-card shadow-2xl px-5 py-3 flex items-center gap-4 max-w-[680px] animate-[rise_.2s_ease-out]', tone === 'error' ? 'bg-red-text' : 'bg-navy')}>
      <span className={cx('w-6 h-6 rounded-full flex items-center justify-center shrink-0', tone === 'error' ? 'bg-white/20' : 'bg-green')}>
        {tone === 'error' ? <AlertCircle size={16} strokeWidth={2.2} /> : <Check size={16} strokeWidth={2.5} />}
      </span>
      <span className="text-sm">{msg}</span>
      {action && <button className="text-sm font-semibold text-[#9CC3F5] hover:underline min-h-[44px] px-2 shrink-0" onClick={() => { onAction?.(); onDone() }}>{action}</button>}
      <button className="text-white/70 hover:text-white shrink-0" aria-label="Dismiss" onClick={onDone}><X size={16} /></button>
    </div>
  )
}

export const Spinner = ({ light }: { light?: boolean }) => <span className={cx('inline-block w-5 h-5 border-2 rounded-full animate-spin', light ? 'border-white/30 border-t-white' : 'border-blue/30 border-t-blue')} aria-hidden />
export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="card p-10 flex items-center justify-center gap-3 text-muted" role="status"><Spinner />{label}</div>
)
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('animate-pulse rounded-btn bg-[#E9EEF4]', className)} aria-hidden />
export function SkeletonCards({ n = 4, h = 'h-28' }: { n?: number; h?: string }) {
  return <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="status" aria-label="Loading">{Array.from({ length: n }, (_, i) => <Skeleton key={i} className={h} />)}</div>
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-2">
      {icon && <div className="text-teal mb-1">{icon}</div>}
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <div className="text-muted text-sm max-w-md">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function InfoTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="relative group inline-flex align-middle">
      <button type="button" className="w-6 h-6 inline-flex items-center justify-center rounded-full text-muted hover:text-navy" aria-label={`${label}: ${tip}`}>
        <Info size={14} strokeWidth={1.8} />
      </button>
      <span role="tooltip" className="pointer-events-none invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-opacity absolute z-30 left-1/2 -translate-x-1/2 top-7 w-60 rounded-btn bg-navy text-white text-xs font-normal normal-case tracking-normal p-2.5 shadow-lg">
        {tip}
      </span>
    </span>
  )
}

/** Coloured delta. `better` decides the colour; the arrow follows the sign. */
export function DeltaTag({ delta, better, fmt, small }: { delta: number | null; better: boolean | null; fmt: (d: number) => string; small?: boolean }) {
  if (delta == null) return null
  if (Math.abs(delta) < 1e-9) return <span className="text-muted text-xs">no change</span>
  const Icon = delta > 0 ? ArrowUp : ArrowDown
  return (
    <span className={cx('inline-flex items-center gap-0.5 font-semibold num', small ? 'text-xs' : 'text-sm', better == null ? 'text-muted' : better ? 'text-green-text' : 'text-red-text')}>
      <Icon size={small ? 12 : 14} strokeWidth={2.2} />{fmt(delta)}
    </span>
  )
}

export const KPI_TIP: Record<string, string> = {
  moved_forward: 'Hearings that moved the case to its next step, per week',
  old_cases_heard: 'Share of cases 4+ years old heard at least once in the period',
  court_time_used: 'Minutes of hearings out of 420 per sitting day. The good band is 85–100%',
  heard_on_promised: 'Share of hearings reached on the date first promised to the parties',
}

export function KpiCard({ kpi, compareLabel = 'Compared with' }: { kpi: Kpi; compareLabel?: string }) {
  return (
    <div className="card p-5 flex flex-col gap-1">
      <span className="label inline-flex items-center gap-0.5">{kpi.label}<InfoTip label={kpi.label} tip={KPI_TIP[kpi.key] ?? kpi.label} />
        {kpi.is_forecast && <Pill tone="teal" className="ml-auto normal-case tracking-normal">Forecast</Pill>}
      </span>
      <span className="text-[32px] leading-10 font-bold num">{fmtKpi(kpi, kpi.value)}{kpi.unit === 'per week' && <span className="text-base font-semibold text-muted"> / week</span>}</span>
      {kpi.compare_value != null && (
        <span className="text-sm text-muted flex items-center gap-2 flex-wrap num">
          {compareLabel} {fmtKpi(kpi, kpi.compare_value)} <DeltaTag delta={kpi.delta} better={kpi.better} fmt={(d) => fmtKpiDelta(kpi, d)} />
        </span>
      )}
      {kpi.detail && <span className="text-xs text-muted">{kpi.detail}</span>}
    </div>
  )
}

export function AgeChip({ years }: { years: number }) {
  const b = bucketOf(years)
  return (
    <span className="pill bg-white border text-navy num whitespace-nowrap" style={{ borderColor: AGE_COLOR[b] }} title={`${years.toFixed(1)} years old`}>
      <span className="w-2 h-2 rounded-full" style={{ background: AGE_COLOR[b] }} />{ageLabel(b)}
    </span>
  )
}
export function Guardrail({ children }: { children: ReactNode }) {
  return <div role="alert" className="flex gap-2 items-start rounded-btn border border-amber bg-amber-bg text-amber-text text-sm px-3 py-2.5"><Lock size={16} strokeWidth={1.8} className="shrink-0 mt-0.5" /><span>{children}</span></div>
}
export function ErrorCard({ msg, onRetry, title = 'Something went wrong' }: { msg: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="card border-red bg-red-bg p-6 flex items-start gap-3">
      <AlertCircle size={22} strokeWidth={1.8} className="text-red-text shrink-0" />
      <div className="flex-1"><p className="font-semibold text-red-text">{title}</p><p className="text-sm text-red-text mt-1">{msg}</p></div>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  )
}
export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <span className="text-sm font-semibold num">{label}</span>
      <div className="h-2.5 rounded-full bg-[#E9EEF4] overflow-hidden" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-blue transition-all duration-300" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  )
}
