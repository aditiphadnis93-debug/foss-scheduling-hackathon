import { useState, type DragEvent } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, FastForward, Lock, PauseCircle, Plus, Send, Undo2, X } from 'lucide-react'
import { api, ApiError, errMsg, exportUrls } from '../../api/client'
import { qk, refreshAll } from '../../api/queries'
import type { Change, DayView, HearingEvent, OutcomeRequest, PreviewResponse } from '../../api/types'
import { useApp } from '../../lib/app'
import {
  because, clock, DISPOSAL_LABEL, fmtKpiDelta, GROUP_COLOR, htLabel, midDate, monthOf, pct0, planSentence, REASON_LABEL, RESULT_LABEL, shortDate, span, TENTATIVE_NOTE,
} from '../../lib/format'
import { DayCalendar, DRAG_MIME, OutcomeBar } from '../../components/DayCalendar'
import {
  AgeChip, CapacityBar, cx, DayStatusBadge, DeltaTag, ErrorCard, Guardrail, LikelihoodDot, Modal, Pill, Skeleton, Spinner, Stepper,
} from '../../components/ui'
import { RESULT_TONE } from '../../lib/format'
import { useSittingDays } from '../Calendar'

type Pending = {
  change: Change
  label: string
  hearing?: HearingEvent
  preview?: PreviewResponse
  loading: boolean
  error?: string
}

