import type { HearingDefect } from "@workspace/api-client-react";
import { Building2, FileWarning, Mail, Repeat2, Timer, UserX } from "lucide-react";

const definitions = {
  PROCESS_PENDING: { label: "Summons / warrant not returned", icon: Mail },
  EXTERNAL_WAIT: { label: "Waiting on outside report", icon: Building2 },
  PARTY_ABSENT: { label: "Party likely absent", icon: UserX },
  NOT_READY: { label: "Evidence / filing not ready", icon: FileWarning },
  TIME_SOUGHT: { label: "Likely to seek adjournment", icon: Timer },
  REPEAT_ADJOURNED: { label: "Adjourned repeatedly", icon: Repeat2 },
} as const;

const confidenceLabels: Record<string, string> = {
  record: "From record",
  likely: "Likely",
  stage_risk: "Stage risk",
};
const ownerLabels: Record<string, string> = {
  court_staff: "Court staff / police",
  agency: "Mediation centre / other agency",
  advocate: "Advocate",
  judge: "Judge / court master",
};

export function defectLabel(defect: HearingDefect) {
  if (defect.stuck && defect.code === "REPEAT_ADJOURNED") return "Stuck at this stage";
  return definitions[defect.code]?.label ?? String(defect.code);
}

export function DefectChip({ defect }: { defect: HearingDefect }) {
  const Icon = definitions[defect.code]?.icon ?? FileWarning;
  const style = defect.confidence === "record"
    ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    : defect.confidence === "likely"
      ? "border-amber-300 bg-background text-foreground dark:border-amber-700"
      : "border-dashed border-border bg-muted/30 text-muted-foreground";
  return (
    <span title={`${defectLabel(defect)} · ${confidenceLabels[defect.confidence] ?? defect.confidence}${defect.limitedData ? " · Based on limited data" : ""}: ${defect.evidence}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-tight ${style}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{defectLabel(defect)}</span>
      <span className="shrink-0 border-l border-current/20 pl-1.5 font-medium">{confidenceLabels[defect.confidence] ?? defect.confidence}</span>
    </span>
  );
}

export function DefectDetails({ defect }: { defect: HearingDefect }) {
  const Icon = definitions[defect.code]?.icon ?? FileWarning;
  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-amber-700" aria-hidden="true" /> {defectLabel(defect)} <span className="ml-auto text-xs font-normal text-muted-foreground">{confidenceLabels[defect.confidence] ?? defect.confidence}</span></div>
      <p className="mt-2 text-muted-foreground">{defect.confidence === "record" ? `“${defect.evidence}”` : defect.evidence}</p>
      {defect.limitedData && <p className="mt-1 text-xs text-muted-foreground">Based on limited data</p>}
      <p className="mt-2 text-xs"><span className="font-semibold">Who must act:</span> {ownerLabels[defect.owner] ?? defect.owner}</p>
      <p className="mt-1 text-xs"><span className="font-semibold">Clears when:</span> {defect.clears_when}</p>
    </div>
  );
}
