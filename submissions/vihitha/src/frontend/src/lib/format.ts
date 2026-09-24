import type { AgeBucket, ColorKey, DisposalType, HearingType, Kpi, Likelihood, ReasonGroup, Result } from '../api/types'

export const HEARING_LABEL: Record<HearingType, string> = {
  ADMISSION: 'Admission', DELAY_CONDONATION_HEARING: 'Delay Condonation', COGNIZANCE: 'Cognizance', APPEARANCE: 'Appearance',
  WARRANT: 'Warrant', PLEA: 'Plea', EXAMINATION_UNDER_S351_BNSS: 'Examination u/s 351 BNSS', EVIDENCE_COMPLAINANT: 'Evidence (Complainant)',
  EVIDENCE_ACCUSED: 'Evidence (Accused)', ARGUMENTS: 'Arguments', JUDGEMENT: 'Judgement', BAIL: 'Bail', REPORTS: 'Reports',
  APPLICATION_REVIEW: 'Application Review',
}
export const HEARING_TYPES = Object.keys(HEARING_LABEL) as HearingType[]
/** Label for any hearing type or stage string, falling back to a readable form. */
export const htLabel = (t: string | null | undefined) =>
  !t ? '—' : (HEARING_LABEL as Record<string, string>)[t] ?? t.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

/** The 11-stage lifecycle, in order. */
export const LIFECYCLE: HearingType[] = [
  'ADMISSION', 'DELAY_CONDONATION_HEARING', 'COGNIZANCE', 'APPEARANCE', 'WARRANT', 'PLEA',
  'EXAMINATION_UNDER_S351_BNSS', 'EVIDENCE_COMPLAINANT', 'EVIDENCE_ACCUSED', 'ARGUMENTS', 'JUDGEMENT',
]

export const RESULT_LABEL: Record<Result, string> = { MOVED_FORWARD: 'Moved forward', ADJOURNED: 'Adjourned', NOT_REACHED: 'Not reached', DISPOSED: 'Disposed' }
export const RESULT_TONE: Record<Result, 'green' | 'amber' | 'grey' | 'blue'> = { MOVED_FORWARD: 'green', ADJOURNED: 'amber', NOT_REACHED: 'grey', DISPOSED: 'blue' }
export const REASON_LABEL: Record<ReasonGroup, string> = {
  ABSENCE: 'Party or advocate absent', PREP: 'Not prepared', PROCESS: 'Summons or warrant pending', COURT: 'Court time or other reasons', UNCLEAR: 'Reason not recorded',
}
export const DISPOSAL_LABEL: Record<DisposalType, string> = { CONVICTION: 'Conviction', ACQUITTAL: 'Acquittal', JUDGEMENT: 'Judgement delivered', SETTLED: 'Settled', WITHDRAWN: 'Withdrawn', DISMISSED: 'Dismissed' }

export const LIKELIHOOD: Record<Likelihood, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  LIKELY: { tone: 'green', label: 'Likely to go ahead' },
  UNCERTAIN: { tone: 'amber', label: 'May go ahead' },
  UNLIKELY: { tone: 'red', label: 'Unlikely to go ahead' },
}

export const FLAG_LABEL: Record<string, string> = {
  OLD_CASE: '4+ years old', VERY_OLD_CASE: '5+ years old', REPEAT_ADJOURNED: 'Repeatedly adjourned', STUCK: 'Stuck at stage',
  PROCESS_PENDING: 'Waiting on process', LAST_CHANCE: 'Last chance', CARRIED_FORWARD: 'Carried forward',
}
export const flagLabel = (f: string) => FLAG_LABEL[f] ?? f.replace(/_/g, ' ').toLowerCase()

export const AGE_BUCKETS: AgeBucket[] = ['0-1', '1-3', '3-4', '4-5', '5+']
export const AGE_COLOR: Record<AgeBucket, string> = { '0-1': '#A9DEDF', '1-3': '#5FBFC1', '3-4': '#0F8B8D', '4-5': '#D98E04', '5+': '#C0392B' }
export const bucketOf = (years: number): AgeBucket => (years < 1 ? '0-1' : years < 3 ? '1-3' : years < 4 ? '3-4' : years < 5 ? '4-5' : '5+')
export const ageLabel = (b: AgeBucket) => `${b.replace('-', '–')} yrs`

/** Background band + border for time blocks. */
export const BLOCK_COLOR: Record<ColorKey, { bg: string; border: string; text: string }> = {
  short: { bg: '#E8F0FA', border: '#9CB9E0', text: '#1E5AA8' },
  evidence: { bg: '#E0F4F4', border: '#8FCFD0', text: '#0B6E70' },
  old: { bg: '#FBF1DC', border: '#E6C27A', text: '#8A5A00' },
  carry: { bg: '#EEF1F5', border: '#B5BFCC', text: '#5A6678' },
  fresh: { bg: '#E6F3EC', border: '#9FCDB2', text: '#1F6B41' },
  any: { bg: '#F6F9FC', border: '#DDE5EE', text: '#52627A' },
}
export const blockColor = (k: string | null | undefined) => BLOCK_COLOR[(k as ColorKey)] ?? BLOCK_COLOR.any

