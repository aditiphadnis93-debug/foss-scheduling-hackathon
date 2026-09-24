import { useMemo, useRef, useState, type DragEvent } from 'react'
import { CalendarOff, CalendarPlus, GripVertical, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react'
import type { DayView, DisposalType, HearingEvent, OutcomeRequest, ReasonGroup } from '../api/types'
import {
  blockColor, clock, DISPOSAL_LABEL, fromMin, GROUP_COLOR, htLabel, REASON_LABEL, RESULT_LABEL, RESULT_TONE, span, toMin,
} from '../lib/format'
import { AgeChip, cx, LikelihoodDot, Pill } from './ui'

export const DRAG_MIME = 'application/x-vihitha-hearing'
const MIN_H = 22

export interface DayActions {
  onOpenCase?: (caseId: string) => void
  /** Drop a hearing on the time axis; `time` (HH:MM, snapped to 5 min) becomes to_window_start. */
  onDropAt?: (hearingId: number, time: string) => void
  onDragChange?: (h: HearingEvent | null) => void
  onPin?: (h: HearingEvent) => void
  onRemove?: (h: HearingEvent) => void
  onMoveToDate?: (h: HearingEvent, date: string) => void
  onOutcome?: (h: HearingEvent, body: OutcomeRequest) => void
  /** Court Master mode: show outcome buttons. */
  courtMaster?: boolean
  busyHearing?: number | null
}

/**
 * Elastic time axis: minutes map to pixels at `scale`, but every hearing gets at least MIN_H px,
 * so short slots stay readable. Everything (hours, lunch, blocks, drop target) uses the same mapping.
 */
function buildAxis(start: number, end: number, scale: number, evs: { s: number; e: number }[], extra: number[]) {
  const pts = Array.from(new Set([start, end, ...extra, ...evs.flatMap((v) => [v.s, v.e])].filter((t) => t >= start && t <= end))).sort((a, b) => a - b)
  const ys = [0]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = b - a
    let h = d * scale
    for (const v of evs) if (v.s <= a && v.e >= b && v.e > v.s) h = Math.max(h, (MIN_H * d) / (v.e - v.s))
    ys.push(ys[i - 1] + h)
  }
  const y = (t: number) => {
    if (t <= pts[0]) return 0
    for (let i = 1; i < pts.length; i++) if (t <= pts[i]) return ys[i - 1] + ((t - pts[i - 1]) / (pts[i] - pts[i - 1] || 1)) * (ys[i] - ys[i - 1])
    return ys[ys.length - 1]
  }
  const t = (py: number) => {
    if (py <= 0) return pts[0]
    for (let i = 1; i < ys.length; i++) if (py <= ys[i]) return pts[i - 1] + ((py - ys[i - 1]) / (ys[i] - ys[i - 1] || 1)) * (pts[i] - pts[i - 1])
    return pts[pts.length - 1]
  }
  return { y, t, H: ys[ys.length - 1] }
}

/**
 * Google-Calendar-style day: time axis, lunch band, optional block bands, and one event per hearing in calling order.
 * Click an event for details. In read-only mode (What-If) nothing can be dragged or changed.
 */
