/**
 * sama-panda shim for Court-Time-Planner.
 * Live data: FastAPI readiness at VITE_READINESS_URL (default http://127.0.0.1:8000).
 * Cause List Generate: live POST /generate per date. Calendar: GET /calendar (fallback public CSV).
 * Impact/Finalise: DEMO-STATIC (no CTP Python engine).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";

// Re-export schema types used by pages (keep CTP shapes)
export type {
  Case,
  Reason,
  RosterSummary,
  CountGroup,
  CalendarDay,
  CalendarSettings,
  Dashboard,
  Rules,
  Move,
  ScheduleRequest,
  SchedulePreview,
  ScheduleDay,
  ScheduledCase,
  HeldCase,
  Impact,
  ImpactMetrics,
  ImpactRequest,
  OutlookPoint,
  AffectedCase,
  PublishRequest,
  PublishResult,
  Publication,
  RosterUpload,
  HearingDefect,
} from "./generated/api.schemas";

export {
  RulesPreset,
  RulesFullness,
  RulesOrder,
  ScheduleRequestPeriod,
  ScheduledCaseLikelihood,
  HearingDefectCode,
  HearingDefectConfidence,
  HearingDefectOwner,
} from "./generated/api.schemas";

import type {
  Case,
  CalendarDay,
  CalendarSettings,
  Dashboard,
  Rules,
  Move,
  ScheduleRequest,
  SchedulePreview,
  ScheduleDay,
  ScheduledCase,
  HeldCase,
  Impact,
  Publication,
  PublishResult,
  RosterSummary,
} from "./generated/api.schemas";
import {
  RulesPreset,
  RulesFullness,
  RulesOrder,
  ScheduledCaseLikelihood,
} from "./generated/api.schemas";

export type ActorRole = "counsel" | "party" | "registry";
export type ReadinessStatus = "READY" | "BLOCKED" | "HEALING";

export type Defect = {
  id: string;
  case_number: string;
  code: string;
  purpose: string;
  owner: string;
  severity: string;
  status: string;
  source?: string;
  evidence_uri?: string | null;
  note?: string | null;
  reject_reason?: string | null;
  due_at?: string | null;
  updated_at?: string;
  updated_by?: string;
  action_label: string;
  can_act: boolean;
  primary_action?: string;
  blocking?: boolean;
  locked_by_law?: boolean;
};

export type PolicyItem = {
  code: string;
  blocking: boolean;
  locked_by_law: boolean;
  severity: string;
  /** Plain-English “what it means”; from GET /policy when loops ships it. */
  description?: string;
};

export { DEFECT_PLAIN, defectWhatItMeans } from "./defect-copy";

export type PolicyResponse = {
  count: number;
  policy: PolicyItem[];
};

export type CaseDetail = Case & {
  case_number: string;
  readiness_status: ReadinessStatus;
  open_defect_count: number;
  defects: Defect[];
  duration_mins_estimate?: number | null;
  show_intent_window?: string | null;
  updated_at?: string;
  current_stage?: string;
  purpose_of_next_hearing?: string;
};

export type ApiCaseListItem = {
  case_number: string;
  filing_number?: string;
  filing_date?: string;
  age_days?: number;
  purpose?: string;
  stage?: string;
  readiness_status: ReadinessStatus;
  open_defect_count: number;
  advocate_id?: string;
  party_id?: string;
  duration_mins_estimate?: number | null;
};

const BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_READINESS_URL) ||
  "http://127.0.0.1:8000";

let actorRole: ActorRole = (typeof localStorage !== "undefined" &&
  (localStorage.getItem("sama-actor-role") as ActorRole)) ||
  "counsel";
const actorListeners = new Set<() => void>();

export function getActorRole(): ActorRole {
  return actorRole;
}
export function setActorRole(role: ActorRole) {
  actorRole = role;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("sama-actor-role", role);
  }
  actorListeners.forEach((l) => l());
}
export function subscribeActorRole(cb: () => void): () => void {
  actorListeners.add(cb);
  return () => {
    actorListeners.delete(cb);
  };
}

