/**
 * Plain-English defect labels for judges.
 * Prefer API `description` from GET /policy when present; this map is the fallback.
 */
export const DEFECT_PLAIN: Record<string, string> = {
  PROCESS_RETURN_PENDING: "Process / summons return not yet on file",
  FILING_NOT_READY: "Required filing or papers not ready",
  EVIDENCE_NOT_READY: "Evidence not ready for this hearing",
  COUNSEL_NOT_READY: "Counsel not ready to proceed",
  PARTY_ABSENCE_RISK: "Risk the party will not appear (undertaking)",
  RSVP_SHOW_INTENT: "Party has not RSVP’d / shown intent for a window",
  OBJECTION_PENDING: "Objection still pending",
  ADJOURNMENT_PREDECLARED: "Adjournment already declared before the day",
  EXTERNAL_REPORT_PENDING: "External agency report still pending",
  COURT_ADMIN_BLOCK: "Court admin hold (registry only)",
};

/** Resolve what a defect code means — API description wins, else DEFECT_PLAIN. */
export function defectWhatItMeans(
  code: string,
  apiDescription?: string | null,
): string {
  const fromApi = (apiDescription || "").trim();
  if (fromApi) return fromApi;
  return DEFECT_PLAIN[code] || "Defect code pending plain-language copy";
}
