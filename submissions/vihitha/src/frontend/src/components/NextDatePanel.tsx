import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lightbulb } from 'lucide-react'
import { api, errMsg } from '../api/client'
import { qk, refreshAll } from '../api/queries'
import type { NextDateSuggestion } from '../api/types'
import { useApp } from '../lib/app'
import { addDays, because, htLabel, longDate, midDate, parseISO, shortDate, span } from '../lib/format'
import { CloseBtn, cx, Drawer, ErrorCard, Loading, Spinner } from './ui'

const RAMP = ['#E0F4F4', '#A9DEDF', '#5FBFC1', '#0F8B8D', '#0A5F61']
const step = (p: number) => Math.min(4, Math.max(0, Math.floor(p / 20)))

export function NextDatePanel() {
  const { nextDate: t, openNextDate } = useApp()
  const close = () => openNextDate(null)
  return (
    <Drawer open={!!t} onClose={close} width={520} labelledBy="nd-title">
      {t && <Body key={t.hearingId} close={close} />}
    </Drawer>
  )
}

function Body({ close }: { close: () => void }) {
  const { nextDate: t, toast, toastError } = useApp()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: qk.nextDate(t!.hearingId), queryFn: () => api.nextDate(t!.hearingId),
    initialData: t!.suggestion ?? undefined, staleTime: t!.suggestion ? 30_000 : 0,
  })
  const s: NextDateSuggestion | undefined = q.data
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (s) { setSel((v) => v ?? s.suggested.date); setTimeout(() => confirmRef.current?.focus(), 0) } }, [s])

  const confirm = async () => {
    if (!sel || !s || busy) return
    setBusy(true)
    try {
      const accepted = sel === s.suggested.date
      const r = await api.confirmNextDate(t!.hearingId, accepted ? { date: sel, accept_suggestion: true, window_start: s.suggested.window_start } : { date: sel, accept_suggestion: false })
      await refreshAll(qc)
      toast({ msg: `${t!.caseNumber} next listed on ${midDate(r.next_hearing.date)}, ${span(r.next_hearing.window_start, r.next_hearing.window_end)}.` })
      close()
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  const vs = s?.vs_flat_default_days ?? 0

  return (
    <form className="flex flex-col h-full" onSubmit={(e) => { e.preventDefault(); confirm() }}>
      <header className="flex items-start gap-3 px-6 py-5 border-b border-line">
        <div className="flex-1">
          <h2 id="nd-title" className="text-xl font-bold">Next date</h2>
          <p className="text-sm text-muted num">{t!.caseNumber}{t!.outcome && <> · {t!.outcome}</>}{s && <> · next: {htLabel(s.next_purpose)}</>}</p>
        </div>
        <CloseBtn onClick={close} />
      </header>

      {q.error && !s ? <div className="p-6"><ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /></div> : !s ? <div className="p-6"><Loading label="Finding a date…" /></div> : (
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          <div className="rounded-card bg-teal-light p-4 flex gap-3">
            <Lightbulb size={20} strokeWidth={1.8} className="text-teal-text shrink-0 mt-1" />
            <div>
              <div className="text-2xl font-bold num">{longDate(s.suggested.date)}</div>
              <div className="text-sm font-semibold num">{span(s.suggested.window_start, s.suggested.window_end)}</div>
              <p className="text-sm text-teal-text mt-1">{because(s.suggested.reason)}</p>
              <p className="text-sm font-semibold mt-1">{vs > 0 ? `${vs} days sooner than the flat 60-day default` : vs < 0 ? `${-vs} days later than the flat 60-day default` : 'Same as the flat 60-day default'}</p>
              <p className="text-xs text-muted mt-1 num">Sensible range: {shortDate(s.window.min)} – {shortDate(s.window.max)} (ideal {shortDate(s.window.target)})</p>
            </div>
          </div>

          {s.heatmap.length > 0 && <Heatmap s={s} selected={sel} onPick={setSel} />}

          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-2">Or choose</legend>
            <div className="flex flex-col gap-2">
              {[{ date: s.suggested.date, reason: s.suggested.reason, tag: 'Suggested' }, ...s.alternatives.map((a) => ({ ...a, tag: '' }))].map((c) => (
                <button type="button" key={c.date} aria-pressed={sel === c.date} onClick={() => setSel(c.date)}
                  className={cx('min-h-[44px] px-3 py-2 rounded-[12px] border text-sm text-left', sel === c.date ? 'border-blue bg-blue-sel' : 'border-line hover:border-blue')}>
                  <span className={cx('num font-semibold', sel === c.date && 'text-blue')}>{midDate(c.date)}</span>
                  {c.tag && <span className="ml-2 text-xs text-teal-text font-semibold">{c.tag}</span>}
                  {c.reason && <span className="block text-xs text-muted">{c.reason}</span>}
                </button>
              ))}
              <label className="relative min-h-[44px] px-3 rounded-[12px] border border-dashed border-line text-sm inline-flex items-center hover:border-blue cursor-pointer">
                {sel && ![s.suggested.date, ...s.alternatives.map((a) => a.date)].includes(sel) ? <>Your date: <span className="num font-semibold ml-1">{midDate(sel)}</span></> : 'Pick another date'}
                <input type="date" aria-label="Other date" min={addDays(s.heatmap[0]?.date ?? s.window.min, 1)} className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => e.target.value && setSel(e.target.value)} />
              </label>
            </div>
          </fieldset>
        </div>
      )}

      <footer className="flex justify-end gap-3 px-6 py-4 border-t border-line">
        <button type="button" className="btn-secondary" onClick={close}>Decide later</button>
        <button ref={confirmRef} type="submit" className="btn-primary min-w-[160px]" disabled={!sel || busy}>{busy && <Spinner light />}{sel ? `Confirm ${shortDate(sel)}` : 'Confirm'}</button>
      </footer>
    </form>
  )
}