export function setBaseUrl(_url: string) {
  /* no-op: readiness base is VITE_READINESS_URL */
}
export function setAuthTokenGetter(_g: unknown) {
  /* stub auth uses X-Actor-Role only */
}
export type AuthTokenGetter = () => string | null | Promise<string | null>;

async function api<T>(
  path: string,
  init: RequestInit & { role?: ActorRole } = {},
): Promise<T> {
  const role = init.role ?? getActorRole();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Role", role);
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ? JSON.stringify(j.detail) : detail;
    } catch {
      /* ignore */
    }
    const err = new Error(`API ${res.status}: ${detail}`) as Error & {
      status: number;
      data?: { error?: string };
    };
    err.status = res.status;
    err.data = { error: detail };
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function mapListItem(c: ApiCaseListItem): Case & {
  readiness_status: ReadinessStatus;
  open_defect_count: number;
  case_number: string;
} {
  const status = c.readiness_status;
  const flags: string[] = [status];
  if ((c.open_defect_count || 0) > 0) flags.push("HAS_DEFECTS");
  if ((c.age_days || 0) >= 1460) flags.push("OLD_CASE");
  return {
    id: c.case_number,
    case_number: c.case_number,
    filingNumber: c.filing_number || c.case_number,
    filingDate: c.filing_date || "",
    advocateId: c.advocate_id || "",
    partyId: c.party_id || "",
    stage: c.stage || "",
    purpose: c.purpose || "",
    lastHearing: "",
    totalHearings: 0,
    ageYears: Math.round(((c.age_days || 0) / 365.25) * 10) / 10,
    flags,
    waitingOn: status === "READY" ? "" : `${c.open_defect_count} open defect(s)`,
    history: [],
    reasons: [],
    readiness_status: status,
    open_defect_count: c.open_defect_count || 0,
  };
}

function mapDetail(d: Record<string, unknown>): CaseDetail {
  const status = (d.readiness_status as ReadinessStatus) || "BLOCKED";
  const defects = (d.defects as Defect[]) || [];
  const open = (d.open_defect_count as number) ?? defects.filter((x) => !["cleared", "waived"].includes(x.status)).length;
  const flags: string[] = [status];
  if (open > 0) flags.push("HAS_DEFECTS");
  const ageDays = (d.age_days as number) || 0;
  if (ageDays >= 1460) flags.push("OLD_CASE");
  return {
    id: String(d.case_number),
    case_number: String(d.case_number),
    filingNumber: String(d.filing_number || d.case_number),
    filingDate: String(d.filing_date || ""),
    advocateId: String(d.advocate_id || ""),
    partyId: String(d.party_id || ""),
    stage: String(d.stage || d.current_stage_norm || d.current_stage || ""),
    purpose: String(d.purpose || d.purpose_norm || d.purpose_of_next_hearing || ""),
    lastHearing: String(d.last_hearing_summary || ""),
    totalHearings: Number(d.total_hearings_held || 0),
    ageYears: Math.round((ageDays / 365.25) * 10) / 10,
    flags,
    waitingOn: status === "READY" ? "" : `${open} open defect(s)`,
    history: d.last_hearing_summary ? [String(d.last_hearing_summary)] : [],
    reasons: defects
      .filter((x) => !["cleared", "waived"].includes(x.status))
      .map((x) => ({ code: x.code, detail: `${x.action_label}: ${x.code} (${x.status})` })),
    readiness_status: status,
    open_defect_count: open,
    defects,
    duration_mins_estimate: (d.duration_mins_estimate as number) ?? null,
    show_intent_window: (d.show_intent_window as string) ?? null,
    updated_at: d.updated_at as string | undefined,
    current_stage: d.current_stage as string | undefined,
    purpose_of_next_hearing: d.purpose_of_next_hearing as string | undefined,
  };
}

