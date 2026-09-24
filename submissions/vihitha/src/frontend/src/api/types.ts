// Vihitha API v3 types. Mirrors backend/API_CONTRACT_v3.md exactly (snake_case, dates YYYY-MM-DD, times HH:MM).
// Percentages are 0–100 numbers; probabilities (p_substantive, prob_ends_by_horizon) are 0–1.

// ---------- enums ----------
export type HearingType =
  | 'ADMISSION' | 'DELAY_CONDONATION_HEARING' | 'COGNIZANCE' | 'APPEARANCE' | 'WARRANT' | 'PLEA'
  | 'EXAMINATION_UNDER_S351_BNSS' | 'EVIDENCE_COMPLAINANT' | 'EVIDENCE_ACCUSED' | 'ARGUMENTS' | 'JUDGEMENT'
  | 'BAIL' | 'REPORTS' | 'APPLICATION_REVIEW'
export type DayStatus = 'DRAFT' | 'TENTATIVE' | 'PUBLISHED' | 'CLOSED'
export type HearingGroup = 'SHORT' | 'TRIAL' | 'FINAL'
export type HearingStatus = 'DRAFT' | 'PUBLISHED' | 'DONE' | 'CANCELLED'
export type Result = 'MOVED_FORWARD' | 'ADJOURNED' | 'NOT_REACHED' | 'DISPOSED'
export type ReasonGroup = 'ABSENCE' | 'PREP' | 'PROCESS' | 'COURT' | 'UNCLEAR'
export type DisposalType = 'CONVICTION' | 'ACQUITTAL' | 'JUDGEMENT' | 'SETTLED' | 'WITHDRAWN' | 'DISMISSED'
export type AgeBucket = '0-1' | '1-3' | '3-4' | '4-5' | '5+'
export type Likelihood = 'LIKELY' | 'UNCERTAIN' | 'UNLIKELY'
export type Flag = 'OLD_CASE' | 'VERY_OLD_CASE' | 'REPEAT_ADJOURNED' | 'STUCK' | 'PROCESS_PENDING' | 'LAST_CHANCE' | 'CARRIED_FORWARD'
export type CaseStatus = 'PENDING' | 'DISPOSED'
export type HearingOrigin = 'PLANNER' | 'JUDGE' | 'NEXT_DATE' | 'CARRY_FORWARD'
export type ColorKey = 'short' | 'evidence' | 'old' | 'carry' | 'fresh' | 'any'
export type PresetName = 'optimal' | 'sehgal' | 'dimakar' | 'joshi' | 'baseline' | 'custom'
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI'
export type KpiKey = 'moved_forward' | 'old_cases_heard' | 'court_time_used' | 'heard_on_promised'
export type LifecycleState = 'DONE' | 'CURRENT' | 'UPCOMING' | 'SKIPPED'
export type AttentionCode = 'REPEAT_ADJOURNED' | 'STUCK' | 'AGEING_RISK' | 'OLD_NOT_HEARD' | 'WAITING_ON_PROCESS'

