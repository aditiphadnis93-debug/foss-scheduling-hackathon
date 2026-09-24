import { useEffect } from "react";
import { useGetScheduleImpact, useGetRules } from "@workspace/api-client-react";
import { useScheduleContext } from "@/store/schedule-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ArrowRight, AlertTriangle, ArrowLeftRight } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function ImpactPage() {
  const { startDate, period, moves } = useScheduleContext();
  const { data: rules } = useGetRules();
  const impactMutation = useGetScheduleImpact();

  useEffect(() => {
    if (rules && !impactMutation.isPending && !impactMutation.data) {
      impactMutation.mutate({
        data: {
          proposed_schedule: { rules, start_date: startDate, period },
          moves
        }
      });
    }
  }, [rules, startDate, period, moves]);

  const handleRefresh = () => {
    if (rules) {
      impactMutation.mutate({
        data: {
          proposed_schedule: { rules, start_date: startDate, period },
          moves
        }
      });
    }
  };

  const impact = impactMutation.data;

  if (impactMutation.isPending && !impact) {
    return <div className="workspace-page p-8 space-y-6"><Skeleton className="h-12 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="workspace-page space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="workspace-header flex items-center justify-between">
        <div>
          <div className="workspace-breadcrumb">Schedule / Impact</div>
          <h1 className="workspace-title text-3xl font-bold">Schedule Impact</h1>
          <p className="workspace-subtitle text-muted-foreground mt-1">Consequences of your priority rules and manual moves</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" className="gap-2" disabled={impactMutation.isPending}>
          <Activity className="w-4 h-4" /> Refresh Analysis
        </Button>
      </div>

      {!impact ? (
        <Card className="p-12 text-center text-muted-foreground">
          <p>No impact analysis available. Try refreshing.</p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Modelled outcomes from the supplied Python simulator and current roster, not observed hearings or guaranteed results. The 12-week forecast uses one reproducible simulation run. Please verify readiness before finalising.</p>
          <div className="grid md:grid-cols-2 gap-8">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-lg">Recommended Plan</CardTitle>
                <CardDescription>Based strictly on rules</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                     <div className="text-sm text-muted-foreground mb-1">Hearings in simulation</div>
                    <div className="text-3xl font-bold">{impact.recommended.heard}</div>
                  </div>
                  <div>
                     <div className="text-sm text-muted-foreground mb-1">Substantive in simulation</div>
                    <div className="text-3xl font-bold text-amber-600">{impact.recommended.forward}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Old Cases Touched</div>
                    <div className="text-2xl font-semibold">{impact.recommended.oldTouched}</div>
                  </div>
                   <div>
                      <div className="text-sm text-muted-foreground mb-1">Not reached in simulation</div>
                     <div className="text-2xl font-semibold">{impact.recommended.unheard}</div>
                   </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Estimated Hours</div>
                    <div className="text-2xl font-semibold">{impact.recommended.hours}h</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={moves.length > 0 ? "border-amber-500/50" : ""}>
              <CardHeader>
                <CardTitle className="text-lg">Your Choice</CardTitle>
                <CardDescription>Including manual overrides</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                     <div className="text-sm text-muted-foreground mb-1">Hearings in simulation</div>
                    <div className="text-3xl font-bold">{impact.choice.heard}</div>
                  </div>
                  <div>
                     <div className="text-sm text-muted-foreground mb-1">Substantive in simulation</div>
                    <div className="text-3xl font-bold text-amber-600">{impact.choice.forward}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Old Cases Touched</div>
                    <div className="text-2xl font-semibold">{impact.choice.oldTouched}</div>
                  </div>
                   <div>
                      <div className="text-sm text-muted-foreground mb-1">Not reached in simulation</div>
                     <div className="text-2xl font-semibold">{impact.choice.unheard}</div>
                   </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Estimated Hours</div>
                    <div className="text-2xl font-semibold">{impact.choice.hours}h</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
             <CardHeader><CardTitle>Older cases: simulated 12-week outlook</CardTitle><CardDescription>Pending cases in one modelled run, not actual case outcomes. A hearing does not necessarily close a case.</CardDescription></CardHeader>
            <CardContent><div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%">
              <LineChart data={impact.outlook} margin={{top: 8,right: 20,left: 0,bottom: 4}}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" interval={2} /><YAxis allowDecimals={false} domain={[0, "auto"]} />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="recommended" name="Recommended" stroke="#2A4B82" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="choice" name="Your choice" stroke="#B7791F" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer></div></CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ArrowLeftRight className="w-5 h-5 text-amber-500" /> Displaced Cases
                </CardTitle>
                 <CardDescription>Cases whose listed date changes with your rules or moves.</CardDescription>
              </CardHeader>
              <CardContent>
                {impact.affected.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No collateral delays identified.</div>
                ) : (
                  <div className="space-y-4">
                    {impact.affected.map(ac => (
                      <div key={ac.caseId} className="flex items-center justify-between text-sm p-3 bg-muted rounded-lg">
                        <div>
                           <div className="font-semibold">{ac.caseId}</div>
                          <div className="text-xs text-muted-foreground">Advocate: {ac.advocateId}</div>
                        </div>
                        <div className="flex items-center gap-2 text-amber-600 font-medium">
                           <span>{ac.oldDate}</span>
                          <ArrowRight className="w-3 h-3" />
                           <span>{ac.newDate}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" /> Side Effects
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <div className="font-medium text-sm text-muted-foreground">Extra Advocate Trips Created</div>
                    <div className="text-2xl font-bold text-destructive">{impact.extraTrips}</div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                     Advocates whose listed matter changes date. Extra trips are possible, not confirmed.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}