/* ---------- Live readiness ---------- */

export const getGetCasesQueryKey = () => ["readiness", "cases"] as const;
export const getGetCaseQueryKey = (id: string) => ["readiness", "case", id] as const;
export const getGetDashboardQueryKey = () => ["readiness", "dashboard"] as const;
export const getGetRosterSummaryQueryKey = () => ["readiness", "roster-summary"] as const;
export const getGetEligibilityQueryKey = (asOf?: string) =>
  ["readiness", "eligibility", asOf || "2026-09-22"] as const;
export const getGetRegistryQueueQueryKey = () => ["readiness", "registry-queue"] as const;
export const getGetStatsQueryKey = () => ["readiness", "stats"] as const;
export const getGetPolicyQueryKey = () => ["readiness", "policy"] as const;

export function useGetCases(options?: UseQueryOptions<Case[], Error>) {
  return useQuery({
    queryKey: getGetCasesQueryKey(),
    queryFn: async () => {
      const data = await api<{ count: number; cases: ApiCaseListItem[] }>("/cases");
      return data.cases.map(mapListItem);
    },
    ...options,
  });
}

export function useGetCase(id: string, options?: UseQueryOptions<CaseDetail, Error>) {
  return useQuery({
    queryKey: getGetCaseQueryKey(id),
    queryFn: async () => {
      const raw = await api<Record<string, unknown>>(`/cases/${encodeURIComponent(id)}`);
      return mapDetail(raw);
    },
    enabled: Boolean(id),
    ...options,
  });
}

export function useGetRosterSummary(options?: UseQueryOptions<RosterSummary, Error>) {
  return useQuery({
    queryKey: getGetRosterSummaryQueryKey(),
    queryFn: async () => {
      const stats = await api<{ total: number; READY: number; BLOCKED: number; HEALING: number }>("/stats");
      const cases = await api<{ cases: ApiCaseListItem[] }>("/cases");
      const stageMap = new Map<string, number>();
      for (const c of cases.cases) {
        const s = c.stage || "Unknown";
        stageMap.set(s, (stageMap.get(s) || 0) + 1);
      }
      return {
        total: stats.total,
        ready: stats.READY,
        waiting: stats.BLOCKED + stats.HEALING,
        stages: [...stageMap.entries()].map(([label, count]) => ({ label, count })),
        ages: [
          { label: "READY", count: stats.READY },
          { label: "BLOCKED", count: stats.BLOCKED },
          { label: "HEALING", count: stats.HEALING },
        ],
        errors: [],
      } satisfies RosterSummary;
    },
    ...options,
  });
}

export function useGetDashboard(options?: UseQueryOptions<Dashboard, Error>) {
  return useQuery({
    queryKey: getGetDashboardQueryKey(),
    queryFn: async () => {
      const stats = await api<{ total: number; READY: number; BLOCKED: number; HEALING: number }>("/stats");
      const blocked = await api<{ cases: ApiCaseListItem[] }>("/cases?status=BLOCKED");
      const attention = blocked.cases.slice(0, 8).map(mapListItem);
      const oldCases = blocked.cases.filter((c) => (c.age_days || 0) >= 1460).length;
      return {
        nextDate: "2026-09-22",
        recommendedCount: stats.READY,
        sittingHours: 5,
        movedForward: stats.HEALING,
        sentHome: stats.BLOCKED,
        oldCases,
        rosterDaysLeft: 0,
        attention,
      } satisfies Dashboard;
    },
    ...options,
  });
}

export function useGetStats() {
  return useQuery({
    queryKey: getGetStatsQueryKey(),
    queryFn: () => api<{ total: number; READY: number; BLOCKED: number; HEALING: number }>("/stats"),
  });
}

