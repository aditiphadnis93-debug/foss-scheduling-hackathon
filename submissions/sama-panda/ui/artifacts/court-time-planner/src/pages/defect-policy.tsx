import { useEffect } from "react";
import {
  useGetPolicy,
  usePatchPolicy,
  defectWhatItMeans,
  type PolicyItem,
} from "@workspace/api-client-react";
import { setActorRole } from "@/hooks/use-actor-role";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Home, ChevronRight, Scale } from "lucide-react";

export default function DefectPolicyPage() {
  useEffect(() => {
    setActorRole("registry");
  }, []);

  const { data, isLoading, isError } = useGetPolicy();
  const patch = usePatchPolicy();
  const { toast } = useToast();

  const onToggle = (item: PolicyItem, next: boolean) => {
    if (item.locked_by_law) return;
    patch.mutate(
      { code: item.code, blocking: next },
      {
        onSuccess: () => {
          toast({
            title: next ? "Now blocking READY" : "Softened to warning",
            description: `${item.code} is ${next ? "blocking" : "soft"} — open defects of this code ${next ? "gate" : "do not gate"} READY.`,
          });
        },
        onError: (e) => {
          toast({
            title: "Policy update failed",
            description: (e as Error).message,
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="workspace-page space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="workspace-page text-destructive">
        Failed to load defect policy from :8000. Is the readiness API running?
      </div>
    );
  }

  const rows = data?.policy ?? [];

  return (
    <div className="workspace-page space-y-6">
      <header className="workspace-header">
        <div className="workspace-breadcrumb flex items-center gap-2">
          <Home className="h-3.5 w-3.5" />
          <ChevronRight className="h-3 w-3" />
          <span>Defect policy</span>
        </div>
        <h1 className="workspace-title flex items-center gap-2">
          <Scale className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Defect policy
        </h1>
        <p className="workspace-subtitle">
          Choose which open defects block READY. Soft defects stay as warnings; locked-by-law cannot be softened.
        </p>
      </header>

      <p className="text-sm text-muted-foreground">
        {rows.length} code{rows.length === 1 ? "" : "s"} · toggles require Role → registry · PATCH /policy/&#123;code&#125;
      </p>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Code</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Blocking</TableHead>
              <TableHead>By law</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  No policy codes returned.
                </TableCell>
              </TableRow>
            )}
            {rows.map((item) => {
              const busy = patch.isPending && patch.variables?.code === item.code;
              const plain = defectWhatItMeans(item.code, item.description);
              return (
                <TableRow key={item.code}>
                  <TableCell>
                    <div className="font-semibold text-sm font-mono tracking-tight">
                      {item.code}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground font-sans font-normal leading-snug">
                      {plain}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        item.severity === "HARD" || item.severity === "hard"
                          ? "border-rose-200 bg-rose-50 text-rose-900"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                      }
                    >
                      {item.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={item.blocking}
                        disabled={item.locked_by_law || busy}
                        onCheckedChange={(checked) => onToggle(item, checked)}
                        aria-label={`Blocking for ${item.code}`}
                      />
                      <span className="text-xs text-muted-foreground">
                        {item.blocking ? "ON — gates READY" : "OFF — warning only"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.locked_by_law ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-900 text-[10px]"
                      >
                        By law
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
