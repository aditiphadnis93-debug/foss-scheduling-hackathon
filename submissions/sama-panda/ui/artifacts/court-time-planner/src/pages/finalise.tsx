import { useState } from "react";
import { usePublishSchedule, useGetRules, useGetPublications, getGetPublicationsQueryKey, type PublishResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useScheduleContext } from "@/store/schedule-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Printer, Send, Lock, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function FinalisePage() {
  const { startDate, period, moves, clearMoves } = useScheduleContext();
  const { data: rules } = useGetRules();
  const publishMutation = usePublishSchedule();
  const { data: publications } = useGetPublications();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [publishedData, setPublishedData] = useState<PublishResult | null>(null);
  const [revising, setRevising] = useState(false);
  const [view, setView] = useState<'success' | 'print' | 'notify'>('success');
  const list = publishedData || (!revising && publications?.findLast(p => p.days[0]?.date === startDate));

  const handlePublish = () => {
    if (!rules) return;
    
    publishMutation.mutate({
      data: {
        proposed_schedule: { rules, start_date: startDate, period },
        moves
      }
    }, {
      onSuccess: (data) => {
        setPublishedData(data);
        setRevising(false);
        setView('success');
        clearMoves();
        queryClient.invalidateQueries({ queryKey: getGetPublicationsQueryKey() });
        toast({ title: "Cause List Published", description: "The schedule for this period has been finalised." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to finalise schedule.", variant: "destructive" });
      }
    });
  };

  if (list && view === 'print') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
         <div className="print-hidden flex justify-between">
           <Button variant="ghost" onClick={() => setView('success')} className="gap-2"><ArrowLeft className="w-4 h-4" /> Back</Button>
           <Button onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print or save as PDF</Button>
         </div>
         <div className="print-sheet bg-white text-black p-8 md:p-12 shadow-sm border rounded-md">
          <div className="text-center mb-8 border-b-2 border-black pb-6">
             <h1 className="text-2xl font-bold uppercase tracking-wider mb-2">Cause List</h1>
            <p className="text-lg">Before Justice Sehgal</p>
             <p className="text-sm mt-2 text-gray-600">Finalised: {format(new Date(list.publishedAt), 'MMMM d, yyyy h:mm a')}</p>
          </div>
           {list.days.map((day) => (
            <div key={day.date} className="mb-10 page-break-after-auto">
              <h2 className="text-xl font-bold mb-4 bg-gray-100 p-2">{format(new Date(day.date), 'EEEE, MMMM d, yyyy')}</h2>
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                     <th className="py-2 pr-4 font-semibold w-32">Appointment window</th>
                     <th className="py-2 pr-4 font-semibold">Block</th>
                    <th className="py-2 pr-4 font-semibold">Case No</th>
                    <th className="py-2 pr-4 font-semibold">Advocate</th>
                    <th className="py-2 font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {day.cases.map(c => (
                    <tr key={c.caseId} className="border-b border-gray-200">
                       <td className="py-3 pr-4 whitespace-nowrap align-top">{c.window}</td>
                       <td className="py-3 pr-4 align-top">{c.block}</td>
                      <td className="py-3 pr-4 align-top font-medium">{c.caseId}</td>
                      <td className="py-3 pr-4 align-top">{c.advocateId}</td>
                      <td className="py-3 align-top">{c.purpose}</td>
                    </tr>
                  ))}
                  {day.cases.length === 0 && (
                     <tr><td colSpan={5} className="py-4 text-center italic text-gray-500">No cases scheduled</td></tr>
                  )}
                </tbody>
              </table>
              {day.overflow.length > 0 && (
                <div className="mt-4 pt-4 border-t border-dashed border-gray-400">
                  <h3 className="font-semibold mb-2">Overflow Cases (To be mentioned)</h3>
                  <div className="text-sm flex flex-wrap gap-2">
                    {day.overflow.map(c => <span key={c} className="bg-gray-100 px-2 py-1 rounded">{c}</span>)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (list && view === 'notify') {
    return (
      <div className="workspace-page max-w-2xl mx-auto space-y-6 animate-in fade-in">
        <Button variant="ghost" onClick={() => setView('success')} className="gap-2">
           <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Message Preview</CardTitle>
             <CardDescription>Example only. No messages are sent by this prototype.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="text-sm font-semibold text-muted-foreground mb-2">SMS / WhatsApp Preview</div>
              <p className="font-mono text-sm leading-relaxed">
                 Cause list: {list.days[0]?.cases[0]?.caseId || "Your matter"} before Justice Sehgal on {format(new Date(list.days[0]?.date || startDate), 'MMM d')}, appointment window {list.days[0]?.cases[0]?.window || "to be confirmed"}. Bring case papers and any required filings. This is an estimate; the court may run late.
              </p>
            </div>
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="text-sm font-semibold text-muted-foreground mb-2">Email Preview</div>
               <p className="text-sm leading-relaxed whitespace-pre-wrap">
                Dear Advocate,
                
                 The cause list for the upcoming sitting before Justice Sehgal has been finalised.
                
                 Matter: {list.days[0]?.cases[0]?.caseId || "To be confirmed"}. Appointment window: {list.days[0]?.cases[0]?.window || "To be confirmed"}. Please bring case papers and required filings. Actual hearing times may vary.
                
                Regards,
                Registry
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (list && view === 'success') {
    return (
      <div className="workspace-page max-w-2xl mx-auto mt-12 animate-in zoom-in-95 duration-500">
        <Card className="text-center border-primary bg-primary/5 p-8">
          <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-foreground mb-2">List Finalised</h2>
          <p className="text-muted-foreground mb-8">
            The cause list starting {format(new Date(startDate), 'MMMM d, yyyy')} has been finalised for the registry.
          </p>
          <div className="flex justify-center gap-4">
            <Button variant="outline" onClick={() => setView('print')} className="gap-2 bg-background">
               <Printer className="w-4 h-4" /> Printable cause list
            </Button>
            <Button variant="outline" onClick={() => setView('notify')} className="gap-2 bg-background">
              <Send className="w-4 h-4" /> Message Preview
            </Button>
          </div>
           <Button variant="link" className="mt-4" onClick={() => { setPublishedData(null); setRevising(true); }}>Create a revised cause list</Button>
           <p className="text-xs text-muted-foreground mt-5">Stored in this planner. Message delivery is not connected.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="workspace-page space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="workspace-header">
        <div className="workspace-breadcrumb">Schedule / Finalise</div>
        <h1 className="workspace-title text-3xl font-bold">Finalise Schedule</h1>
        <p className="workspace-subtitle text-muted-foreground mt-1">Review your changes and seal the cause list.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary of Actions</CardTitle>
          <CardDescription>For period starting {format(new Date(startDate), 'MMM d, yyyy')} ({period})</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Rules Applied</span>
            <span className="font-semibold">{rules?.name || "Loading..."}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Manual Overrides (Moves)</span>
            <span className="font-semibold">{moves.length}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Status</span>
            <span className="text-amber-600 font-semibold flex items-center gap-2">
              <Lock className="w-4 h-4" /> Draft
            </span>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/50 p-6 flex justify-between items-center mt-6">
          <p className="text-sm text-muted-foreground max-w-sm">
             Finalising stores this cause list and its override notes. It does not send notifications.
          </p>
          <Button size="lg" onClick={handlePublish} disabled={publishMutation.isPending || !rules}>
            {publishMutation.isPending ? "Publishing..." : "Publish Cause List"}
          </Button>
        </CardFooter>
      </Card>
      {publications && publications.length > 0 && <Card className="p-6"><h2 className="font-semibold mb-3">Recent changes and finalised lists</h2><div className="space-y-3 text-sm">{publications.slice(-5).reverse().map(p => {
        const baseline = new Map(p.recommended.flatMap(d => d.cases.map(c => [c.caseId, d.date] as const)));
        const changed = p.days.flatMap(d => d.cases.filter(c => baseline.get(c.caseId) !== d.date).map(c => `${c.caseId} → ${d.date}`));
        return <div key={p.id} className="border-t pt-3"><strong>{format(new Date(p.publishedAt), "MMM d, yyyy h:mm a")}</strong> · {p.days.length} sitting days · {changed.length} different dates from recommended{changed.map(text => <div key={text} className="text-muted-foreground">{text}</div>)}{p.moves.map(m => <div key={m.caseId} className="text-muted-foreground">Override: {m.caseId} to {m.date}{m.note ? ` — ${m.note}` : ""}</div>)}</div>;
      })}</div></Card>}
    </div>
  );
}