export function useGetEligibility(asOf = "2026-09-22") {
  return useQuery({
    queryKey: getGetEligibilityQueryKey(asOf),
    queryFn: () =>
      api<{ as_of: string; cases: ApiCaseListItem[] }>(`/eligibility?as_of=${encodeURIComponent(asOf)}`),
  });
}

export function useGetRegistryQueue() {
  return useQuery({
    queryKey: getGetRegistryQueueQueryKey(),
    queryFn: () =>
      api<{ count: number; defects: Defect[]; viewer_role: string }>("/registry/queue", {
        role: "registry",
      }),
  });
}

export function useGetPolicy(options?: UseQueryOptions<PolicyResponse, Error>) {
  return useQuery({
    queryKey: getGetPolicyQueryKey(),
    queryFn: () => api<PolicyResponse>("/policy"),
    ...options,
  });
}

export function usePatchPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { code: string; blocking: boolean }) =>
      api<PolicyItem & { stats?: { total: number; READY: number; BLOCKED: number; HEALING: number } }>(
        `/policy/${encodeURIComponent(vars.code)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ blocking: vars.blocking }),
          role: "registry",
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetPolicyQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCasesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEligibilityQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRosterSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRegistryQueueQueryKey() });
      qc.invalidateQueries({ queryKey: ["readiness"] });
    },
  });
}

export type DefectActionBody = {
  action:
    | "upload"
    | "confirm_evidence"
    | "confirm_counsel"
    | "process_ack"
    | "rsvp"
    | "undertake"
    | "flag_adjournment"
    | "withdraw_adjournment"
    | "eta_report";
  note?: string;
  evidence_uri?: string;
  window?: string;
};

export function useDefectAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      caseNumber: string;
      defectId: string;
      body: DefectActionBody;
      role?: ActorRole;
    }) =>
      api(`/cases/${encodeURIComponent(vars.caseNumber)}/defects/${encodeURIComponent(vars.defectId)}/actions`, {
        method: "POST",
        body: JSON.stringify(vars.body),
        role: vars.role ?? getActorRole(),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: getGetCaseQueryKey(vars.caseNumber) });
      qc.invalidateQueries({ queryKey: getGetCasesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRegistryQueueQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEligibilityQueryKey() });
    },
  });
}

export function useRegistryVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defectId: string) =>
      api(`/registry/defects/${encodeURIComponent(defectId)}/verify`, {
        method: "POST",
        role: "registry",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readiness"] });
    },
  });
}

export function useRegistryReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { defectId: string; reason: string }) =>
      api(`/registry/defects/${encodeURIComponent(vars.defectId)}/reject`, {
        method: "POST",
        role: "registry",
        body: JSON.stringify({ reason: vars.reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readiness"] });
    },
  });
}

export function useRegistryWaive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { defectId: string; note: string }) =>
      api(`/registry/defects/${encodeURIComponent(vars.defectId)}/waive`, {
        method: "POST",
        role: "registry",
        body: JSON.stringify({ note: vars.note }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readiness"] });
    },
  });
}

export function useUploadRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_vars: { data: { csv: string } }) => {
      // Re-seed from server roster (CSV upload to FastAPI not exposed); call /seed
      return api("/seed?reset=false", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readiness"] });
    },
  });
}


/* ---------- Demo onboarding: POST /seed/demo (wipe + roster_3000) ---------- */

export type SeedDemoResult = {
  ok?: boolean;
  seeded_cases: number;
  counts?: { READY?: number; BLOCKED?: number; HEALING?: number; [k: string]: number | undefined };
  total?: number;
  roster_path?: string;
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Prefer /seed/demo; retry while endpoint is still landing (404/502/503). */
async function postSeedDemoWithRetry(
  maxAttempts = 40,
  delayMs = 750,
): Promise<SeedDemoResult> {
  let lastErr: Error & { status?: number } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await api<SeedDemoResult>("/seed/demo", {
        method: "POST",
        role: "registry",
      });
    } catch (e) {
      lastErr = e as Error & { status?: number };
      const status = lastErr.status;
      const retryable =
        status === 404 ||
        status === 502 ||
        status === 503 ||
        status === 0 ||
        status == null;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(delayMs);
    }
  }
  throw lastErr || new Error("POST /seed/demo failed");
}

export function useSeedDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postSeedDemoWithRetry(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["readiness"] });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCasesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRosterSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEligibilityQueryKey() });
      qc.invalidateQueries({ queryKey: getGetRegistryQueueQueryKey() });
    },
  });
}

/* ---------- Planner: Cause List live POST /generate; Calendar from court_calendar; Impact/Finalise DEMO-STATIC ---------- */

const DEMO_RULES: Rules = {
  name: "Demo (readiness-only)",
  preset: RulesPreset.balanced,
  fullness: RulesFullness.balanced,
  oldCaseShare: 30,
  groupAdvocates: true,
  order: RulesOrder["complex-first"],
};

const DEMO_LEAVE: CalendarSettings = {
  leaveDays: [],
  morningStart: "10:30",
  morningEnd: "13:00",
  afternoonStart: "14:00",
  afternoonEnd: "16:30",
};

function yesNo(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}

function normalizeCalendarRow(row: Record<string, unknown>): CalendarDay {
  const date = String(row.date || "").slice(0, 10);
  // Prefer camel CaseDay shape from GET /calendar; else CSV / snake_case.
  if ("working" in row || "weeklyOff" in row) {
    const holiday = String(row.holiday ?? row.holiday_name ?? "").trim();
    const weeklyOff = Boolean(row.weeklyOff ?? yesNo(row.is_weekly_off));
    const working =
      typeof row.working === "boolean"
        ? row.working
        : yesNo(row.is_working_day) || (!weeklyOff && !holiday);
    return { date, working: Boolean(working) && !weeklyOff, holiday, weeklyOff };
  }
  const weeklyOff = yesNo(row.is_weekly_off);
  const holiday = String(row.holiday_name ?? row.holiday ?? "").trim();
  const working = yesNo(row.is_working_day);
  return {
    date,
    working: working && !weeklyOff,
    holiday,
    weeklyOff,
  };
}

function parseCalendarCsv(textCsv: string): CalendarDay[] {
  const lines = textCsv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iDate = idx("date");
  const iWeekly = idx("is_weekly_off");
  const iHolidayName = idx("holiday_name");
  const iWorking = idx("is_working_day");
  const days: CalendarDay[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // holiday_name may contain commas — split carefully: first 4 fields fixed, last is working
    // date,day_of_week,is_weekly_off,is_holiday,holiday_name,is_working_day
    const parts = line.split(",");
    if (parts.length < 6) continue;
    const date = parts[0].trim();
    const is_weekly_off = parts[2].trim();
    const is_working_day = parts[parts.length - 1].trim();
    const holiday_name = parts.slice(4, parts.length - 1).join(",").trim();
    days.push(
      normalizeCalendarRow({
        date,
        is_weekly_off,
        holiday_name,
        is_working_day,
      }),
    );
  }
  // silence unused if header-driven path preferred later
  void iDate;
  void iWeekly;
  void iHolidayName;
  void iWorking;
  return days;
}

async function loadCalendarFromPublicCsv(): Promise<CalendarDay[]> {
  const base =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: Record<string, string> }).env?.BASE_URL) ||
    "/";
  const url = `${base.replace(/\/?$/, "/")}/court_calendar.csv`.replace(
    /([^:]\/)\/+/g,
    "$1",
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load court_calendar.csv (${res.status})`);
  }
  return parseCalendarCsv(await res.text());
}

