import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCalendar, useGetLeave, useSaveLeave, getGetCalendarQueryKey, getGetLeaveQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";

export default function CalendarPage() {
  const { data: calendarDays, isLoading: isCalLoading } = useGetCalendar();
  const { data: leaveSettings, isLoading: isLeaveLoading } = useGetLeave();
  const saveLeave = useSaveLeave();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const initializedForId = useRef<string | null>(null);
  const [formData, setFormData] = useState({
    morningStart: "10:00",
    morningEnd: "13:30",
    afternoonStart: "14:00",
    afternoonEnd: "17:30",
    leaveDays: [] as string[]
  });

  useEffect(() => {
    if (leaveSettings && initializedForId.current !== "loaded") {
      initializedForId.current = "loaded";
      setFormData({
        morningStart: leaveSettings.morningStart,
        morningEnd: leaveSettings.morningEnd,
        afternoonStart: leaveSettings.afternoonStart,
        afternoonEnd: leaveSettings.afternoonEnd,
        leaveDays: leaveSettings.leaveDays || []
      });
    }
  }, [leaveSettings]);

  const handleSave = () => {
    saveLeave.mutate({ data: formData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCalendarQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLeaveQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        toast({ title: "Calendar settings saved", description: "Any cases on leave days will be re-planned in the next preview." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
      }
    });
  };

  const toggleLeaveDay = (dateStr: string) => {
    setFormData(prev => {
      const isSelected = prev.leaveDays.includes(dateStr);
      return {
        ...prev,
        leaveDays: isSelected 
          ? prev.leaveDays.filter(d => d !== dateStr)
          : [...prev.leaveDays, dateStr]
      };
    });
  };

  // Generate calendar grid for current month
  const gridDays = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  if (isCalLoading || isLeaveLoading) {
    return <div className="workspace-page space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  return (
    <div className="workspace-page space-y-8">
      <div className="workspace-header flex items-center justify-between">
        <div>
          <div className="workspace-breadcrumb">Court time planner <span aria-hidden="true">/</span> Calendar</div>
          <h1 className="workspace-title">Calendar & Hours</h1>
          <p className="workspace-subtitle">Sitting hours, leave, and court holidays from court_calendar</p>
        </div>
        <Button onClick={handleSave} disabled={saveLeave.isPending}>
          Save Settings
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader>
            <CardTitle>Availability</CardTitle>
            <CardDescription>Select days you are on leave. Holidays and weekends are automatically blocked.</CardDescription>
              <div className="flex items-center justify-between pt-3">
                <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="font-semibold">{format(month, "MMMM yyyy")}</span>
                <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="w-4 h-4" /></Button>
              </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center mb-2 font-medium text-sm text-muted-foreground">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {Array.from({length: startOfMonth(month).getDay()}, (_, i) => <div key={`blank-${i}`} aria-hidden="true" />)}
              {gridDays.map(date => {
                const dateStr = format(date, 'yyyy-MM-dd');
                const calDayInfo = calendarDays?.find(d => d.date === dateStr);
                const isLeave = formData.leaveDays.includes(dateStr);
                const isHoliday = calDayInfo?.holiday && calDayInfo.holiday !== "Personal leave" ? calDayInfo.holiday : "";
                const isWeeklyOff = calDayInfo?.weeklyOff;
                const isWorking = calDayInfo ? (!isWeeklyOff && !isHoliday) : ![0, 6].includes(date.getDay());

                let stateClass = "bg-card border hover:border-primary cursor-pointer";
                if (isHoliday || isWeeklyOff) {
                  stateClass = "bg-muted text-muted-foreground opacity-50 cursor-not-allowed border-transparent";
                } else if (isLeave) {
                  stateClass = "bg-destructive/10 border-destructive/30 text-destructive font-semibold";
                }

                return (
                  <button
                    type="button"
                    key={dateStr}
                    onClick={() => { if (!isHoliday && !isWeeklyOff && isWorking) toggleLeaveDay(dateStr); }}
                    disabled={!isWorking}
                    aria-label={`${format(date, "MMMM d")} ${isLeave ? "marked as leave" : isHoliday || (isWeeklyOff ? "weekly off" : "working day")}`}
                    aria-pressed={isLeave}
                    className={`aspect-square flex flex-col items-center justify-center rounded-md p-1 transition-colors text-sm border ${stateClass}`}
                  >
                    <span>{format(date, 'd')}</span>
                    {isHoliday && <span className="text-[9px] leading-tight truncate w-full px-1">{isHoliday}</span>}
                    {isLeave && <span className="text-[10px]">Leave</span>}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Sitting Hours</CardTitle>
            <CardDescription>Define daily court session times.</CardDescription>
          </CardHeader>
            <CardContent className="space-y-5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Morning Session</h3>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>Start Time</Label>
                  <Input 
                    type="time" 
                    value={formData.morningStart} 
                    onChange={e => setFormData(p => ({...p, morningStart: e.target.value}))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>End Time</Label>
                  <Input 
                    type="time" 
                    value={formData.morningEnd} 
                    onChange={e => setFormData(p => ({...p, morningEnd: e.target.value}))}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Afternoon Session</h3>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label>Start Time</Label>
                  <Input 
                    type="time" 
                    value={formData.afternoonStart} 
                    onChange={e => setFormData(p => ({...p, afternoonStart: e.target.value}))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>End Time</Label>
                  <Input 
                    type="time" 
                    value={formData.afternoonEnd} 
                    onChange={e => setFormData(p => ({...p, afternoonEnd: e.target.value}))}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}