export function DayCalendar({ day, readOnly, scale = 1.6, actions = {} }: { day: DayView; readOnly?: boolean; scale?: number; actions?: DayActions }) {
  const [open, setOpen] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropT, setDropT] = useState<number | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const start = toMin(day.day_start || '10:00'), end = toMin(day.day_end || '17:30')

  const hs = useMemo(() => day.hearings.filter((h) => h.status !== 'CANCELLED' && h.window_start)
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0) || toMin(a.window_start) - toMin(b.window_start)), [day.hearings])
  const showBlocks = day.blocks.length > 1

  const { axis, lanes, laneCount } = useMemo(() => {
    const evs = hs.map((h) => { const s = toMin(h.window_start); return { s, e: Math.max(s + 1, toMin(h.window_end || h.window_start)) } })
    const hours: number[] = []
    for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60) hours.push(m)
    const extra = [...hours, ...(day.lunch ?? []).map(toMin), ...(showBlocks ? day.blocks.flatMap((b) => [toMin(b.start), toMin(b.end)]) : [])]
    const axis = buildAxis(start, end, scale, evs, extra)
    // lanes only matter if firm listings overlap
    const laneEnds: number[] = []
    const lanes = evs.map((v) => {
      let l = laneEnds.findIndex((e) => e <= v.s)
      if (l < 0) { l = laneEnds.length; laneEnds.push(v.e) } else laneEnds[l] = v.e
      return l
    })
    return { axis, lanes, laneCount: Math.max(1, laneEnds.length) }
  }, [hs, start, end, scale, day.lunch, day.blocks, showBlocks])

  if (!day.sitting) {
    return (
      <div className={cx('card p-10 flex flex-col items-center text-center gap-2', day.leave ? 'border-purple bg-purple-bg' : 'bg-grey-bg')}>
        <CalendarOff size={36} strokeWidth={1.5} className={day.leave ? 'text-purple' : 'text-grey'} />
        <h3 className="text-lg font-bold">{day.leave ? 'Judge on leave' : day.holiday_name ?? 'No sitting'}</h3>
        <p className="text-sm text-muted">{day.leave ? day.leave_note || 'No hearings are listed on this day.' : 'The court does not sit on this day.'}</p>
      </div>
    )
  }

  const { y, H } = axis
  const hours: number[] = []
  for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60) hours.push(m)
  const dragOn = !readOnly && !!actions.onDropAt
  const endDrag = () => { setDragging(null); setDropT(null); actions.onDragChange?.(null) }
  const timeAt = (e: DragEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    return Math.min(end - 5, Math.max(start, Math.round(axis.t(e.clientY - r.top) / 5) * 5))
  }
  const tentativeDay = day.status === 'TENTATIVE'

  return (
    <div className="card p-3 flex gap-2 select-none">
      <div className="relative w-12 shrink-0" style={{ height: H }} aria-hidden>
        {hours.map((m) => <span key={m} className="absolute right-1 -translate-y-1/2 text-[11px] text-muted num" style={{ top: y(m) }}>{clock(fromMin(m))}</span>)}
      </div>
      <div ref={areaRef} className={cx('relative flex-1', dropT != null && 'bg-blue-sel/40')} style={{ height: H }}
        onDragOver={dragOn ? (e) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropT(timeAt(e)) } } : undefined}
        onDragLeave={dragOn ? (e) => { if (!areaRef.current?.contains(e.relatedTarget as Node)) setDropT(null) } : undefined}
        onDrop={dragOn ? (e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData(DRAG_MIME)); const tm = timeAt(e); endDrag(); if (id) actions.onDropAt!(id, fromMin(tm)) } : undefined}>
        {hours.map((m) => <div key={m} className="absolute left-0 right-0 border-t border-line" style={{ top: y(m) }} />)}
        {showBlocks && day.blocks.map((b) => {
          const c = blockColor(b.color_key)
          return (
            <div key={b.id} className="absolute left-0 right-0 border-l-4" style={{ top: y(toMin(b.start)), height: y(toMin(b.end)) - y(toMin(b.start)), background: c.bg, borderColor: c.border }}>
              <span className="absolute right-2 top-1 text-[11px] font-semibold max-w-[30%] truncate text-right" style={{ color: c.text }} title={b.label}>{b.label}</span>
            </div>
          )
        })}
        {day.lunch?.length === 2 && (
          <div className="absolute left-0 right-0 flex items-center justify-center text-[11px] font-semibold text-grey-text"
            style={{ top: y(toMin(day.lunch[0])), height: Math.max(14, y(toMin(day.lunch[1])) - y(toMin(day.lunch[0]))), background: 'repeating-linear-gradient(45deg,#EEF1F5,#EEF1F5 6px,#F6F9FC 6px,#F6F9FC 12px)' }}>
            Lunch {span(day.lunch[0], day.lunch[1])}
          </div>
        )}
        {hs.length === 0 && <div className="absolute inset-x-0 top-1/3 text-center text-sm text-muted">Nothing listed on this day yet.</div>}

        {hs.map((h, i) => {
          const s = toMin(h.window_start), e = Math.max(s + 1, toMin(h.window_end || h.window_start))
          const top = y(s), ht = Math.max(MIN_H, y(e) - y(s)) - 1
          const g = GROUP_COLOR[h.group] ?? GROUP_COLOR.TRIAL
          const tent = h.tentative || tentativeDay
          const isOpen = open === h.hearing_id
          const editable = !readOnly && !h.result && day.status !== 'CLOSED' && h.status !== 'DONE'
          const draggable = editable && dragOn
          const w = 58 / laneCount
          return (
            <div key={h.hearing_id} className="absolute" style={{ top, left: `calc(${lanes[i] * w}% + 6px)`, width: `calc(${w}% - 6px)`, zIndex: isOpen ? 30 : 10 }}>
              <button type="button" aria-expanded={isOpen} draggable={draggable}
                onClick={() => setOpen(isOpen ? null : h.hearing_id)}
                onDragStart={(ev) => { ev.dataTransfer.setData(DRAG_MIME, String(h.hearing_id)); ev.dataTransfer.setData('text/plain', h.case_number); ev.dataTransfer.effectAllowed = 'move'; setOpen(null); setDragging(h.hearing_id); actions.onDragChange?.(h) }}
                onDragEnd={endDrag}
                title={`#${h.queue_position} ${h.case_number} · ${htLabel(h.hearing_type)} · ${span(h.window_start, h.window_end)}${tent ? ' · tentative' : ''}`}
                className={cx('w-full text-left rounded-[6px] border border-l-4 px-1.5 flex items-center gap-1.5 overflow-hidden text-xs shadow-sm transition-colors',
                  tent && 'border-dashed', h.result && 'opacity-70', isOpen && 'ring-2 ring-blue', draggable && 'cursor-grab active:cursor-grabbing', dragging === h.hearing_id && 'opacity-40')}
                style={{ height: ht, background: tent ? '#FFFFFF' : g.bg, borderColor: g.border, color: '#0B2545' }}>
                {draggable && <GripVertical size={12} className="text-muted shrink-0" aria-hidden />}
                <span className="font-bold num shrink-0" style={{ color: g.text }}>{h.queue_position}</span>
                <LikelihoodDot l={h.likelihood} p={h.p_substantive} />
                <span className="font-semibold num truncate shrink-0 max-w-[40%]">{h.case_number}</span>
                <span className="truncate">{htLabel(h.hearing_type)}</span>
                {h.age_years >= 4 && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: h.age_years >= 5 ? '#C0392B' : '#D98E04' }} title={`${h.age_years.toFixed(1)} years old`} />}
                {h.pinned && <Pin size={11} className="shrink-0 text-blue" aria-label="Pinned" />}
                {h.carried_forward && <RotateCcw size={11} className="shrink-0 text-purple" aria-label="Carried forward" />}
                {h.result && <span className={cx('shrink-0 font-semibold', h.result.result === 'MOVED_FORWARD' ? 'text-green-text' : h.result.result === 'ADJOURNED' ? 'text-amber-text' : 'text-grey-text')}>{RESULT_LABEL[h.result.result]}</span>}
                <span className="ml-auto text-[10px] text-muted num shrink-0 hidden sm:inline">{clock(h.window_start)}</span>
              </button>
              {isOpen && (
                <div className="mt-1 w-[150%] max-w-[600px] rounded-card border border-blue bg-white shadow-xl">
                  <HearingDetail h={h} readOnly={readOnly} actions={actions} dayClosed={day.status === 'CLOSED'} dayPublished={day.status === 'PUBLISHED'} tentative={tent} />
                </div>
              )}
            </div>
          )
        })}

        {dropT != null && (
          <div className="absolute left-0 right-0 border-t-2 border-blue pointer-events-none z-40" style={{ top: y(dropT) }}>
            <span className="absolute -top-3 left-1 bg-blue text-white text-[11px] font-semibold num rounded px-1.5">{clock(fromMin(dropT))}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function HearingDetail({ h, readOnly, actions, dayClosed, dayPublished, tentative }: {
  h: HearingEvent; readOnly?: boolean; actions: DayActions; dayClosed: boolean; dayPublished: boolean; tentative: boolean
}) {
  const editable = !readOnly && !h.result && !dayClosed && h.status !== 'DONE' && h.status !== 'CANCELLED'
  const g = GROUP_COLOR[h.group]
  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-muted num">#{h.queue_position}</span>
        <LikelihoodDot l={h.likelihood} p={h.p_substantive} />
        {actions.onOpenCase
          ? <button type="button" className="link num text-sm" onClick={() => actions.onOpenCase!(h.case_id)}>{h.case_number}</button>
          : <span className="font-semibold num text-sm">{h.case_number}</span>}
        <span className="text-sm">{htLabel(h.hearing_type)}</span>
        <AgeChip years={h.age_years} />
        {g && <Pill tone={h.group === 'SHORT' ? 'blue' : h.group === 'FINAL' ? 'amber' : 'teal'}>{g.label}</Pill>}
        {tentative && <Pill tone="teal" className="border border-dashed border-teal">Tentative</Pill>}
        {h.pinned && <Pill tone="blue"><Pin size={11} />Pinned</Pill>}
        {h.carried_forward && <Pill tone="purple" title={h.first_promised_date ? `First promised for ${h.first_promised_date}` : undefined}><RotateCcw size={11} />Carried forward</Pill>}
        {h.status === 'PUBLISHED' && !h.result && <Pill tone="blue">Published</Pill>}
        {h.result && <Pill tone={RESULT_TONE[h.result.result]} dot>{RESULT_LABEL[h.result.result]}
          {h.result.reason_group && ` · ${REASON_LABEL[h.result.reason_group]}`}{h.result.disposal_type && ` · ${DISPOSAL_LABEL[h.result.disposal_type]}`}</Pill>}
      </div>
      <p className="text-xs text-muted num">
        Slot {span(h.window_start, h.window_end)} · if it goes ahead {span(h.est_start, h.est_end)} ({h.duration_min} min) · {h.advocate_id}
        {h.result?.actual_start && <> · heard {span(h.result.actual_start, h.result.actual_end)}</>}
      </p>
      {h.reason && <p className="text-xs text-teal-text">{h.reason}</p>}
      {editable && (actions.onPin || actions.onRemove || actions.onMoveToDate) && (
        <div className="flex items-center gap-1 flex-wrap">
          {actions.onPin && <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs" disabled={actions.busyHearing === h.hearing_id} onClick={() => actions.onPin!(h)}>
            {h.pinned ? <><PinOff size={14} />Unpin</> : <><Pin size={14} />Pin</>}</button>}
          {actions.onMoveToDate && (
            <label className="btn-ghost min-h-[32px] px-2 text-xs relative cursor-pointer"><CalendarPlus size={14} />Move to date
              <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" aria-label={`Move ${h.case_number} to another date`} onChange={(e) => e.target.value && actions.onMoveToDate!(h, e.target.value)} />
            </label>
          )}
          {actions.onRemove && <button type="button" className="btn-ghost min-h-[32px] px-2 text-xs text-red-text hover:bg-red-bg" onClick={() => actions.onRemove!(h)}><Trash2 size={14} />Remove</button>}
        </div>
      )}
      {actions.courtMaster && !readOnly && !h.result && actions.onOutcome && (
        dayPublished
          ? <OutcomeBar busy={actions.busyHearing === h.hearing_id} onPick={(b) => actions.onOutcome!(h, b)} />
          : !dayClosed && <p className="text-xs text-muted">Publish this day to record what happened.</p>
      )}
    </div>
  )
}

const REASONS: ReasonGroup[] = ['ABSENCE', 'PREP', 'PROCESS', 'COURT', 'UNCLEAR']
const DISPOSALS: DisposalType[] = ['CONVICTION', 'ACQUITTAL', 'SETTLED', 'WITHDRAWN', 'DISMISSED']

export function OutcomeBar({ onPick, busy }: { onPick: (b: OutcomeRequest) => void; busy: boolean }) {
  const [menu, setMenu] = useState<'ADJ' | 'DISP' | null>(null)
  const btn = 'min-h-[36px] px-3 rounded-btn text-xs font-semibold border transition-colors disabled:opacity-50'
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Record what happened">
        <button type="button" disabled={busy} className={cx(btn, 'border-green bg-green-bg text-green-text hover:bg-green hover:text-white')} onClick={() => onPick({ result: 'MOVED_FORWARD' })}>Moved forward</button>
        <button type="button" disabled={busy} aria-expanded={menu === 'ADJ'} className={cx(btn, 'border-amber bg-amber-bg text-amber-text', menu === 'ADJ' && 'ring-2 ring-amber')} onClick={() => setMenu(menu === 'ADJ' ? null : 'ADJ')}>Adjourned ▸</button>
        <button type="button" disabled={busy} className={cx(btn, 'border-grey bg-grey-bg text-grey-text')} onClick={() => onPick({ result: 'NOT_REACHED' })}>Not reached</button>
        <button type="button" disabled={busy} aria-expanded={menu === 'DISP'} className={cx(btn, 'border-blue bg-blue-sel text-blue', menu === 'DISP' && 'ring-2 ring-blue')} onClick={() => setMenu(menu === 'DISP' ? null : 'DISP')}>Disposed ▸</button>
      </div>
      {menu === 'ADJ' && (
        <div className="flex flex-wrap gap-1.5 pl-2" role="group" aria-label="Why was it adjourned?">
          <span className="text-xs text-muted self-center">Why?</span>
          {REASONS.map((r) => <button type="button" key={r} disabled={busy} className={cx(btn, 'border-line bg-white hover:border-amber')} onClick={() => { setMenu(null); onPick({ result: 'ADJOURNED', reason_group: r }) }}>{REASON_LABEL[r]}</button>)}
        </div>
      )}
      {menu === 'DISP' && (
        <div className="flex flex-wrap gap-1.5 pl-2" role="group" aria-label="How did it end?">
          <span className="text-xs text-muted self-center">How?</span>
          {DISPOSALS.map((d) => <button type="button" key={d} disabled={busy} className={cx(btn, 'border-line bg-white hover:border-blue')} onClick={() => { setMenu(null); onPick({ result: 'DISPOSED', disposal_type: d }) }}>{DISPOSAL_LABEL[d]}</button>)}
        </div>
      )}
    </div>
  )
}