/** Prefer GET /calendar (loops); fall back to Vite public court_calendar.csv. */
async function loadCalendarDays(): Promise<CalendarDay[]> {
  try {
    const data = await api<
      | CalendarDay[]
      | {
          days?: Record<string, unknown>[];
          calendar?: Record<string, unknown>[];
          count?: number;
        }
    >("/calendar");
    const rows = Array.isArray(data)
      ? data
      : data.days || data.calendar || [];
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((r) =>
        normalizeCalendarRow(r as unknown as Record<string, unknown>),
      );
    }
  } catch {
    /* /calendar not live yet — use public CSV */
  }
  return loadCalendarFromPublicCsv();
}

const DEMO_PREVIEW: SchedulePreview = {
  days: [],
  recommendedCount: 0,
  explanation:
    "DEMO-STATIC: day packer not wired. Use Eligibility for READY cases from sama-panda readiness.",
  generatedAt: new Date().toISOString(),
};

const DEMO_IMPACT: Impact = {
  recommended: { heard: 0, forward: 0, unheard: 0, oldTouched: 0, hours: 0 },
  choice: { heard: 0, forward: 0, unheard: 0, oldTouched: 0, hours: 0 },
  outlook: [],
  affected: [],
  extraTrips: 0,
};

let localRules = DEMO_RULES;
let localLeave = DEMO_LEAVE;
let localPublications: Publication[] = [];