function Heatmap({ s, selected, onPick }: { s: NextDateSuggestion; selected: string | null; onPick: (d: string) => void }) {
  const days = s.heatmap
  const monday = addDays(days[0].date, -((parseISO(days[0].date).getDay() + 6) % 7))
  const byDate = new Map(days.map((d) => [d.date, d]))
  const weeks = Array.from({ length: 7 }, (_, w) => Array.from({ length: 5 }, (_, i) => addDays(monday, w * 7 + i))).filter((wk) => wk.some((d) => byDate.has(d)))
  const suggested = s.suggested.date
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="label">Next 6 weeks · how full each day is</span>
        <span className="flex items-center gap-1 text-xs text-muted">Empty {RAMP.map((c) => <span key={c} className="w-3 h-3 rounded-sm" style={{ background: c }} />)} Full</span>
      </div>
      <div className="grid grid-cols-[56px_repeat(5,1fr)] gap-1.5 text-xs">
        <span />
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <span key={d} className="text-center text-muted font-semibold">{d}</span>)}
        {weeks.map((wk) => (
          <div key={wk[0]} className="contents">
            <span className="text-muted self-center num">{shortDate(wk[0])}</span>
            {wk.map((d) => {
              const c = byDate.get(d)
              if (!c) return <span key={d} className="h-10" />
              if (!c.sitting) return <span key={d} className="h-10 rounded-md border border-dashed border-grey text-grey-text flex items-center justify-center" aria-label={`${midDate(d)}: no sitting`}>Hol</span>
              const st = step(c.load_pct)
              const inWin = d >= s.window.min && d <= s.window.max
              return (
                <button type="button" key={d} onClick={() => onPick(d)} aria-pressed={selected === d}
                  aria-label={`${midDate(d)}: ${Math.round(c.load_pct)}% full`} title={`${midDate(d)} · ${Math.round(c.load_pct)}% full${inWin ? ' · within the sensible range' : ''}`}
                  className={cx('h-10 rounded-md num font-semibold transition-shadow', st >= 3 ? 'text-white' : 'text-navy', !inWin && 'opacity-60',
                    d === suggested && 'ring-2 ring-blue ring-offset-1', selected === d && d !== suggested && 'ring-2 ring-navy ring-offset-1', c.load_pct > 100 && 'outline outline-2 outline-amber')}
                  style={{ background: RAMP[st] }}>
                  {parseISO(d).getDate()}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">Faded days fall outside the sensible range for this hearing. Amber outline means the day is already over its time budget.</p>
    </div>
  )
}
