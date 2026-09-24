import { useState } from "react";
import {
  useGetRegistryQueue,
  useRegistryVerify,
  useRegistryReject,
  useRegistryWaive,
  type Defect,
} from "@workspace/api-client-react";
import { setActorRole } from "@/hooks/use-actor-role";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Home, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export default function RegistryQueuePage() {
  useEffect(() => { setActorRole("registry"); }, []);
  const { data, isLoading, isError, refetch } = useGetRegistryQueue();
  const verify = useRegistryVerify();
  const reject = useRegistryReject();
  const waive = useRegistryWaive();
  const [reason, setReason] = useState("Incomplete evidence");
  const [err, setErr] = useState("");

  if (isLoading) return <div className="workspace-page space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (isError) return <div className="workspace-page text-destructive">Failed to load registry queue</div>;

  const defects = data?.defects ?? [];

  const act = async (kind: "verify" | "reject" | "waive", id: string) => {
    setErr("");
    try {
      if (kind === "verify") await verify.mutateAsync(id);
      else if (kind === "reject") await reject.mutateAsync({ defectId: id, reason });
      else await waive.mutateAsync({ defectId: id, note: reason || "Waived" });
      await refetch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="workspace-page space-y-6">
      <header className="workspace-header">
        <div className="workspace-breadcrumb flex items-center gap-2">
          <Home className="h-3.5 w-3.5" /><ChevronRight className="h-3 w-3" /><span>Registry queue</span>
        </div>
        <h1 className="workspace-title">Registry verify queue</h1>
        <p className="workspace-subtitle">Submitted defects awaiting verify / reject / waive (X-Actor-Role: registry).</p>
      </header>
      {err && <div className="text-sm text-destructive" role="alert">{err}</div>}
      <label className="block text-xs text-muted-foreground max-w-md">
        Reject / waive reason
        <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="text-sm text-muted-foreground">{defects.length} in queue</p>
      <div className="divide-y border rounded-lg bg-card">
        {defects.length === 0 && <p className="p-6 text-sm text-muted-foreground">Queue empty. Counsel/party uploads move defects to submitted.</p>}
        {defects.map((d: Defect) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-sm">{d.code}</p>
              <p className="text-xs text-muted-foreground">
                <Link href={`/roster/${encodeURIComponent(d.case_number)}`} className="text-primary hover:underline">{d.case_number}</Link>
                {" · "}{d.owner} · {d.status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{d.action_label}</Badge>
              <Button size="sm" onClick={() => void act("verify", d.id)}>Verify</Button>
              <Button size="sm" variant="outline" onClick={() => void act("reject", d.id)}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => void act("waive", d.id)}>Waive</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