/** Fill colour for a day's load %. Amber once the day is over its budget. */
export function loadColor(pct: number | null | undefined) {
  const p = pct ?? 0
  if (p <= 0) return { bg: '#FFFFFF', text: '#52627A' }
  if (p > 100) return { bg: '#FBF1DC', text: '#8A5A00' }
  if (p >= 85) return { bg: '#5FBFC1', text: '#0B2545' }
  if (p >= 60) return { bg: '#A9DEDF', text: '#0B2545' }
  return { bg: '#E0F4F4', text: '#0B2545' }
}

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
export const addDays = (s: string, n: number) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d) }
export const daysBetween = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 864e5)
export const mondayOf = (s: string) => addDays(s, -((parseISO(s).getDay() + 6) % 7))
export const monthOf = (s: string) => s.slice(0, 7)
export const addMonths = (m: string, n: number) => { const d = parseISO(`${m}-01`); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7) }
export const monthLabel = (m: string) => parseISO(`${m}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
export const monthShort = (m: string) => parseISO(`${m.slice(0, 7)}-01`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

const fmt = (s: string, o: Intl.DateTimeFormatOptions) => parseISO(s).toLocaleDateString('en-GB', o)
/** Thu, 29 Oct 2026 */
export const longDate = (s: string | null | undefined) => (s ? fmt(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—')
/** Thu, 29 Oct */
export const midDate = (s: string | null | undefined) => (s ? fmt(s, { weekday: 'short', day: 'numeric', month: 'short' }) : '—')
/** 29 Oct */
export const shortDate = (s: string | null | undefined) => (s ? fmt(s, { day: 'numeric', month: 'short' }) : '—')
/** 29 Oct 2026 */
export const dayMonthYear = (s: string | null | undefined) => (s ? fmt(s, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
/** Friday, 25 September */
export const fullDay = (s: string) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' })

export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.round(n) % 60).padStart(2, '0')}`
/** 13:30 -> 1:30 (or 1:30 PM) */
export const clock = (t: string | null | undefined, ampm = false) => {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const s = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`
  return ampm ? `${s} ${h >= 12 ? 'PM' : 'AM'}` : s
}
export const span = (a: string | null | undefined, b: string | null | undefined) => `${clock(a)}–${clock(b)}`
export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`)
/** 0–100 number to "87%". */
export const pct0 = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)
/** 0–1 probability to "42%". */
export const prob = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
export const num = (v: number | null | undefined, d = 0) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }))

export function fmtKpi(k: Pick<Kpi, 'unit'>, v: number | null | undefined) {
  if (v == null) return '—'
  return k.unit === '%' ? `${Math.round(v)}%` : `${v.toFixed(1)}`
}
export function fmtKpiDelta(k: Pick<Kpi, 'unit'>, d: number) {
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  return k.unit === '%' ? `${sign}${Math.abs(Math.round(d))} pts` : `${sign}${Math.abs(d).toFixed(1)}`
}

/** "Suggested because …" with a lower-cased reason, unless the reason already reads that way. */
export function because(reason: string | null | undefined) {
  if (!reason) return ''
  const r = reason.trim()
  if (/^suggested because/i.test(r)) return r
  return `Suggested because ${r.charAt(0).toLowerCase()}${r.slice(1)}`
}

/** Plain sentence for a PlanSummary after a (re-)plan. */
export function planSentence(p: { hearings_created: number; days_planned: number; unscheduled_count: number; last_date?: string | null; firm_hearings?: number; tentative_days?: number }) {
  const cover = p.unscheduled_count === 0
    ? 'Every pending case has a date'
    : `${p.unscheduled_count.toLocaleString('en-IN')} ${p.unscheduled_count === 1 ? 'case is' : 'cases are'} waiting on process; every other pending case has a date`
  const last = p.last_date ? `; last tentative date ${dayMonthYear(p.last_date)}` : ''
  const detail = ` (${p.hearings_created.toLocaleString('en-IN')} listings over ${p.days_planned} days${p.tentative_days ? `, ${p.tentative_days} of them tentative` : ''}${p.firm_hearings != null ? `, ${p.firm_hearings.toLocaleString('en-IN')} firm` : ''}).`
  return cover + last + detail
}

export const GROUP_COLOR: Record<string, { bg: string; border: string; text: string; label: string }> = {
  SHORT: { bg: '#E8F0FA', border: '#1E5AA8', text: '#1E5AA8', label: 'Short matter' },
  TRIAL: { bg: '#E0F4F4', border: '#0F8B8D', text: '#0B6E70', label: 'Trial' },
  FINAL: { bg: '#FBF1DC', border: '#D98E04', text: '#8A5A00', label: 'Final stage' },
}
export const TENTATIVE_NOTE = 'Tentative: planned automatically; it will shift as the court records outcomes and gives next dates. Publish to make it firm.'
