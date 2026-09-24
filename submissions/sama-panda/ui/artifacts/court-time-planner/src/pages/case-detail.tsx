import { useEffect, useState } from "react";
import {
  useGetCase,
  useGetRules,
  usePreviewSchedule,
  useDefectAction,
  useRegistryVerify,
  useRegistryReject,
  useRegistryWaive,
  type Defect,
} from "@workspace/api-client-react";
import { useActorRole, setActorRole, type ActorRole } from "@/hooks/use-actor-role";
import { useScheduleContext } from "@/store/schedule-context";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Clock, FileText, AlertTriangle, User, Calendar, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";

const displayDate = (date: string) =>
  date ? format(new Date(`${date}T12:00:00`), "d MMM yyyy") : "—";

const statusBadgeClass = (rs: string) =>
  rs === "READY"
    ? "bg-emerald-100 text-emerald-900 border-emerald-200"
    : rs === "HEALING"
      ? "bg-amber-100 text-amber-900 border-amber-200"
      : "bg-rose-100 text-rose-900 border-rose-200";

const actionLabelClass = (label: string) => {
  if (label === "Your action") return "border-blue-200 bg-blue-50 text-blue-800";
  if (label === "Agency action") return "border-violet-200 bg-violet-50 text-violet-800";
  return "border-slate-200 bg-slate-50 text-slate-800";
};

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const caseId = id ? decodeURIComponent(id) : "";
  const role = useActorRole();
  const { data: caseInfo, isLoading, isError, refetch } = useGetCase(caseId);
  const { startDate, period, moves } = useScheduleContext();
  const { data: rules } = useGetRules();
  const preview = usePreviewSchedule();
  const defectAction = useDefectAction();
  const registryVerify = useRegistryVerify();
  const registryReject = useRegistryReject();
  const registryWaive = useRegistryWaive();
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // DEMO-STATIC preview — does not call day-packer engine
  useEffect(() => {
    if (rules) preview.mutate({ data: { period, start_date: startDate, rules, moves } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, period, startDate, moves]);

  const runPartyAction = async (defect: Defect) => {
    if (!caseInfo || !defect.primary_action) return;
    setBusyId(defect.id);
    setActionError("");
    try {
      await defectAction.mutateAsync({
        caseNumber: caseInfo.case_number || caseInfo.id,
        defectId: defect.id,
        body: {
          action: defect.primary_action as never,
          note: note || undefined,
          evidence_uri: defect.primary_action === "upload" ? note || "file://proof.pdf" : undefined,
          window: defect.primary_action === "rsvp" ? "AM" : undefined,
        },
      });
      setNote("");
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const runRegistry = async (kind: "verify" | "reject" | "waive", defect: Defect) => {
    setBusyId(defect.id);
    setActionError("");
    try {
      if (kind === "verify") await registryVerify.mutateAsync(defect.id);
      else if (kind === "reject")
        await registryReject.mutateAsync({ defectId: defect.id, reason: note || "Incomplete evidence" });
      else await registryWaive.mutateAsync({ defectId: defect.id, note: note || "Waived for listing" });
      setNote("");
      await refetch();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="workspace-page space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (isError || !caseInfo) {
    return (
      <div className="workspace-page p-8 text-center text-destructive">
        Failed to load case {caseId}. Is the readiness API on :8000 running?
      </div>
    );
  }

  const rs = caseInfo.readiness_status || (caseInfo.waitingOn ? "BLOCKED" : "READY");
  const defects = caseInfo.defects || [];

  return (
    <div className="workspace-page space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="workspace-header flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/roster">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="workspace-breadcrumb">Roster / Case detail</div>
          <h1 className="workspace-title text-3xl font-bold flex flex-wrap items-center gap-3">
            {caseInfo.filingNumber}
            <Badge className={`border ${statusBadgeClass(rs)}`}>{rs}</Badge>
            {caseInfo.flags
              .filter((f) => f !== rs)
              .map((f) => (
                <Badge key={f} variant="secondary">
                  {f === "OLD_CASE" ? "4+ years old" : f === "HAS_DEFECTS" ? `${caseInfo.open_defect_count} defects` : f.replaceAll("_", " ").toLowerCase()}
                </Badge>
              ))}
          </h1>
          <p className="workspace-subtitle text-muted-foreground mt-1">
            Filed on {displayDate(caseInfo.filingDate)} · acting as{" "}
            <select
              className="ml-1 rounded border bg-background px-1.5 py-0.5 text-sm"
              value={role}
              onChange={(e) => setActorRole(e.target.value as ActorRole)}
              aria-label="Actor role"
            >
              <option value="counsel">counsel</option>
              <option value="party">party</option>
              <option value="registry">registry</option>
            </select>
          </p>
        </div>
      </div>

      {actionError && (
        <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {actionError}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Defect checklist</CardTitle>
              <p className="text-xs text-muted-foreground">
                Labels follow owner: Your action / Court action / Agency action. Mutations use X-Actor-Role.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {defects.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> No open defects — case is listing-eligible when READY.
                </div>
              ) : (
                defects.map((d) => (
                  <div
                    key={d.id}
                    className={`rounded-lg border p-3 space-y-2 ${
                      d.blocking === false && ["open", "submitted", "rejected"].includes(d.status)
                        ? "border-border/60 bg-muted/20"
                        : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{d.code}</span>
                      <Badge variant="outline" className="text-[10px]">{d.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">{d.severity}</Badge>
                      {d.blocking ? (
                        <Badge className="border text-[10px] border-rose-200 bg-rose-50 text-rose-900">Blocking</Badge>
                      ) : (
                        <Badge className="border text-[10px] border-slate-200 bg-slate-50 text-slate-600">Soft</Badge>
                      )}
                      {d.locked_by_law && (
                        <Badge className="border text-[10px] border-amber-200 bg-amber-50 text-amber-900">By law</Badge>
                      )}
                      <Badge className={`border text-[10px] ${actionLabelClass(d.action_label)}`}>{d.action_label}</Badge>
                      <span className="text-[11px] text-muted-foreground">owner {d.owner}</span>
                    </div>
                    {d.note && <p className="text-xs text-muted-foreground">Note: {d.note}</p>}
                    {d.reject_reason && <p className="text-xs text-rose-700">Reject: {d.reject_reason}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {d.can_act && role !== "registry" && d.primary_action && ["open", "rejected"].includes(d.status) && (
                        <Button size="sm" disabled={busyId === d.id} onClick={() => void runPartyAction(d)}>
                          {busyId === d.id ? "Working…" : d.primary_action}
                        </Button>
                      )}
                      {role === "registry" && d.status === "submitted" && (
                        <>
                          <Button size="sm" disabled={busyId === d.id} onClick={() => void runRegistry("verify", d)}>
                            Verify
                          </Button>
                          <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => void runRegistry("reject", d)}>
                            Reject
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busyId === d.id} onClick={() => void runRegistry("waive", d)}>
                            Waive
                          </Button>
                        </>
                      )}
                      {!d.can_act && (
                        <span className="text-xs text-muted-foreground">No action for role “{role}” on this defect.</span>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground">Note / evidence URI (optional)</label>
                <Input
                  className="mt-1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="proof.pdf or short note"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Case timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Hearing note from roster. Schedule preview is DEMO-STATIC (day packer not wired).
              </p>
            </CardHeader>
            <CardContent>
              <ol className="text-sm">
                <li className="flex gap-4">
                  <div className="flex flex-col items-center" aria-hidden="true">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-primary" />
                    <span className="my-1 w-px flex-1 bg-border" />
                  </div>
                  <div className="pb-6">
                    <time dateTime={caseInfo.filingDate} className="text-xs font-medium text-primary">
                      {displayDate(caseInfo.filingDate)}
                    </time>
                    <p className="font-semibold">Case filed</p>
                  </div>
                </li>
                {caseInfo.history.map((event, index) => (
                  <li key={index} className="flex gap-4">
                    <div className="flex flex-col items-center" aria-hidden="true">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-primary bg-card" />
                      <span className="my-1 w-px flex-1 bg-border" />
                    </div>
                    <div className="min-w-0 pb-6">
                      <p className="text-xs font-medium text-muted-foreground">Latest hearing note</p>
                      <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{event}</p>
                    </div>
                  </li>
                ))}
                <li className="flex gap-4">
                  <div aria-hidden="true">
                    <span className={`mt-1 block h-3 w-3 shrink-0 rounded-full ${rs === "READY" ? "bg-emerald-500" : "bg-amber-500"}`} />
                  </div>
                  <div className="min-w-0">
                    {rs === "READY" ? (
                      <>
                        <p className="text-xs font-medium text-emerald-700">Listing-eligible</p>
                        <p className="font-semibold">READY for day packer (out of scope here)</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-amber-700">Not listing-eligible</p>
                        <p className="font-semibold">{rs} · {caseInfo.waitingOn || "defects open"}</p>
                      </>
                    )}
                  </div>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Case Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                    <User className="w-4 h-4" /> Party ID
                  </div>
                  <div>{caseInfo.partyId}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                    <User className="w-4 h-4" /> Advocate ID
                  </div>
                  <div>{caseInfo.advocateId}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4" /> Stage
                  </div>
                  <div className="font-semibold">{caseInfo.stage}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4" /> Purpose
                  </div>
                  <div>{caseInfo.purpose}</div>
                </div>
              </div>
              {caseInfo.waitingOn && (
                <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-medium mb-1">
                    <AlertTriangle className="w-4 h-4" /> Readiness
                  </div>
                  <div className="text-sm">{caseInfo.waitingOn}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4" /> Age
                </div>
                <div className="text-2xl font-bold">{caseInfo.ageYears} Years</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4" /> Total Hearings
                </div>
                <div className="text-2xl font-bold">{caseInfo.totalHearings}</div>
              </div>
              <Separator />
              <div>
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-1">
                  <Calendar className="w-4 h-4" /> Est. duration
                </div>
                <div className="font-medium">{caseInfo.duration_mins_estimate ?? "—"} mins</div>
              </div>
            </CardContent>
          </Card>

          {caseInfo.reasons && caseInfo.reasons.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Open defect codes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {caseInfo.reasons.map((r, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-semibold">{r.code}:</span> {r.detail}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
