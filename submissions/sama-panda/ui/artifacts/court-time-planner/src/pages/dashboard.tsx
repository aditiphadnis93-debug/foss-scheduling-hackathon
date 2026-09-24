import {
  useGetDashboard,
  useGetStats,
  useSeedDemo,
  type Case,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  Database,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const { data: dashboard, isLoading, isError } = useGetDashboard();
  const { data: stats, isLoading: statsLoading } = useGetStats();
  const seedDemo = useSeedDemo();
  const { toast } = useToast();

  const total = stats?.total ?? 0;
  const busy = seedDemo.isPending;

  const runSeedDemo = () => {
    seedDemo.mutate(undefined, {
      onSuccess: (result) => {
        const n = result.total ?? result.seeded_cases ?? 0;
        const ready = result.counts?.READY ?? 0;
        const blocked = result.counts?.BLOCKED ?? 0;
        toast({
          title: "Demo roster seeded",
          description: `${n.toLocaleString()} cases loaded · READY ${ready.toLocaleString()} · BLOCKED ${blocked.toLocaleString()}`,
        });
      },
      onError: (e) => {
        toast({
          title: "Seed demo failed",
          description: (e as Error).message,
          variant: "destructive",
        });
      },
    });
  };

  if (isLoading || statsLoading) {
    return (
      <div className="workspace-page space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="workspace-page p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <AlertTriangle className="w-8 h-8 mx-auto mb-4" />
        <h2 className="text-lg font-semibold">Failed to load dashboard</h2>
        <p>There was a problem retrieving the latest data.</p>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="workspace-page space-y-8">
        <div className="workspace-header">
          <div className="workspace-breadcrumb">
            Court time planner <span aria-hidden="true">/</span> Overview
          </div>
          <h1 className="workspace-title">Readiness overview</h1>
          <p className="workspace-subtitle">
            Master causelist is empty — seed a demo roster to explore readiness.
          </p>
        </div>

        <Card className="border-dashed max-w-xl">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Database className="size-5 text-muted-foreground" />
              </div>
              <div>
                <CardTitle>No causelist yet</CardTitle>
                <CardDescription className="mt-1">
                  Load the local demo roster (3,000 cases) to gate READY / BLOCKED /
                  HEALING and try Cause List packing.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={runSeedDemo} disabled={busy} className="gap-2">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Database className="size-4" />
              )}
              {busy ? "Seeding…" : "Seed demo roster (3,000)"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="workspace-page space-y-8">
      <div className="workspace-header flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="workspace-breadcrumb">
            Court time planner <span aria-hidden="true">/</span> Overview
          </div>
          <h1 className="workspace-title">Readiness overview</h1>
          <p className="workspace-subtitle">
            Master causelist readiness as of demo sitting{" "}
            <span className="font-semibold text-foreground">
              {new Date(dashboard.nextDate).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {" · "}
            <span className="text-foreground font-medium">
              {total.toLocaleString()} cases
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={runSeedDemo}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Reseed 3k
          </Button>
          <Button asChild className="gap-2">
            <Link href="/eligibility">
              Browse eligibility (READY) <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-x-4 md:grid-cols-2 lg:grid-cols-4 border-y border-border">
        <Card className="rounded-none border-0 border-b-[3px] border-primary">
          <CardHeader className="pb-1 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              READY cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{dashboard.recommendedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Eligible for a future day packer
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-none border-0 border-b-[3px] border-transparent">
          <CardHeader className="pb-1 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              HEALING (submitted)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{dashboard.movedForward}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Defects awaiting registry
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-none border-0 border-b-[3px] border-transparent">
          <CardHeader className="pb-1 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cases older than 4 years
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{dashboard.oldCases}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Trend unavailable without earlier rosters
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-none border-0 border-b-[3px] border-transparent">
          <CardHeader className="pb-1 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              BLOCKED cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{dashboard.sentHome}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Open hard/soft defects
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Needs your attention</h2>
        <p className="text-sm text-muted-foreground">
          Attention list: BLOCKED cases from GET /cases?status=BLOCKED. Clear defects
          on the case detail page.
        </p>
        {dashboard.attention.length === 0 ? (
          <div className="p-8 text-center border border-border bg-card">
            <CheckCircle className="w-8 h-8 text-primary mx-auto mb-3" />
            <h3 className="font-medium">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">
              No cases require manual intervention at this time.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {dashboard.attention.map((item: Case) => (
              <Card key={item.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <div className="w-12 text-destructive font-semibold shrink-0">
                      {item.ageYears}y
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.filingNumber}</span>
                        {item.flags.map((flag) => (
                          <Badge
                            key={flag}
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 shrink-0"
                          >
                            {flag === "OLD_CASE"
                              ? "4+ years old"
                              : flag === "WAITING_WARRANT"
                                ? "Process needs checking"
                                : flag}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {item.stage}{" "}
                        {item.waitingOn
                          ? `• ${item.waitingOn}`
                          : "• Older case needs review"}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="shrink-0">
                    <Link href={`/roster/${encodeURIComponent(item.id)}`}>Review</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
