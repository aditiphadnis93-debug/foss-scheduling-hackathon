import { useMemo } from "react";
import type { ScheduledCase } from "@workspace/api-client-react";
import { Gantt } from "@/components/reui/gantt/gantt";
import { GanttView } from "@/components/reui/gantt/gantt-view";
import type {
  GanttEvent,
  GanttProposedUpdate,
  GanttResource,
} from "@/components/reui/gantt/gantt-types";

export interface CourtHourlyGanttProps {
  date: string;
  cases: ScheduledCase[];
  morningStart: string;
  afternoonEnd: string;
  movedCaseIds: string[];
  disabled?: boolean;
  onSelectCase: (c: ScheduledCase) => void;
  onReorder: (caseId: string, date: string, order: number) => void;
}

const localDateTime = (date: string, time: string) =>
  new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);

const dateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const sittingMidpoint = (start: string, end: string) => {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const midpoint = Math.floor((startHour * 60 + startMinute + endHour * 60 + endMinute) / 2);
  return `${`${Math.floor(midpoint / 60)}`.padStart(2, "0")}:${`${midpoint % 60}`.padStart(2, "0")}`;
};

const timeMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesDate = (date: string, minutes: number) => {
  if (minutes >= 24 * 60) {
    const nextDay = localDateTime(date, "00:00");
    nextDay.setDate(nextDay.getDate() + 1);
    return nextDay;
  }
  return localDateTime(
    date,
    `${`${Math.floor(minutes / 60)}`.padStart(2, "0")}:${`${minutes % 60}`.padStart(2, "0")}`,
  );
};

const BUFFER_MINUTES = 120;

/**
 * Intraday court schedule. The Gantt is deliberately used as the source of
 * truth for the axis and gestures: the API persists a day/order move, not a
 * hand-edited timestamp.
 */
