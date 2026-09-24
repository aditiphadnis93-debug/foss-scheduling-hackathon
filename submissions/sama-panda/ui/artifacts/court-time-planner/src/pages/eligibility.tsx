import { useGetEligibility, type ApiCaseListItem } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Home, ChevronRight } from "lucide-react";

export default function EligibilityPage() {
  const { data, isLoading, isError } = useGetEligibility("2026-09-22");

  if (isLoading) return <div className="workspace-page space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (isError) return <div className="workspace-page text-destructive">Failed to load eligibility from :8000</div>;

  const cases = data?.cases ?? [];

  return (
    <div className="workspace-page space-y-6">
      <header className="workspace-header">
        <div className="workspace-breadcrumb flex items-center gap-2">
          <Home className="h-3.5 w-3.5" /><ChevronRight className="h-3 w-3" /><span>Eligibility</span>
        </div>
        <h1 className="workspace-title">Listing eligibility (READY only)</h1>
        <p className="workspace-subtitle">GET /eligibility?as_of={data?.as_of} — feed for a future day packer. Not scheduled here.</p>
      </header>
      <p className="text-sm text-muted-foreground">{cases.length} READY case{cases.length === 1 ? "" : "s"}</p>
      <div className="divide-y border rounded-lg bg-card">
        {cases.length === 0 && <p className="p-6 text-sm text-muted-foreground">No READY cases yet. Clear defects from Roster → case detail.</p>}
        {cases.map((c: ApiCaseListItem) => (
          <div key={c.case_number} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold text-sm">{c.filing_number || c.case_number}</p>
              <p className="text-xs text-muted-foreground">{c.purpose} · {c.stage} · {c.advocate_id}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-800">READY</Badge>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/roster/${encodeURIComponent(c.case_number)}`}>Open</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