export interface ErrorBody { error: { code: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT' | 'INTERNAL' | string; message: string; details?: unknown } }

// ---------- shared schemas ----------
export interface HearingResult {
  result: Result; reason_group: ReasonGroup | null; disposal_type: DisposalType | null
  actual_start: string | null; actual_end: string | null; note: string | null
}
export interface HearingEvent {
  hearing_id: number; case_id: string; case_number: string; title: string
  hearing_type: HearingType; stage: HearingType; age_years: number; age_bucket: AgeBucket; advocate_id: string
  date: string; block_id: string; window_start: string; window_end: string; est_start: string; est_end: string
  duration_min: number; expected_minutes: number
  likelihood: Likelihood; p_substantive: number
  reason: string
  status: HearingStatus; pinned: boolean; carried_forward: boolean; first_promised_date: string | null
  origin: HearingOrigin | string
  /** v3.1: soft listing on a TENTATIVE day; 1..n calling order; chip colour group. */
  tentative: boolean; queue_position: number; group: HearingGroup
  result: HearingResult | null
  flags: string[]
}
export interface Window { start: string; end: string; block_id: string; hearing_ids: number[]; expected_minutes: number; capacity_minutes: number }
export interface Block { id: string; label: string; start: string; end: string; color_key: ColorKey }
export interface DayTotals {
  date: string; listed: number; expected_minutes: number; capacity_minutes: number; load_pct: number; old_cases: number
  unused_minutes: number
  moved_forward: number | null; adjourned: number | null; not_reached: number | null
}
export interface Kpi {
  key: KpiKey; label: string; value: number; unit: 'per week' | '%'
  compare_value: number | null; delta: number | null; better: boolean | null; is_forecast: boolean; detail: string | null
}
export interface Warning { field: string; requested: unknown; applied: unknown; message: string }
export interface DateRange3 { p10: string; p50: string; p90: string }
export interface CaseSummary {
  case_id: string; case_number: string; stage: HearingType; next_purpose: HearingType | string; status: CaseStatus
  age_years: number; age_bucket: AgeBucket; advocate_id: string
  next_hearing: { hearing_id: number; date: string; window_start: string; window_end: string; status: HearingStatus; tentative: boolean } | null
  projected_end: DateRange3 | null; prob_ends_by_horizon: number | null
  likely_to_finish: boolean | null
  flags: string[]
}
export interface PlanSummary {
  from: string; to: string; days_planned: number; hearings_created: number; unscheduled_count: number; warnings: Warning[]
  /** v3.1 */
  tentative_days: number; last_date: string | null; firm_hearings: number
}
export interface NextDateSuggestion {
  hearing_id: number; case_id: string; next_purpose: HearingType | string
  suggested: { date: string; window_start: string; window_end: string; reason: string }
  alternatives: { date: string; reason: string }[]
  window: { min: string; target: string; max: string }
  vs_flat_default_days: number
  heatmap: { date: string; sitting: boolean; load_pct: number }[]
}
export interface HeldBack { case_id: string; case_number: string; hearing_type: HearingType; reason: string; eligible_from: string }
export interface DayView {
  date: string; status: DayStatus | null; sitting: boolean; holiday_name: string | null; leave: boolean; leave_note: string | null
  day_start: string; day_end: string; lunch: [string, string]
  blocks: Block[]; windows: Window[]; hearings: HearingEvent[]; totals: DayTotals
  idle_reason?: string | null  // why part of a planned day is free (null when the day is full)
  held_back: HeldBack[]
  ruleset: { id: number; name: string } | null
}
export interface RuleBlock {
  id: string; label: string; start: string; end: string
  hearing_types: HearingType[] | null; min_age_years: number | null; carried_forward_only: boolean; color_key: ColorKey
}
export interface AgentsConfig {
  enabled: boolean; trait_sd: number; slot_bonus: number; notice_bonus: number; notice_min_days: number
  cluster_bonus: number; fatigue_per_miss: number; fatigue_cap: number; last_chance_bonus: number
}
export interface RulesBody {
  name: string; preset: PresetName
  capacity_minutes: number
  day: { start: string; lunch_start: string; lunch_end: string; end: string }
  fill_target: number | null  // null = no minutes cap (baseline)
  max_listed_per_day: number | null
  window_minutes: number | null  // null = use the court setting
  blocks: RuleBlock[]
  priority_weights: { age: number; p_substantive: number; waiting: number; near_disposal: number; fresh: number }
  clustering: { by_advocate: boolean; purpose_days: Partial<Record<Weekday, HearingType[]>> | null }
  ageing_quota_pct: number; max_wait_days_4y: number
  carry_forward_same_weekday: boolean; prerequisite_check: boolean
  next_date_mode: 'REFERENCE' | 'FLAT_60'; next_date_window_factor: number
  slots: boolean; require_case_summary_4y: boolean; summary_prep_reduction: number
  settlement_prob: number; duration_sigma: number; adjourn_call_minutes: number
  learning: boolean
  agents: AgentsConfig
}
export interface Ruleset { id: number; name: string; preset: PresetName | string; is_active: boolean; rules: RulesBody; created_at: string; updated_at: string }
export interface RulesetListItem { id: number; name: string; preset: PresetName | string; is_active: boolean; updated_at: string }

// ---------- 8.1 health and setup ----------
export interface Health {
  status: string; db: string; today: string; roster_loaded: boolean
  active_ruleset: { id: number; name: string } | null; court_name: string
}
export interface RosterSummary {
  cases: number; pending: number; disposed: number; advocates: number; pct_4y_plus: number; pct_5y_plus: number
  by_stage: { stage: HearingType; count: number }[]; by_bucket: { bucket: AgeBucket; count: number }[]
  source: string | null; seed: number | null
}
export interface RosterLoadRequest { source: 'SAMPLE' | 'GENERATE'; n?: number; seed?: number; reset?: boolean }
export interface RosterLoadResponse { roster: RosterSummary; plan: PlanSummary }
export interface ReferenceHearingType {
  type: HearingType; label: string; duration_min: number; reference_gap_days: number; p_substantive: number
  expected_hearings: number; min_h: number; max_h: number; mean_h: number; median_h: number
  sources: { p_substantive: 'real' | 'estimated'; failures: 'real' | 'estimated' }
  failure_reasons: Record<string, number>; reason_groups: Record<string, number>
}
export interface Reference {
  hearing_types: ReferenceHearingType[]
  reason_groups: { group: ReasonGroup; label: string; columns: string[] }[]
}
export interface CalendarDay { date: string; weekday: string; sitting: boolean; holiday_name: string | null; leave: boolean; leave_note: string | null }
export interface LeaveResponse { date: string; hearings_moved: number; published_hearings_affected: HearingEvent[] }
export interface Settings { horizon_working_days: number; window_minutes: number; today: string }

// ---------- 8.2 rules ----------
export interface Preset { id: string; name: string; description: string; rules: RulesBody; warnings: Warning[] }
export interface RulesetWrite { ruleset: Ruleset; warnings: Warning[] }
export interface ActivateResponse { active: Ruleset; plan: PlanSummary; warnings: Warning[] }

// ---------- 8.3 calendar and schedule ----------
export interface WeekBlock { id: string; label: string; start: string; end: string; color_key: ColorKey; listed: number; load_pct: number }
export interface WeekDay {
  date: string; weekday: string; status: DayStatus | null; sitting: boolean; holiday_name: string | null; leave: boolean
  blocks: WeekBlock[]; totals: DayTotals
}
export interface WeekView { start: string; days: WeekDay[] }
export interface MonthDay {
  date: string; weekday: string; sitting: boolean; holiday_name: string | null; leave: boolean; status: DayStatus | null
  listed: number; load_pct: number; old_cases: number; moved_forward: number | null
}
export interface MonthView { month: string; days: MonthDay[] }
export interface PublishResponse { days_published: number; hearings_published: number }
export type UnscheduledItem = CaseSummary & { earliest: string; reason: string }

// ---------- 8.4 hearings ----------
export type ChangeType = 'ADD' | 'MOVE' | 'REMOVE' | 'PIN'
export interface Change { type: ChangeType; hearing_id?: number; case_id?: string; to_date?: string; to_window_start?: string; pinned?: boolean }
export interface PreviewResponse { kpi_deltas: Kpi[]; days: { date: string; load_pct_before: number; load_pct_after: number }[]; warnings: Warning[]; message: string }
export interface AddHearingResponse { hearing: HearingEvent; day_totals: DayTotals }
export interface MoveHearingRequest { to_date?: string; to_window_start?: string; pinned?: boolean; force?: boolean }
export interface MoveHearingResponse { hearing: HearingEvent; affected_days: DayTotals[] }
export interface RemoveHearingResponse { case: CaseSummary; suggestion: NextDateSuggestion | null }
export interface OutcomeRequest {
  result: Result; reason_group?: ReasonGroup; disposal_type?: DisposalType
  actual_start?: string; actual_end?: string; note?: string
}
export interface OutcomeResponse { hearing: HearingEvent; case: CaseSummary; next_date: NextDateSuggestion | null; day_totals: DayTotals }
export interface ConfirmNextDateRequest { date?: string; accept_suggestion?: boolean; window_start?: string }
export interface CloseDayResponse { carried_forward: number; plan: PlanSummary; today: string }

// ---------- 8.5 cases ----------
export type CaseSort = 'age_desc' | 'age_asc' | 'end_asc' | 'end_desc' | 'next_date' | 'case_number'
export interface CaseQuery {
  stage?: string; bucket?: string; status?: string; q?: string; ends_before?: string; flag?: string
  sort?: CaseSort; page?: number; size?: number
}
export interface CaseList { items: CaseSummary[]; total: number; page: number; size: number }
export interface CaseForecast {
  how_it_ends: string
  remaining_stages: { stage: HearingType; expected_hearings: number; expected_days: number }[]
  projected_end: DateRange3; prob_ends_by_horizon: number; explanation: string
}
export type CaseDetail = CaseSummary & {
  filing_date: string; party_id: string; last_hearing_summary: string
  lifecycle: { stage: HearingType; index: number; state: LifecycleState; hearings_so_far: number }[]
  hearing_counts: Partial<Record<HearingType, number>>
  history: HearingEvent[]
  upcoming: HearingEvent[]
  forecast: CaseForecast | null
}
export interface ForecastSummary {
  horizon_end: string; median_days_to_end: number; pct_ending_by_horizon: number
  ending_by_month: { month: string; count: number }[]
  by_stage: { stage: HearingType; cases: number; median_days_to_end: number }[]
}

// ---------- 8.6 what-if ----------
export interface WhatIfRequest {
  ruleset_id?: number; rules?: RulesBody; preset?: string
  compare_to: 'ACTIVE' | 'BASELINE' | number
  horizon_days: 30 | 60 | 90
  focus_date?: string; agents: boolean; runs?: number
}
export interface WhatIfMonthDay {
  date: string; sitting: boolean; listed: number; load_pct: number; expected_moved_forward: number; old_cases: number
  compare_listed: number; compare_load_pct: number
}
export interface WhatIfResult {
  id: string; rules_applied: RulesBody; compare_label: string; warnings: Warning[]
  focus_day: DayView; focus_day_compare: DayTotals
  month: WhatIfMonthDay[]
  kpis: Kpi[]; cost_sentences: string[]
  agents_effect: { show_rate_without: number; show_rate_with: number; sentence: string } | null
  advocate_trips: { candidate: number; compare: number; sentence: string } | null
}
export interface WhatIfApplyResponse { active_ruleset: Ruleset; plan: PlanSummary; warnings: Warning[] }

// ---------- 8.7 metrics ----------
export type AttentionCase = CaseSummary & { why: string; suggested_action: string }
export interface MetricsSummary {
  from: string; to: string; today: string
  kpis: Kpi[]
  weekly: { week_start: string; moved_forward: number; court_time_pct: number; heard_on_promised_pct: number; is_forecast: boolean }[]
  backlog_by_age: { week_start: string; buckets: Record<AgeBucket, number>; is_forecast: boolean }[]
  needs_attention: { code: AttentionCode | string; label: string; count: number; top: AttentionCase[] }[]
  cases_ending: { this_month: number; next_month: number }
}
export interface ScoringMetric { key: string; label: string; value: number; unit: string; baseline: number | null; delta: number | null; better: boolean | null; tooltip: string }
export interface Scoring { source: 'actual' | 'simulated'; from: string; to: string; metrics: ScoringMetric[] }

// ---------- 8.8 public ----------
export type PublicStatus = 'SCHEDULED' | 'RUNNING_LATE' | 'IN_PROGRESS' | 'DONE' | 'NOT_LISTED_TODAY' | 'NOT_SCHEDULED'
export interface PublicSlot {
  case_number: string; date: string | null; court_name: string; court_address: string
  window_start: string | null; window_end: string | null; status: PublicStatus
  eta: string | null; delay_minutes: number | null; queue_position: number | null
  what_to_bring: string[]; message_en: string; message_ml: string
}