export const getGetRulesQueryKey = () => ["demo", "rules"] as const;
export const getGetLeaveQueryKey = () => ["demo", "leave"] as const;
export const getGetCalendarQueryKey = () => ["calendar", "court"] as const;
export const getGetPublicationsQueryKey = () => ["demo", "publications"] as const;

export function useGetRules() {
  return useQuery({
    queryKey: getGetRulesQueryKey(),
    queryFn: async () => localRules,
    staleTime: Infinity,
  });
}

export function useSaveRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { data: Rules }) => {
      localRules = vars.data;
      return localRules;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getGetRulesQueryKey() }),
  });
}

export function useGetLeave() {
  return useQuery({
    queryKey: getGetLeaveQueryKey(),
    queryFn: async () => localLeave,
    staleTime: Infinity,
  });
}

export function useSaveLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { data: CalendarSettings }) => {
      localLeave = vars.data;
      return localLeave;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: getGetLeaveQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
    },
  });
}

export function useGetCalendar() {
  return useQuery({
    queryKey: getGetCalendarQueryKey(),
    queryFn: () => loadCalendarDays(),
    staleTime: 60_000,
  });
}

/* ---------- Live POST /generate cause-list packer ---------- */

type GenerateEntry = {
  serial?: number;
  case_number: string;
  filing_number?: string;
  purpose?: string;
  current_stage?: string;
  score?: number;
  duration_mins?: number;
  expected_load_mins?: number;
  advocate_id?: string;
  badges?: string[];
};

type GenerateBlock = {
  block_id: string;
  label?: string;
  list_section?: number | string;
  sequence?: number;
  minute_budget?: number;
  used_expected_mins?: number;
  entries?: GenerateEntry[];
};

type GenerateWaitItem = {
  case_number: string;
  filing_number?: string;
  purpose?: string;
  reason?: string;
  suggested_next_date?: string;
  score?: number;
};

type GenerateDraft = {
  judge_id: string;
  date: string;
  capacity_mins?: number;
  overbook_buffer_pct?: number;
  totals?: {
    cases_listed?: number;
    expected_load_mins?: number;
    nominal_duration_sum_mins?: number;
    waitlisted?: number;
    ready_pool?: number;
  };
  blocks?: GenerateBlock[];
  waitlist?: GenerateWaitItem[];
};

const MORNING_START = "10:30";
const MORNING_END = "13:00";
const AFTERNOON_START = "14:00";
const AFTERNOON_END = "16:30";