export default function DayScreen({ date, onOpenDay }: { date: string; onOpenDay: (d: string) => void }) {
  const { role, openCase, openNextDate, toast, toastError, confirm } = useApp()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.day(date), queryFn: () => api.day(date) })
  const [pending, setPending] = useState<Pending | null>(null)
  const [applying, setApplying] = useState(false)
  const [busyHearing, setBusyHearing] = useState<number | null>(null)
  const [dragging, setDragging] = useState<HearingEvent | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [dayBusy, setDayBusy] = useState<string | null>(null)
  const cm = role === 'COURT_MASTER'

  const day = q.data

  // ---------- change + preview ----------
  const propose = async (change: Change, label: string, hearing?: HearingEvent) => {
    setPending({ change, label, hearing, loading: true })
    try {
      const preview = await api.preview(change)
      setPending((p) => (p && p.change === change ? { ...p, preview, loading: false } : p))
    } catch (e) {
      setPending((p) => (p && p.change === change ? { ...p, loading: false, error: errMsg(e) } : p))
    }
  }

  const doApply = async (p: Pending, force: boolean): Promise<string> => {
    const c = p.change
    if (c.type === 'ADD') {
      const r = await api.addHearing(c.case_id!, c.to_date!, c.to_window_start)
      return `${r.hearing.case_number} listed on ${midDate(r.hearing.date)}, ${span(r.hearing.window_start, r.hearing.window_end)}.`
    }
    if (c.type === 'MOVE') {
      const r = await api.moveHearing(c.hearing_id!, { to_date: c.to_date, to_window_start: c.to_window_start, force: force || undefined })
      return `${r.hearing.case_number} moved to ${midDate(r.hearing.date)}, ${span(r.hearing.window_start, r.hearing.window_end)}.`
    }
    if (c.type === 'PIN') {
      const r = await api.moveHearing(c.hearing_id!, { pinned: c.pinned, force: force || undefined })
      return `${r.hearing.case_number} ${r.hearing.pinned ? 'pinned. The planner will leave it where it is.' : 'unpinned.'}`
    }
    const r = await api.removeHearing(c.hearing_id!, force || undefined)
    const s = r.suggestion
    return `${r.case.case_number} removed from this day.${s ? ` Suggested new date ${midDate(s.suggested.date)}: ${because(s.suggested.reason)}` : ' The planner will give it a new date.'}`
  }

  const askForce = (h?: HearingEvent) => confirm({
    title: 'Change a published listing?',
    body: <p>{h ? <><b className="num">{h.case_number}</b> is</> : 'This hearing is'} already published. The parties were told this date and time. Change it anyway?</p>,
    confirmLabel: 'Yes, change it', danger: true,
  })

  const apply = async () => {
    if (!pending) return
    const p = pending
    let force = false
    if (p.hearing?.status === 'PUBLISHED') { if (!(await askForce(p.hearing))) return; force = true }
    setApplying(true)
    try {
      let msg: string
      try { msg = await doApply(p, force) } catch (e) {
        if (e instanceof ApiError && e.status === 409 && !force && p.change.type !== 'ADD') {
          if (!(await askForce(p.hearing))) return
          msg = await doApply(p, true)
        } else throw e
      }
      setPending(null)
      await refreshAll(qc)
      toast({ msg })
    } catch (e) { toastError(e) } finally { setApplying(false) }
  }

  // ---------- actions from the calendar ----------
  const onDropAt = (id: number, time: string) => {
    const h = day?.hearings.find((x) => x.hearing_id === id)
    if (!h || (h.date === date && h.window_start === time)) return
    propose({ type: 'MOVE', hearing_id: id, to_date: date, to_window_start: time }, `Move ${h.case_number} to ${clock(time, true)}`, h)
  }
  const onMoveToDate = (h: HearingEvent, d: string) => {
    if (d === h.date) return
    propose({ type: 'MOVE', hearing_id: h.hearing_id, to_date: d }, `Move ${h.case_number} to ${midDate(d)}`, h)
  }
  const onPin = (h: HearingEvent) => propose({ type: 'PIN', hearing_id: h.hearing_id, pinned: !h.pinned }, `${h.pinned ? 'Unpin' : 'Pin'} ${h.case_number}`, h)
  const onRemove = (h: HearingEvent) => propose({ type: 'REMOVE', hearing_id: h.hearing_id }, `Remove ${h.case_number} from this day`, h)
  const onAdd = (caseId: string, caseNumber: string) => propose({ type: 'ADD', case_id: caseId, to_date: date }, `Add ${caseNumber} to ${midDate(date)}`)

  const onOutcome = async (h: HearingEvent, body: OutcomeRequest) => {
    setBusyHearing(h.hearing_id)
    try {
      const r = await api.outcome(h.hearing_id, body)
      await refreshAll(qc)
      const label = RESULT_LABEL[body.result] + (body.reason_group ? ` · ${REASON_LABEL[body.reason_group]}` : body.disposal_type ? ` · ${DISPOSAL_LABEL[body.disposal_type]}` : '')
      if (r.next_date) openNextDate({ hearingId: h.hearing_id, caseNumber: h.case_number, outcome: label, suggestion: r.next_date })
      else toast({ msg: `${h.case_number}: ${label}.${body.result === 'NOT_REACHED' ? ' It will be carried forward when the day is closed.' : ''}` })
    } catch (e) { toastError(e) } finally { setBusyHearing(null) }
  }

  // ---------- day actions ----------
  const run = async (key: string, fn: () => Promise<string>) => {
    setDayBusy(key)
    try { const msg = await fn(); await refreshAll(qc); toast({ msg }) } catch (e) { toastError(e) } finally { setDayBusy(null) }
  }
  const unpublish = async () => {
    if (!(await confirm({ title: 'Unpublish this day?', body: <p>The day goes back to draft and the planner may change it again. Parties who already saw the list are not told automatically.</p>, confirmLabel: 'Unpublish' }))) return
    run('unpublish', async () => { await api.unpublish(date); return `${midDate(date)} is a draft again.` })
  }
  const closeDay = async () => {
    const open = day?.hearings.filter((h) => !h.result && h.status !== 'CANCELLED').length ?? 0
    if (!(await confirm({
      title: `Close ${midDate(date)}?`,
      body: <p>{open > 0 ? <>{open} {open === 1 ? 'hearing has' : 'hearings have'} no result yet. {open === 1 ? 'It' : 'They'} will be marked <b>Not reached</b> and carried forward, keeping the date first promised. </> : 'Every hearing has a result. '}The planner then tops up the coming days.</p>,
      confirmLabel: 'Close day',
    }))) return
    run('close', async () => {
      const r = await api.closeDay(date)
      return `Day closed. ${r.carried_forward} carried forward. Today is now ${midDate(r.today)}. ${planSentence(r.plan)}`
    })
  }
  const autoRun = async () => {
    if (!(await confirm({
      title: 'Auto-run this day (demo)',
      body: <p>This is for demonstrations only. Vihitha will <b>simulate</b> what happened to each hearing, record made-up results and times, confirm next dates, and close the day. Do not use it for a real court day.</p>,
      confirmLabel: 'Run demo day',
    }))) return
    run('auto', async () => {
      const r = await api.autoOutcomes(date, {})
      const t = r.totals
      return `Demo day recorded: ${t.moved_forward ?? 0} moved forward, ${t.adjourned ?? 0} adjourned, ${t.not_reached ?? 0} not reached.`
    })
  }

  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!day) return <div className="grid grid-cols-[1fr_340px] gap-6"><Skeleton className="h-[720px]" /><Skeleton className="h-[480px]" /></div>

  const t = day.totals
  const closed = day.status === 'CLOSED'

  return (
    <>
      {/* ---------- day bar ---------- */}
      <div className="card px-4 py-3 flex items-center gap-4 flex-wrap">
        <DayStatusBadge status={day.status} />
        {day.sitting && (
          <div className="flex items-center gap-3 min-w-[280px] flex-1 max-w-[460px]">
            <span className="text-sm num whitespace-nowrap"><b>{t.listed}</b> listed · <b>{pct0(t.load_pct)}</b> of the day{t.old_cases > 0 && <> · <b>{t.old_cases}</b> 4+ yr</>}{!closed && t.listed > 0 && t.unused_minutes >= 15 && <> · <b className="text-amber-text">{Math.round(t.unused_minutes)} min free</b></>}</span>
            <div className="flex-1"><CapacityBar used={t.expected_minutes} cap={t.capacity_minutes || 420} /></div>
          </div>
        )}
        {closed && t.moved_forward != null && (
          <span className="text-sm num">Result: <b className="text-green-text">{t.moved_forward}</b> moved forward · <b className="text-amber-text">{t.adjourned ?? 0}</b> adjourned · <b>{t.not_reached ?? 0}</b> not reached</span>
        )}
        {day.ruleset && <span className="text-xs text-muted">Rules: {day.ruleset.name}</span>}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {day.sitting && !cm && day.status !== 'CLOSED' && (
            day.status === 'PUBLISHED'
              ? <button className="btn-secondary" onClick={unpublish} disabled={!!dayBusy}>{dayBusy === 'unpublish' ? <Spinner /> : <Undo2 size={16} />}Unpublish</button>
              : <button className="btn-primary" onClick={() => setPublishOpen(true)} disabled={!!dayBusy || !!pending || t.listed === 0}
                  title={pending ? 'Apply or cancel the pending change first' : undefined}><Send size={16} />Publish</button>
          )}
          {day.sitting && cm && !closed && <>
            <button className="btn-secondary" onClick={autoRun} disabled={!!dayBusy} title="Simulates results for a demonstration">
              {dayBusy === 'auto' ? <Spinner /> : <FastForward size={16} />}Auto-run day <span className="pill bg-amber-bg text-amber-text">Demo</span>
            </button>
            <button className="btn-primary" onClick={closeDay} disabled={!!dayBusy || day.status !== 'PUBLISHED'} title={day.status !== 'PUBLISHED' ? 'Only a published day can be closed' : undefined}>
              {dayBusy === 'close' ? <Spinner light /> : <Lock size={16} />}Close day
            </button>
          </>}
          {day.sitting && <a className="btn-secondary" href={exportUrls.causeList(date)} download><Download size={16} />Export</a>}
        </div>
      </div>

      {day.sitting && !day.status && t.listed === 0 && (
        <div className="card px-4 py-3 text-sm bg-teal-light border-teal/30">
          <b>Not planned yet.</b> The planner has not placed any case on this day. It fills automatically when cases need it.
        </div>
      )}
      {day.sitting && (day.status === 'TENTATIVE' || (day.status !== 'PUBLISHED' && day.status !== 'CLOSED' && day.hearings.some((h) => h.tentative))) && (
        <div className="card px-4 py-3 text-sm bg-teal-light border-dashed border-teal text-teal-text">{TENTATIVE_NOTE}</div>
      )}
      {day.idle_reason && (
        <div className="card px-4 py-3 text-sm bg-amber-bg text-amber-text border-amber/30">{day.idle_reason}</div>
      )}

      {/* ---------- impact preview ---------- */}
      {pending && <PreviewBanner p={pending} applying={applying} onApply={apply} onCancel={() => setPending(null)} />}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div className="flex flex-col gap-3 min-w-0">
          {cm && day.sitting && !closed && day.status !== 'PUBLISHED' && day.hearings.length > 0 && (
            <div className="card px-4 py-3 flex items-center gap-3 flex-wrap bg-amber-bg border-amber/40">
              <AlertTriangle size={18} className="text-amber-text shrink-0" />
              <p className="text-sm text-amber-text flex-1 min-w-[240px]">
                This day's list is <b>{(day.status ?? 'draft').toLowerCase()}</b>. Outcomes (moved forward, adjourned, not reached, disposed) can be recorded only once the list is published to the parties.
              </p>
              <button className="btn-primary" disabled={!!dayBusy} onClick={() => run('publish', async () => {
                const r = await api.publish(date, date)
                return `Published ${midDate(date)}: ${r.hearings_published} hearings. Record outcomes as each case is called.`
              })}>{dayBusy === 'publish' ? <Spinner light /> : <Send size={16} />}Publish and start the day</button>
            </div>
          )}
          {cm && day.sitting && day.hearings.length > 0 && (
            <CourtList day={day} busyHearing={busyHearing} onOutcome={onOutcome} onOpenCase={openCase} />
          )}
          {!cm && day.sitting && !closed && <p className="text-sm text-muted">Hearings are shown in calling order, each in its own slot. Click one for details. Drag it to another time, or onto a day on the right, to see what the change costs before you apply it.</p>}
          <DayCalendar day={day} actions={{
            onOpenCase: openCase,
            onDropAt: closed ? undefined : onDropAt,
            onDragChange: setDragging,
            onPin: closed || cm ? undefined : onPin,
            onRemove: closed || cm ? undefined : onRemove,
            onMoveToDate: closed || cm ? undefined : onMoveToDate,
            onOutcome, courtMaster: cm, busyHearing,
          }} />
          <Legend />
        </div>
        <aside className="flex flex-col gap-4">
          <DropDays date={date} dragging={dragging} onDrop={(h, d) => onMoveToDate(h, d)} onOpenDay={onOpenDay} />
          <HeldBackPanel day={day} onAdd={closed ? undefined : onAdd} />
          <UnscheduledPanel onAdd={closed || !day.sitting ? undefined : onAdd} />
        </aside>
      </div>

      <PublishModal open={publishOpen} date={date} onClose={() => setPublishOpen(false)} onDone={async (msg) => { setPublishOpen(false); await refreshAll(qc); toast({ msg }) }} />
    </>
  )
}

