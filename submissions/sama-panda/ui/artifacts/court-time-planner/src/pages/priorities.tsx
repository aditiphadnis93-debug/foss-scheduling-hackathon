import { useState, useEffect, useRef } from "react";
import { useGetRules, useSaveRules, useGetScheduleImpact, type Rules } from "@workspace/api-client-react";
import { useScheduleContext } from "@/store/schedule-context";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRulesQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

export default function PrioritiesPage() {
  const { data: rulesData, isLoading } = useGetRules();
  const saveRules = useSaveRules();
  const impact = useGetScheduleImpact();
  const { startDate, period, moves } = useScheduleContext();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const initialized = useRef(false);
  const [formData, setFormData] = useState<Rules>({
    name: "Default Priorities",
    preset: "balanced",
    fullness: "balanced",
    oldCaseShare: 25,
    groupAdvocates: true,
    order: "complex-first"
  });

  useEffect(() => {
    if (rulesData && !initialized.current) {
      initialized.current = true;
      setFormData(rulesData);
    }
  }, [rulesData]);
  useEffect(() => {
    if (!initialized.current) return;
    const timer = window.setTimeout(() => impact.mutate({
      data: { proposed_schedule: { period, start_date: startDate, rules: formData }, moves }
    }), 250);
    return () => window.clearTimeout(timer);
  }, [formData, startDate, period, moves]);

  const handleSave = () => {
    saveRules.mutate({ data: formData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRulesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        toast({ title: "Priorities Saved", description: "The priority rules have been updated." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save priorities.", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return <div className="workspace-page space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  return (
    <div className="workspace-page space-y-8 max-w-4xl">
      <div className="workspace-header flex items-center justify-between">
        <div>
          <div className="workspace-breadcrumb">Court time planner <span aria-hidden="true">/</span> Priorities</div>
          <h1 className="workspace-title">Scheduling Priorities</h1>
          <p className="workspace-subtitle">Configure how cases are selected and ordered for the cause list.</p>
        </div>
        <Button onClick={handleSave} disabled={saveRules.isPending}>
          Save Rules
        </Button>
      </div>

      <div className="grid gap-6">
        <div className="space-y-2"><Label htmlFor="rule-name">Rule set name</Label><Input id="rule-name" value={formData.name} onChange={e => setFormData(p => ({...p, name: e.target.value}))} /></div>
        <Card>
          <CardHeader>
            <CardTitle>Strategy Preset</CardTitle>
            <CardDescription>Select a base strategy for case selection.</CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup 
              value={formData.preset} 
              onValueChange={(val: any) => setFormData(p => ({ ...p, preset: val }))}
              className="grid gap-4 md:grid-cols-2"
            >
              {[
                 { id: "balanced", label: "Recommended (balanced)", desc: "Balance older and complex matters." },
                 { id: "block", label: "Advocate blocks", desc: "Place an advocate's available matters together within the chosen period." },
                 { id: "advocate", label: "Group by advocate & purpose", desc: "Keep similar matters together and reduce repeat trips." },
                 { id: "new", label: "New matters first", desc: "Give recent filings earlier consideration." }
              ].map(preset => (
                <Label
                  key={preset.id}
                  className={`flex flex-col border rounded-lg p-4 cursor-pointer hover-elevate transition-all ${
                    formData.preset === preset.id ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <RadioGroupItem value={preset.id} id={preset.id} />
                    <span className="font-semibold text-base">{preset.label}</span>
                  </div>
                  <span className="text-sm text-muted-foreground ml-6">{preset.desc}</span>
                </Label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Time kept for old cases (4+ years)</CardTitle>
              <CardDescription>Reserve part of the day for older matters.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex justify-between text-sm font-medium">
                 <span>Reserved time</span>
                 <span className="text-primary font-bold">{formData.oldCaseShare}%</span>
              </div>
              <Slider
                value={[formData.oldCaseShare]}
                min={25}
                max={75}
                step={5}
                onValueChange={(vals) => setFormData(p => ({ ...p, oldCaseShare: vals[0] }))}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                  <span title="Older cases can't be pushed back below this. It's a court-wide rule.">25% minimum</span>
                <span>75%</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How full should the day be?</CardTitle>
              <CardDescription>How tightly to pack the cause list.</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup 
                value={formData.fullness} 
                onValueChange={(val: any) => setFormData(p => ({ ...p, fullness: val }))}
                className="flex flex-col gap-3"
              >
                {[
                  { id: "light", label: "Light", desc: "Leave room for overflow and complex arguments." },
                  { id: "balanced", label: "Balanced", desc: "Standard packing based on average duration." },
                 { id: "packed", label: "Packed", desc: "List more matters, leaving less time for delays." }
                ].map(opt => (
                  <div key={opt.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={opt.id} id={`full-${opt.id}`} />
                    <Label htmlFor={`full-${opt.id}`} className="flex flex-col">
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.desc}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
               <p className="text-sm text-muted-foreground mt-4">Compared with the recommended rules: {impact.data ? `${impact.data.choice.heard - impact.data.recommended.heard >= 0 ? "+" : ""}${impact.data.choice.heard - impact.data.recommended.heard} simulated hearings; ${impact.data.choice.unheard - impact.data.recommended.unheard >= 0 ? "+" : ""}${impact.data.choice.unheard - impact.data.recommended.unheard} simulated matters not reached during the selected ${period}.` : formData.fullness === "light" ? "fewer matters listed, more room if a hearing runs long." : formData.fullness === "packed" ? "more matters listed, but less room if a hearing runs long." : "room reserved if a hearing runs long."} Review the full comparison in See the impact.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Additional Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                 <Label className="text-base">Keep each advocate's matters together</Label>
                <p className="text-sm text-muted-foreground">
                  Attempt to schedule an advocate's cases consecutively.
                </p>
              </div>
              <Switch 
                checked={formData.groupAdvocates} 
                onCheckedChange={(c) => setFormData(p => ({ ...p, groupAdvocates: c }))} 
              />
            </div>
            <div className="space-y-3">
                 <Label className="text-base">Order of the day</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Determine the sequence of cases within a single sitting day.
              </p>
              <RadioGroup 
                value={formData.order} 
                onValueChange={(val: any) => setFormData(p => ({ ...p, order: val }))}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="complex-first" id="complex-first" />
                   <Label htmlFor="complex-first">Complex hearings first, short matters after</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="short-first" id="short-first" />
                   <Label htmlFor="short-first">Short matters first, complex hearings after</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}