export function CourtHourlyGantt({
  date,
  cases,
  morningStart,
  afternoonEnd,
  movedCaseIds,
  disabled = false,
  onSelectCase,
  onReorder,
}: CourtHourlyGanttProps) {
  const resources = useMemo<GanttResource[]>(() => {
    const advocates = Array.from(new Set(cases.map((item) => item.advocateId)));
    return advocates.map((advocateId) => ({
      id: advocateId,
      title: advocateId,
      scheduleMode: "multiple",
    }));
  }, [cases]);

  const events = useMemo<GanttEvent<ScheduledCase>[]>(() => {
    return cases.map((item) => {
      const eventDate = item.date || date;
      return {
        id: item.caseId,
        title: item.purpose,
        start: localDateTime(eventDate, item.start),
        end: localDateTime(eventDate, item.end),
        allDay: false,
        resourceId: item.advocateId,
        data: item,
        color:
          item.likelihood === "High"
            ? "#60A5FA"
            : item.likelihood === "Medium"
              ? "#FBBF24"
              : "#94A3B8",
        draggable: !disabled,
        resizable: false,
      };
    });
  }, [cases, date, disabled]);

  // Keep the axis useful for a sitting rather than showing the empty day. The
  // Two-hour buffer is deliberately clamped to this date; an unusually early
  // or late scheduled case expands the finite range, but never into another
  // day. Event instants themselves remain untouched.
  const visibleRange = useMemo(() => {
    const scheduledStart = cases.reduce(
      (min, item) =>
        (item.date || date) === date ? Math.min(min, timeMinutes(item.start)) : min,
      Number.POSITIVE_INFINITY,
    );
    const scheduledEnd = cases.reduce(
      (max, item) =>
        (item.date || date) === date ? Math.max(max, timeMinutes(item.end)) : max,
      Number.NEGATIVE_INFINITY,
    );
    const startMinutes = Math.max(
      0,
       Math.min(timeMinutes(morningStart) - BUFFER_MINUTES, scheduledStart - BUFFER_MINUTES),
    );
    const endMinutes = Math.min(
      24 * 60,
       Math.max(timeMinutes(afternoonEnd) + BUFFER_MINUTES, scheduledEnd + BUFFER_MINUTES),
    );
    return {
       start: minutesDate(date, Number.isFinite(startMinutes) ? startMinutes : timeMinutes(morningStart) - BUFFER_MINUTES),
       end: minutesDate(date, Number.isFinite(endMinutes) ? endMinutes : timeMinutes(afternoonEnd) + BUFFER_MINUTES),
    };
  }, [afternoonEnd, cases, date, morningStart]);

  const onEventUpdate = (proposal: GanttProposedUpdate<ScheduledCase>) => {
    if (disabled || proposal.source !== "drag") return false;

    const caseItem = proposal.event.data;
    if (!caseItem) return false;

    const targetDate = dateKey(proposal.start);
    const targetAdvocate = proposal.resourceId ?? proposal.event.resourceId;
    // Gantt's horizontal gesture must never become an advocate reassignment.
    if (
      targetAdvocate !== caseItem.advocateId ||
      targetDate !== date
    ) {
      return false;
    }

    const targetDayCases = cases
      .filter((item) => (item.date || date) === targetDate)
      .sort((a, b) => a.start.localeCompare(b.start));
    const order = targetDayCases.filter(
      (item) => item.caseId !== caseItem.caseId && localDateTime(targetDate, item.start) < proposal.start,
    ).length;

    onReorder(caseItem.caseId, targetDate, order);
    // The schedule preview is refreshed by the parent; do not let the Gantt
    // persist a timestamp that the backend does not support.
    return false;
  };

  return (
    <section className="w-full overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm" data-testid="court-hourly-gantt">
      <div className="flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-tight">Hearing timetable</p>
          <p className="text-xs text-muted-foreground">
            {morningStart}–{afternoonEnd} · {cases.length} listed matter{cases.length === 1 ? "" : "s"}
          </p>
        </div>
        <p className="max-w-xl text-xs text-muted-foreground sm:text-right">
          Drag within this day to change listing order. For another day, open a case. Exact times are recalculated.
        </p>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="min-w-[1100px]">
        <Gantt
          events={events}
          resources={resources}
          defaultScale="day"
          defaultDate={localDateTime(date, "12:00")}
          initialCenter={localDateTime(date, sittingMidpoint(morningStart, afternoonEnd))}
           metrics={{
             unitWidths: { day: 2.7 },
             laneHeight: 4,
             minRowHeight: 5,
             rowPadding: 0.5,
             laneGap: 0.25,
           }}
          rangeBounds={{
             min: visibleRange.start,
             max: visibleRange.end,
          }}
           visibleRange={visibleRange}
           infiniteScroll={false}
          interactions={{ drag: !disabled, resize: false, selectSlot: false }}
          slotDuration={15}
          snapDuration={15}
          zoomControl={false}
          wheelZoom={false}
          scrollbars="native"
          onEventClick={(occurrence) => {
            if (occurrence.event.data) onSelectCase(occurrence.event.data);
          }}
          onEventUpdate={onEventUpdate}
          canDropEvent={(proposal) =>
            !disabled &&
            proposal.source === "drag" &&
            !!proposal.event.data &&
            proposal.resourceId === proposal.event.data.advocateId &&
            dateKey(proposal.start) === date
          }
          treePanel={{ width: 208 }}
          className="h-[520px] w-full"
          renderEvent={({ occurrence, isDragging }) => {
            const item = occurrence.event.data;
            if (!item) return <span className="truncate">{occurrence.event.title}</span>;
            const moved = movedCaseIds.includes(item.caseId);
            return (
              <span
                 className={`relative flex min-w-[10rem] flex-col justify-center gap-0.5 overflow-visible rounded-md px-2 py-1 text-[11px] leading-tight text-slate-900 ${
                  isDragging ? "opacity-80" : ""
                }`}
                 title={`${item.caseId} · Scheduled ${item.start}–${item.end} · ${item.purpose} · Window ${item.window}`}
                data-testid={`gantt-event-${item.caseId}`}
              >
                 <span className="relative z-10 flex min-w-0 items-center gap-1 font-semibold whitespace-normal break-words">
                   <span>{item.caseId} · {item.purpose}</span>
                  {moved && <span className="shrink-0 text-amber-700">moved</span>}
                </span>
                  <span className="relative z-10 whitespace-nowrap text-[10px] text-slate-700">
                    {item.start}–{item.end}
                  </span>
                  <span className="relative z-10 whitespace-nowrap text-[10px] text-slate-700">
                    Window {item.window}
                 </span>
                 <span
                   aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 start-0 -z-0 w-full rounded-e-md bg-(--gantt-event-color)/15"
                 />
              </span>
            );
          }}
        >
           <GanttView interval={30} />
        </Gantt>
        </div>
      </div>
    </section>
  );
}

export default CourtHourlyGantt;