/** Court Master: the day's list in calling order with outcome buttons on every hearing. */
function CourtList({ day, busyHearing, onOutcome, onOpenCase }: {
  day: DayView; busyHearing: number | null
  onOutcome: (h: HearingEvent, b: OutcomeRequest) => void; onOpenCase: (id: string) => void
}) {
  const published = day.status === 'PUBLISHED'
  const rows = [...day.hearings].sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
  const done = rows.filter((h) => h.result).length
  return (
    <section className="card p-0 overflow-hidden" aria-label="Court list">
      <header className="px-4 py-3 border-b border-line flex items-center gap-3 flex-wrap">
        <h2 className="font-semibold">Court list · calling order</h2>
        <span className="text-sm text-muted num">{done} of {rows.length} recorded</span>
        {published && <span className="text-xs text-muted">Record each case as it is called. After Moved forward or Adjourned, the next date is suggested.</span>}
      </header>
      <ol className="divide-y divide-line">
        {rows.map((h) => (
          <li key={h.hearing_id} className={cx('px-4 py-3 flex flex-col gap-2', h.result && 'bg-bg')}>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="w-8 text-xs font-bold text-muted num">#{h.queue_position}</span>
              <span className="num text-muted w-[92px]">{span(h.window_start, h.window_end)}</span>
              <LikelihoodDot l={h.likelihood} p={h.p_substantive} />
              <button type="button" className="link num font-semibold" onClick={() => onOpenCase(h.case_id)}>{h.case_number}</button>
              <span>{htLabel(h.hearing_type)}</span>
              <AgeChip years={h.age_years} />
              <span className="text-xs text-muted">{h.advocate_id}</span>
              {h.carried_forward && <Pill tone="purple">Carried forward</Pill>}
              {h.result && <Pill tone={RESULT_TONE[h.result.result]} dot className="ml-auto">{RESULT_LABEL[h.result.result]}
                {h.result.reason_group && ` · ${REASON_LABEL[h.result.reason_group]}`}{h.result.disposal_type && ` · ${DISPOSAL_LABEL[h.result.disposal_type]}`}</Pill>}
            </div>
            {!h.result && published && day.status !== 'CLOSED' && (
              <div className="pl-10"><OutcomeBar busy={busyHearing === h.hearing_id} onPick={(b) => onOutcome(h, b)} /></div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

function PreviewBanner({ p, applying, onApply, onCancel }: { p: Pending; applying: boolean; onApply: () => void; onCancel: () => void }) {
  const pv = p.preview
  const changed = pv?.kpi_deltas.filter((k) => k.delta != null && Math.abs(k.delta) > 1e-9) ?? []
  return (
    <div role="region" aria-label="Impact of this change" className="sticky top-[72px] z-20 rounded-card border-2 border-amber bg-amber-bg px-4 py-3 flex flex-col gap-2 shadow-lg">
      <div className="flex items-start gap-3 flex-wrap">
        <AlertTriangle size={20} strokeWidth={1.8} className="text-amber-text shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[240px]">
          <p className="font-semibold">{p.label}</p>
          {p.loading ? <p className="text-sm text-amber-text flex items-center gap-2"><Spinner />Working out what this change costs…</p>
            : p.error ? <p className="text-sm text-red-text">{p.error}</p>
            : pv && <p className="text-sm text-amber-text">{pv.message}</p>}
          {p.hearing?.status === 'PUBLISHED' && <p className="text-xs text-red-text mt-1 font-semibold">This hearing is already published. Applying will ask you to confirm.</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={applying}><X size={16} />Cancel</button>
          <button className="btn-primary" onClick={onApply} disabled={applying || p.loading}>{applying && <Spinner light />}Apply</button>
        </div>
      </div>
      {pv && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 pl-8 text-sm">
          {pv.days.map((d) => (
            <span key={d.date} className="num">{midDate(d.date)}: {pct0(d.load_pct_before)} → <b className={d.load_pct_after > 100 ? 'text-amber-text' : ''}>{pct0(d.load_pct_after)}</b></span>
          ))}
          {changed.map((k) => <span key={k.key} className="inline-flex items-center gap-1">{k.label} <DeltaTag delta={k.delta} better={k.better} fmt={(d) => fmtKpiDelta(k, d)} small /></span>)}
          {changed.length === 0 && pv.days.length === 0 && <span className="text-muted">No measurable effect on the four measures.</span>}
        </div>
      )}
      {pv?.warnings.map((w, i) => <div key={i} className="pl-8"><Guardrail>{w.message}</Guardrail></div>)}
    </div>
  )
}

/** Drop targets for moving a hearing to another day. */
function DropDays({ date, dragging, onDrop, onOpenDay }: { date: string; dragging: HearingEvent | null; onDrop: (h: HearingEvent, d: string) => void; onOpenDay: (d: string) => void }) {
  const { sitting } = useSittingDays(date)
  const next = sitting.filter((d) => d > date).slice(0, 10)
  const monthQ = useQuery({ queryKey: qk.month(date.slice(0, 7)), queryFn: () => api.month(date.slice(0, 7)) })
  const nextM = next.length ? next[next.length - 1].slice(0, 7) : date.slice(0, 7)
  const month2Q = useQuery({ queryKey: qk.month(nextM), queryFn: () => api.month(nextM), enabled: nextM !== date.slice(0, 7) })
  const load = new Map([...(monthQ.data?.days ?? []), ...(month2Q.data?.days ?? [])].map((d) => [d.date, d]))
  const [over, setOver] = useState<string | null>(null)
  return (
    <section className={cx('card p-4 flex flex-col gap-2 transition-colors', dragging && 'border-blue border-2')}>
      <h2 className="font-bold">Next sitting days</h2>
      <p className="text-xs text-muted">{dragging ? <>Drop <b className="num">{dragging.case_number}</b> on a day to move it there.</> : 'Drag a hearing here to move it to another day.'}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {next.map((d) => {
          const m = load.get(d)
          return (
            <button key={d} type="button" onClick={() => onOpenDay(d)}
              onDragOver={(e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(d) } }}
              onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e: DragEvent) => { e.preventDefault(); setOver(null); if (dragging) onDrop(dragging, d) }}
              className={cx('min-h-[44px] rounded-btn border px-2 py-1 text-left text-xs flex flex-col', over === d ? 'border-blue border-2 bg-blue-sel' : 'border-line hover:border-blue')}>
              <span className="font-semibold num">{midDate(d)}</span>
              {m && <span className={cx('num', m.load_pct > 100 ? 'text-amber-text' : 'text-muted')}>{m.listed} listed · {pct0(m.load_pct)}{m.status === 'PUBLISHED' ? ' · published' : ''}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function HeldBackPanel({ day, onAdd }: { day: DayView; onAdd?: (caseId: string, caseNumber: string) => void }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <h2 className="font-bold flex items-center gap-2"><PauseCircle size={18} strokeWidth={1.8} className="text-amber" />Held back <span className="text-muted font-normal text-sm">({day.held_back.length})</span></h2>
      {day.held_back.length === 0 ? <p className="text-sm text-muted">Nothing held back for this day.</p> : (
        <ul className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
          {day.held_back.map((h) => (
            <li key={h.case_id} className="border border-line rounded-btn p-2 text-sm flex flex-col gap-1">
              <div className="flex items-center gap-2"><span className="font-semibold num">{h.case_number}</span><span className="text-muted">{htLabel(h.hearing_type)}</span></div>
              <p className="text-xs text-muted">{h.reason} · can be listed from <span className="num">{shortDate(h.eligible_from)}</span></p>
              {onAdd && <button className="btn-ghost min-h-[32px] px-2 text-xs self-start" onClick={() => onAdd(h.case_id, h.case_number)}><Plus size={14} />List anyway</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UnscheduledPanel({ onAdd }: { onAdd?: (caseId: string, caseNumber: string) => void }) {
  const q = useQuery({ queryKey: qk.unscheduled, queryFn: api.unscheduled })
  const items = q.data?.items ?? []
  return (
    <section className="card p-4 flex flex-col gap-2">
      <h2 className="font-bold">Waiting on process <span className="text-muted font-normal text-sm">({q.data ? items.length : '…'})</span></h2>
      {q.error ? <p className="text-sm text-red-text">{errMsg(q.error)}</p> : !q.data ? <Skeleton className="h-12" /> : items.length === 0 ? (
        <p className="text-sm text-muted">None. Every pending case has a date.</p>
      ) : <>
        <p className="text-xs text-muted">Cases that cannot be listed before the last planned day, usually because a summons or warrant is pending.</p>
        <ul className="flex flex-col gap-2 max-h-[260px] overflow-y-auto">
          {items.map((c) => (
            <li key={c.case_id} className="border border-line rounded-btn p-2 text-sm flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold num">{c.case_number}</span><span className="text-muted">{htLabel(c.next_purpose)}</span><AgeChip years={c.age_years} /></div>
              <p className="text-xs text-muted">{c.reason} · earliest <span className="num">{shortDate(c.earliest)}</span></p>
              {onAdd && <button className="btn-ghost min-h-[32px] px-2 text-xs self-start" onClick={() => onAdd(c.case_id, c.case_number)}><Plus size={14} />List anyway on this day</button>}
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}

function PublishModal({ open, date, onClose, onDone }: { open: boolean; date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { sitting } = useSittingDays(date)
  const { toastError } = useApp()
  const [extra, setExtra] = useState(0)
  const [busy, setBusy] = useState(false)
  const after = sitting.filter((d) => d > date)
  const to = extra > 0 ? after[Math.min(extra, after.length) - 1] ?? date : date
  const months = Array.from(new Set([monthOf(date), monthOf(to)]))
  const mq = useQueries({ queries: months.map((m) => ({ queryKey: qk.month(m), queryFn: () => api.month(m), enabled: open })) })
  const inRange = mq.flatMap((q) => q.data?.days ?? []).filter((d) => d.sitting && d.date >= date && d.date <= to)
  const draftN = inRange.filter((d) => d.status === 'DRAFT').length
  const tentN = inRange.filter((d) => d.status === 'TENTATIVE').length
  const listedN = inRange.filter((d) => d.status === 'DRAFT' || d.status === 'TENTATIVE').reduce((s, d) => s + d.listed, 0)
  const go = async () => {
    setBusy(true)
    try {
      const r = await api.publish(date, to)
      onDone(`Published ${r.days_published} ${r.days_published === 1 ? 'day' : 'days'} and ${r.hearings_published} hearings. Parties can now see their times.`)
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Publish the cause list"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={go} disabled={busy}>{busy && <Spinner light />}Publish {extra ? `${extra + 1} days` : 'this day'}</button></>}>
      <p>Publishing tells the parties their date and time window. After this, the planner will not move these hearings. Only an explicit change by you can.</p>
      <Stepper label="Also publish the next sitting days" value={extra} onChange={setExtra} min={0} max={Math.min(20, after.length)} />
      <p className="text-muted num">{extra ? <>From {midDate(date)} to {midDate(to)}</> : <>Only {midDate(date)}</>}</p>
      {mq.some((q) => q.isLoading) ? <p className="text-muted">Counting days…</p> : (
        <p className="num">This covers <b>{draftN}</b> draft {draftN === 1 ? 'day' : 'days'} and <b>{tentN}</b> tentative {tentN === 1 ? 'day' : 'days'} ({listedN} hearings). Days already published or closed are left as they are.</p>
      )}
      {tentN > 0 && <p className="text-xs text-teal-text">Publishing a tentative day makes its listings firm: the planner will stop moving them.</p>}
    </Modal>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green" />Likely to go ahead</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber" />May go ahead</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red" />Unlikely to go ahead</span>
      {(['SHORT', 'TRIAL', 'FINAL'] as const).map((g) => (
        <span key={g} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border-l-4" style={{ background: GROUP_COLOR[g].bg, borderColor: GROUP_COLOR[g].border }} />{GROUP_COLOR[g].label}</span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm border border-dashed border-teal bg-white" />Tentative</span>
      <span>The number is the calling order. Each hearing has its own time slot.</span>
    </div>
  )
}
