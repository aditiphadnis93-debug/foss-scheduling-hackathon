import type * as T from './types'

/** Backend origin. The API lives under /api/v1. */
export const API_ORIGIN: string = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8000'
export const API_BASE = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) }
}

async function req<R>(method: string, path: string, body?: unknown): Promise<R> {
  const form = body instanceof FormData
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: body !== undefined && !form ? { 'Content-Type': 'application/json' } : undefined,
      body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the Vihitha server at ${API_ORIGIN}. Check that it is running.`)
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as Partial<T.ErrorBody> & { detail?: unknown } | null
    const msg = err?.error?.message
      ?? (typeof err?.detail === 'string' ? err.detail : null)
      ?? `${res.status} ${res.statusText}`
    throw new ApiError(res.status, err?.error?.code ?? String(res.status), msg, err?.error?.details)
  }
  if (res.status === 204) return undefined as R
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('json') ? res.json() : res.text()) as Promise<R>
}

const enc = encodeURIComponent
const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${enc(String(v))}`)
  return p.length ? `?${p.join('&')}` : ''
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const api = {
  // 8.1 health and setup
  health: () => req<T.Health>('GET', '/health'),
  loadRoster: (body: T.RosterLoadRequest | FormData) => req<T.RosterLoadResponse>('POST', '/setup/roster', body),
  rosterSummary: () => req<T.RosterSummary>('GET', '/setup/roster/summary'),
  reference: () => req<T.Reference>('GET', '/setup/reference'),
  calendar: (from: string, to: string) => req<{ days: T.CalendarDay[] }>('GET', `/setup/calendar${qs({ from, to })}`),
  addLeave: (date: string, note?: string) => req<T.LeaveResponse>('POST', '/setup/leave', { date, note }),
  removeLeave: (date: string) => req<void>('DELETE', `/setup/leave/${date}`),
  settings: () => req<T.Settings>('GET', '/setup/settings'),
  saveSettings: (s: Partial<T.Settings>) => req<T.Settings>('PUT', '/setup/settings', s),
  reset: () => req<void>('POST', '/setup/reset', { confirm: true }),

  // 8.2 rules
  presets: () => req<{ presets: T.Preset[] }>('GET', '/rules/presets'),
  rulesets: () => req<{ items: T.RulesetListItem[] }>('GET', '/rulesets'),
  createRuleset: (name: string, rules: T.RulesBody) => req<T.RulesetWrite>('POST', '/rulesets', { name, rules }),
  ruleset: (id: number) => req<{ ruleset: T.Ruleset }>('GET', `/rulesets/${id}`),
  updateRuleset: (id: number, rules: T.RulesBody, name?: string) => req<T.RulesetWrite>('PUT', `/rulesets/${id}`, { name, rules }),
  deleteRuleset: (id: number) => req<void>('DELETE', `/rulesets/${id}`),
  activate: (ruleset_id: number, replan_from?: string) => req<T.ActivateResponse>('PUT', '/rules/active', { ruleset_id, replan_from }),

  // 8.3 calendar and schedule
  day: (date: string) => req<T.DayView>('GET', `/calendar/day/${date}`),
  week: (start: string) => req<T.WeekView>('GET', `/calendar/week${qs({ start })}`),
  month: (month: string) => req<T.MonthView>('GET', `/calendar/month${qs({ month })}`),
  plan: (body: { from?: string; to?: string; force?: boolean } = {}) => req<T.PlanSummary>('POST', '/schedule/plan', body),
  publish: (from: string, to: string) => req<T.PublishResponse>('POST', '/schedule/publish', { from, to }),
  unpublish: (date: string) => req<{ date: string; status: T.DayStatus }>('POST', '/schedule/unpublish', { date }),
  unscheduled: () => req<{ items: T.UnscheduledItem[] }>('GET', '/schedule/unscheduled'),

  // 8.4 hearings
  preview: (change: T.Change) => req<T.PreviewResponse>('POST', '/hearings/preview', { change }),
  addHearing: (case_id: string, date: string, window_start?: string) => req<T.AddHearingResponse>('POST', '/hearings', { case_id, date, window_start }),
  moveHearing: (id: number, body: T.MoveHearingRequest) => req<T.MoveHearingResponse>('PATCH', `/hearings/${id}`, body),
  removeHearing: (id: number, force?: boolean) => req<T.RemoveHearingResponse>('DELETE', `/hearings/${id}${qs({ force: force || undefined })}`),
  outcome: (id: number, body: T.OutcomeRequest) => req<T.OutcomeResponse>('POST', `/hearings/${id}/outcome`, body),
  nextDate: (id: number) => req<T.NextDateSuggestion>('GET', `/hearings/${id}/next-date`),
  confirmNextDate: (id: number, body: T.ConfirmNextDateRequest) => req<{ next_hearing: T.HearingEvent }>('POST', `/hearings/${id}/next-date`, body),
  closeDay: (date: string) => req<T.CloseDayResponse>('POST', `/calendar/day/${date}/close`),
  autoOutcomes: (date: string, body: { seed?: number; agents?: boolean } = {}) => req<T.DayView>('POST', `/calendar/day/${date}/auto-outcomes`, body),

  // 8.5 cases
  cases: (q: T.CaseQuery) => req<T.CaseList>('GET', `/cases${qs({ ...q })}`),
  caseDetail: (id: string) => req<T.CaseDetail>('GET', `/cases/${enc(id)}`),
  forecastSummary: () => req<T.ForecastSummary>('GET', '/cases/forecast/summary'),

  // 8.6 what-if
  whatif: (body: T.WhatIfRequest) => req<T.WhatIfResult>('POST', '/whatif', body),
  applyWhatif: (id: string, body: { from_date?: string; name?: string }) => req<T.WhatIfApplyResponse>('POST', `/whatif/${enc(id)}/apply`, body),

  // 8.7 metrics
  metrics: (from?: string, to?: string) => req<T.MetricsSummary>('GET', `/metrics/summary${qs({ from, to })}`),
  scoring: (source: 'actual' | 'simulated', from?: string, to?: string) => req<T.Scoring>('GET', `/metrics/scoring${qs({ from, to, source })}`),

  // 8.8 public
  publicSlot: (caseNo: string) => req<T.PublicSlot>('GET', `/public/slot${qs({ case_no: caseNo })}`),
}

// 8.9 export (plain links, the browser downloads the CSV)
export const exportUrls = {
  causeList: (date: string) => `${API_BASE}/export/cause-list.csv${qs({ date })}`,
  proposedSchedule: (from?: string, to?: string) => `${API_BASE}/export/proposed_schedule.csv${qs({ from, to })}`,
}