function parseHm(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function formatHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function workingDatesInRange(
  startDate: string,
  period: string,
  cal: CalendarDay[],
): string[] {
  const byDate = new Map(cal.map((d) => [d.date, d]));
  const isWorking = (iso: string): boolean => {
    const row = byDate.get(iso);
    if (row) return Boolean(row.working) && !row.weeklyOff;
    // fallback: weekdays only
    const wd = new Date(`${iso}T12:00:00`).getDay();
    return wd !== 0 && wd !== 6;
  };

  if (period === "day") {
    return isWorking(startDate) ? [startDate] : [];
  }

  const span = period === "month" ? 31 : 7; // week ≈ 5–7 calendar days
  const maxWorking = period === "month" ? 20 : 7;
  const out: string[] = [];
  for (let i = 0; i < span && out.length < maxWorking; i++) {
    const iso = addDaysIso(startDate, i);
    if (isWorking(iso)) out.push(iso);
  }
  return out;
}

function mapDraftToScheduleDay(draft: GenerateDraft): ScheduleDay {
  const date = draft.date;
  const capacity = draft.capacity_mins || 420;
  const blocks = [...(draft.blocks || [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );

  const morningCap = parseHm(MORNING_END) - parseHm(MORNING_START);
  const afternoonCap = parseHm(AFTERNOON_END) - parseHm(AFTERNOON_START);
  let morningUsed = 0;
  let afternoonUsed = 0;
  const scheduled: ScheduledCase[] = [];
  const overflow: string[] = [];

  for (const block of blocks) {
    const entries = block.entries || [];
    for (const e of entries) {
      const dur = Math.max(1, e.duration_mins ?? 15);
      // Prefer morning, then afternoon; allow afternoon overrun (API overbook buffer).
      let window: "morning" | "afternoon";
      let startMins: number;
      if (morningUsed + dur <= morningCap) {
        window = "morning";
        startMins = parseHm(MORNING_START) + morningUsed;
        morningUsed += dur;
      } else {
        window = "afternoon";
        startMins = parseHm(AFTERNOON_START) + afternoonUsed;
        afternoonUsed += dur;
      }

      const section =
        block.label ||
        (block.list_section != null ? `List ${block.list_section}` : block.block_id);
      const scoreBit =
        e.score != null ? `score ${e.score}` : "scored by packer";

      scheduled.push({
        caseId: e.case_number, // ST/… never filing
        date,
        start: formatHm(startMins),
        end: formatHm(startMins + dur),
        window,
        block: block.block_id || section,
        likelihood: ScheduledCaseLikelihood.High,
        duration: dur,
        reasons: [
          {
            code: "READY",
            detail: `${section} · ${scoreBit}`,
          },
        ],
        advocateId: e.advocate_id || "",
        purpose: e.purpose || "",
      });
    }
  }

  const held: HeldCase[] = (draft.waitlist || []).map((w) => ({
    caseId: w.case_number,
    reason: {
      code: (w.reason || "WAITLIST").toUpperCase().replace(/\s+/g, "_"),
      detail: w.reason
        ? `Waitlist: ${w.reason}${w.purpose ? ` · ${w.purpose}` : ""}`
        : "Not immediately listed — waitlisted by minute packer.",
    },
    readyDate: w.suggested_next_date || addDaysIso(date, 7),
  }));

  const used =
    draft.totals?.expected_load_mins ??
    blocks.reduce((n, b) => n + (b.used_expected_mins || 0), 0);

  return {
    date,
    cases: scheduled,
    held,
    fullness: Math.round((used / capacity) * 100),
    overflow,
  };
}

async function fetchGenerate(
  date: string,
  excludeCaseNumbers: string[] = [],
): Promise<GenerateDraft | { error: string; status: number }> {
  try {
    return await api<GenerateDraft>("/generate", {
      method: "POST",
      body: JSON.stringify({
        judge_id: "J-DEMO",
        date,
        force_holiday: false,
        exclude_case_numbers: excludeCaseNumbers,
      }),
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return {
      error: err.message || "generate failed",
      status: err.status || 500,
    };
  }
}

async function buildGeneratePreview(req: ScheduleRequest): Promise<SchedulePreview> {
  const startDate = req.start_date || "2026-09-22";
  const period = String(req.period || "day");
  const cal = await loadCalendarDays();
  const dates = workingDatesInRange(startDate, period, cal);

  const days: ScheduleDay[] = [];
  const notes: string[] = [];
  let overbookPct: number | undefined;
  let capacityMins: number | undefined;
  let listed = 0;
  const excludedCaseNumbers = new Set<string>();
  const totals = { cases_listed: 0, ready_pool: 0, waitlisted: 0 };

  if (period === "day" && dates.length === 0) {
    // Holiday / non-working start — empty day with explanation
    const row = cal.find((d) => d.date === startDate);
    const why = row?.holiday
      ? row.holiday
      : row?.weeklyOff
        ? "weekly off"
        : "non-working day";
    days.push({
      date: startDate,
      cases: [],
      held: [],
      fullness: 0,
      overflow: [],
    });
    notes.push(`Skipped packing for ${startDate} (${why}).`);
  }

  for (const date of dates) {
    const result = await fetchGenerate(
      date,
      period === "day" ? [] : Array.from(excludedCaseNumbers),
    );
    if ("error" in result) {
      if (result.status === 400) {
        days.push({
          date,
          cases: [],
          held: [],
          fullness: 0,
          overflow: [],
        });
        notes.push(`${date}: holiday/non-working (API 400) — left empty.`);
        continue;
      }
      throw new Error(result.error);
    }
    if (overbookPct == null && result.overbook_buffer_pct != null) {
      overbookPct = result.overbook_buffer_pct;
    }
    if (capacityMins == null && result.capacity_mins != null) {
      capacityMins = result.capacity_mins;
    }
    const day = mapDraftToScheduleDay(result);
    listed += day.cases.length;
    totals.cases_listed += result.totals?.cases_listed ?? day.cases.length;
    totals.ready_pool +=
      result.totals?.ready_pool ?? day.cases.length + day.held.length;
    totals.waitlisted += result.totals?.waitlisted ?? day.held.length;
    if (period !== "day") {
      day.cases.forEach((scheduledCase) =>
        excludedCaseNumbers.add(scheduledCase.caseId),
      );
    }
    days.push(day);
  }

  if (period !== "day") {
    notes.push(
      "Multi-day live pack depletes the READY pool across working days (exclude_case_numbers).",
    );
  }

  const bufferLabel =
    overbookPct != null
      ? `${Math.round(overbookPct * 100)}% overbook buffer`
      : "overbook buffer";
  const capLabel = capacityMins != null ? `${capacityMins} min capacity` : "day capacity";

  return {
    days,
    recommendedCount: listed,
    totals,
    explanation:
      `Live POST /generate (J-DEMO) · minute packer · ${capLabel} · ${bufferLabel}` +
      (notes.length ? ` · ${notes.join(" ")}` : ""),
    generatedAt: new Date().toISOString(),
  };
}

export function usePreviewSchedule() {
  return useMutation({
    mutationFn: async (vars: { data: ScheduleRequest }) =>
      buildGeneratePreview(vars.data),
  });
}

export function useGetScheduleImpact() {
  return useMutation({
    mutationFn: async (_vars: { data: unknown }) => DEMO_IMPACT,
  });
}

export function usePublishSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_vars: { data: unknown }) => {
      const result: PublishResult = {
        id: `demo-${Date.now()}`,
        publishedAt: new Date().toISOString(),
        days: [],
      };
      localPublications = [
        {
          id: result.id,
          publishedAt: result.publishedAt,
          days: [],
          moves: [],
          recommended: [],
        },
        ...localPublications,
      ];
      return result;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: getGetPublicationsQueryKey() }),
  });
}

export function useGetPublications() {
  return useQuery({
    queryKey: getGetPublicationsQueryKey(),
    queryFn: async () => localPublications,
  });
}
