import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCasesQueryKey,
  getGetDashboardQueryKey,
  getGetRosterSummaryQueryKey,
  useGetCases,
  useGetRosterSummary,
  useUploadRoster,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Home,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type SortKey = "filing" | "age" | "hearings";
type Readiness = "" | "ready" | "waiting";
type CaseScope = "all" | "no-warning" | "confirm" | "older";

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const narrativeExcerpt = (value: string) =>
  value.trim().length > 86 ? `${value.trim().slice(0, 83)}…` : value.trim();

export default function RosterPage() {
  const { isLoading: sumLoading, isError: summaryError } = useGetRosterSummary();
  const { data: cases, isLoading: casesLoading, isError: casesError } = useGetCases();
  const [searchTerm, setSearchTerm] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [advocateFilter, setAdvocateFilter] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<Readiness>("");
  const [flagFilter, setFlagFilter] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("filing");
  const [descending, setDescending] = useState(true);
  const [scope, setScope] = useState<CaseScope>("all");
  const [closedStages, setClosedStages] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const uploadRoster = useUploadRoster();

  const stages = useMemo(() => [...new Set((cases ?? []).map((item) => item.stage))].sort(), [cases]);
  const activeFilterCount = [stageFilter, ageFilter, advocateFilter, readinessFilter, flagFilter ? "flagged" : ""].filter(Boolean).length;
  const hasActiveCriteria = Boolean(searchTerm.trim() || activeFilterCount || scope !== "all");
  const stats = useMemo(() => {
    const all = cases ?? [];
    return [
      { key: "all", label: "Total cases", count: all.length },
      { key: "no-warning", label: "READY", count: all.filter(c => (c as { readiness_status?: string }).readiness_status === "READY" || !c.waitingOn).length },
      { key: "confirm", label: "BLOCKED / HEALING", count: all.filter(c => Boolean(c.waitingOn)).length },
      { key: "older", label: "Older cases · 4+ years", count: all.filter(c => c.ageYears >= 4).length },
    ] as const;
  }, [cases]);

  const filteredCases = useMemo(() => {
    const lower = searchTerm.trim().toLowerCase();
    return [...(cases ?? [])]
      .filter((c) => {
        const searchable = [c.filingNumber, c.id, c.advocateId, c.stage, c.partyId, c.purpose].join(" ").toLowerCase();
        return (!lower || searchable.includes(lower))
          && (scope === "all" || (scope === "no-warning" ? !c.waitingOn : scope === "confirm" ? Boolean(c.waitingOn) : c.ageYears >= 4))
          && (!stageFilter || c.stage === stageFilter)
          && (!advocateFilter || c.advocateId.toLowerCase().includes(advocateFilter.toLowerCase()))
          && (!ageFilter || (ageFilter === "old" ? c.ageYears >= 4 : ageFilter === "new" ? c.ageYears < 1 : c.ageYears >= 1 && c.ageYears < 4))
          && (!readinessFilter || (readinessFilter === "ready" ? !c.waitingOn : Boolean(c.waitingOn)))
          && (!flagFilter || c.flags.length > 0);
      })
      .sort((a, b) => {
        const compare = sortKey === "age" ? a.ageYears - b.ageYears : sortKey === "hearings" ? a.totalHearings - b.totalHearings : a.filingNumber.localeCompare(b.filingNumber, undefined, { numeric: true });
        return descending ? -compare : compare;
      });
  }, [cases, scope, searchTerm, stageFilter, ageFilter, advocateFilter, readinessFilter, flagFilter, sortKey, descending]);

  const groupedCases = useMemo(() => {
    const groups = new Map<string, typeof filteredCases>();
    filteredCases.forEach((item) => groups.set(item.stage, [...(groups.get(item.stage) ?? []), item]));
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredCases]);

  const toggleStage = (stage: string) => {
    setClosedStages((current) => {
      const next = new Set(current);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const clearFilters = () => {
    setScope("all");
    setSearchTerm("");
    setStageFilter("");
    setAgeFilter("");
    setAdvocateFilter("");
    setReadinessFilter("");
    setFlagFilter(false);
  };

  const openStat = (next: CaseScope) => {
    clearFilters();
    setScope(next);
    setClosedStages(new Set());
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    setUploadError("");
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 4_000_000) {
      setUploadError("Choose a CSV file smaller than 4 MB.");
      return;
    }
    uploadRoster.mutate({ data: { csv: await file.text() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRosterSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
      onError: (error) => setUploadError((error as { data?: { error?: string } }).data?.error || "This roster could not be read. Check the column names and values."),
    });
  };

  if (sumLoading || casesLoading) {
    return <div className="space-y-5" data-testid="roster-loading"><Skeleton className="h-8 w-56" /><Skeleton className="h-12 w-full" /><Skeleton className="h-[420px] w-full" /></div>;
  }

  if (summaryError || casesError) {
    return <div className="border border-destructive/30 bg-destructive/5 p-5 text-sm" role="alert" data-testid="roster-error"><p className="font-semibold text-destructive">The roster could not be loaded.</p><p className="mt-1 text-muted-foreground">Refresh the page and try again.</p></div>;
  }

  return (
    <div className="workspace-page space-y-6 pb-8" data-testid="roster-page">
      <header className="workspace-header">
        <div className="workspace-breadcrumb flex items-center gap-2">
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          <ChevronRight className="h-3 w-3 text-border" aria-hidden="true" />
          <span>All cases</span>
        </div>
        <div>
          <h1 className="workspace-title">Case roster</h1>
          <p className="workspace-subtitle">Master causelist from sama-panda readiness (READY · BLOCKED · HEALING). Open a case to clear defects.</p>
        </div>
      </header>
      <input className="sr-only" ref={picker} type="file" accept=".csv,text/csv" aria-label="Select roster CSV" onChange={(e) => { void handleUpload(e.target.files?.[0]); e.target.value = ""; }} />

      {uploadError && <div className="flex items-start justify-between gap-3 border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert" data-testid="status-upload-error"><span>{uploadError}</span><button type="button" aria-label="Dismiss upload error" onClick={() => setUploadError("")}><X className="h-4 w-4" /></button></div>}

      <section className="grid grid-cols-2 gap-x-3 border-b border-border md:grid-cols-4 md:gap-x-4" aria-label="Case categories">
        {stats.map((stat) => (
          <button
            key={stat.key}
            type="button"
            aria-pressed={scope === stat.key}
            aria-controls="roster-results"
            data-testid={`stat-${stat.key}`}
            onClick={() => openStat(stat.key)}
            className={`relative min-w-0 border-b-[3px] px-1 pb-5 pt-1 text-left transition-colors hover:text-primary ${scope === stat.key ? "border-primary" : "border-transparent"}`}
          >
            <span className="block text-[13px] font-medium text-muted-foreground">{stat.label}</span>
            <span className="mt-2 block text-[25px] font-semibold leading-none tracking-tight tabular-nums" data-testid={stat.key === "all" ? "text-total-cases" : stat.key === "no-warning" ? "text-ready-cases" : stat.key === "confirm" ? "text-waiting-cases" : undefined}>{stat.count.toLocaleString("en-IN")}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-3" aria-label="Roster controls">
            <Popover>
              <PopoverTrigger asChild><Button data-testid="button-filter-roster" variant="outline" size="sm" className="gap-2"><Filter className="h-3.5 w-3.5" />Filters{activeFilterCount > 0 && <Badge className="h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">{activeFilterCount}</Badge>}</Button></PopoverTrigger>
              <PopoverContent align="start" className="w-80 space-y-4">
                <div className="flex items-center justify-between"><p className="font-semibold">Filter cases</p>{hasActiveCriteria && <button type="button" className="text-xs text-primary hover:underline" onClick={clearFilters}>Clear all</button>}</div>
                <label className="block text-xs font-medium text-muted-foreground">Stage<select data-testid="select-stage-filter" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-sm"><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
                <label className="block text-xs font-medium text-muted-foreground">Case age<select data-testid="select-age-filter" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-sm"><option value="">Any age</option><option value="new">Under 1 year</option><option value="mid">1–4 years</option><option value="old">4+ years</option></select></label>
                <label className="block text-xs font-medium text-muted-foreground">Advocate<input data-testid="input-advocate-filter" value={advocateFilter} onChange={(e) => setAdvocateFilter(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2 text-sm" placeholder="Search advocate ID" /></label>
                <fieldset><legend className="text-xs font-medium text-muted-foreground">Process warning (inferred)</legend><div className="mt-1 grid grid-cols-3 gap-1">{[["", "Any"], ["ready", "READY"], ["waiting", "Not ready"]].map(([value, label]) => <button type="button" key={value} data-testid={`button-readiness-${value || "any"}`} onClick={() => setReadinessFilter(value as Readiness)} className={`rounded-md border px-2 py-1.5 text-xs ${readinessFilter === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{label}</button>)}</div></fieldset>
                <label className="flex items-center gap-2 border-t pt-3 text-sm"><input data-testid="checkbox-flagged-filter" type="checkbox" checked={flagFilter} onChange={(e) => setFlagFilter(e.target.checked)} />Flagged cases only</label>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild><Button size="sm" className="gap-2">Actions <ChevronDown className="h-3.5 w-3.5" /></Button></PopoverTrigger>
              <PopoverContent align="start" className="w-48 p-1">
                <button type="button" data-testid="button-upload-roster" onClick={() => picker.current?.click()} disabled={uploadRoster.isPending} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"><Upload className="h-4 w-4" />{uploadRoster.isPending ? "Uploading…" : "Upload roster"}</button>
                <button type="button" onClick={() => setClosedStages(new Set())} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted">Expand all stages</button>
                <button type="button" onClick={() => setClosedStages(new Set(stages))} className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted">Collapse all stages</button>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild><Button data-testid="button-sort-roster" variant="outline" size="sm" className="gap-2"><SlidersHorizontal className="h-3.5 w-3.5" />Sort</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order by</p>
                {[["filing", "Filing number"], ["age", "Case age"], ["hearings", "Total hearings"]].map(([value, label]) => <button type="button" key={value} onClick={() => setSortKey(value as SortKey)} className="flex w-full items-center justify-between rounded px-2 py-2 text-sm hover:bg-muted"><span>{label}</span>{sortKey === value && <Check className="h-4 w-4 text-primary" />}</button>)}
                <button type="button" onClick={() => setDescending(!descending)} aria-label={`Switch to ${descending ? "ascending" : "descending"} order`} className="mt-2 flex w-full items-center gap-2 border-t pt-3 text-sm hover:text-primary"><ArrowDownUp className="h-4 w-4" />Order: {descending ? "descending" : "ascending"}</button>
              </PopoverContent>
            </Popover>
            <div className="relative ml-auto min-w-[235px] max-w-[360px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input data-testid="input-roster-search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-9 border-border bg-white pl-9 focus-visible:ring-1" placeholder="Search cases…" />
            </div>
      </section>

      <section ref={resultsRef} id="roster-results" className="space-y-6 scroll-mt-6" aria-label="Cases grouped by stage">
        <div className="flex items-center justify-between border-b border-border pb-3 text-[13px] text-muted-foreground">
          <span>{scope === "all" ? "All cases" : stats.find(stat => stat.key === scope)?.label} · grouped by stage</span>
          <span className="tabular-nums">{filteredCases.length} case{filteredCases.length === 1 ? "" : "s"}</span>
        </div>
        <div className="space-y-6">
        {groupedCases.map(([stage, stageCases], index) => {
          const isOpen = !closedStages.has(stage);
          const warnings = stageCases.filter(c => Boolean(c.waitingOn)).length;
          const older = stageCases.filter(c => c.ageYears >= 4).length;
          return <section key={stage} className="overflow-hidden rounded-[10px] border border-border bg-card" data-testid={`stage-group-${stage}`}>
          <button type="button" aria-expanded={isOpen} aria-controls={`stage-cases-${index}`} data-testid={`button-toggle-stage-${stage}`} onClick={() => toggleStage(stage)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/50">
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-primary text-white"><ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} /></span>
            <span className="text-[14px] font-semibold">{stage}</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{stageCases.length} cases</span>
            {warnings > 0 && <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">{warnings} to confirm</span>}
            {older > 0 && <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{older} older</span>}
            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
          </button>
          <div id={`stage-cases-${index}`} role="region" aria-label={`${stage} cases`} hidden={!isOpen} className="border-t border-border">
            {stageCases.map((c) => <Link href={`/roster/${encodeURIComponent(c.id)}`} key={c.id} data-testid={`link-case-${c.id}`} title={`Latest hearing: ${narrativeExcerpt(c.lastHearing)}`} className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 transition-colors hover:bg-muted/50 last:border-b-0">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border border-primary/35 text-primary"><FileText className="h-3 w-3" aria-hidden="true" /></span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{c.filingNumber}</p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{c.partyId} · {c.purpose} · filed {dateLabel(c.filingDate)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[12px]">
                <span className="hidden text-muted-foreground lg:inline">{c.advocateId}</span>
                <span className="hidden w-16 text-right tabular-nums text-muted-foreground lg:inline">{c.ageYears.toFixed(1)} yrs</span>
                {(() => {
                  const rs = (c as { readiness_status?: string }).readiness_status || (c.waitingOn ? "BLOCKED" : "READY");
                  const cls = rs === "READY" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : rs === "HEALING" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-800";
                  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{rs}</span>;
                })()}
                {(c as { open_defect_count?: number }).open_defect_count ? <span className="hidden sm:inline text-muted-foreground">{(c as { open_defect_count?: number }).open_defect_count} defects</span> : null}
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </div>
            </Link>)}
          </div>
        </section>;
        })}
        {!filteredCases.length && <div className="border border-dashed border-border px-5 py-12 text-center" data-testid="empty-roster"><p className="font-medium">No cases match this view.</p><p className="mt-1 text-sm text-muted-foreground">Try a different filter or clear the current selection.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></div>}
        </div>
        {hasActiveCriteria && <button type="button" onClick={clearFilters} className="text-[12px] font-medium text-primary hover:underline">Show all cases</button>}
      </section>
    </div>
  );
}