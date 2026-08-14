import { useMemo } from "react";
import { CalendarDots, Clock, ArrowsClockwise, Bell } from "@phosphor-icons/react";
import { Select } from "@/components/ui/select";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";
import { cn } from "@/shared/utils/cn";
import { formatDateWithWeekday } from "@/shared/utils/dateFormatting";
import { formatTimeZoneLabel } from "@/shared/utils/timezone";
import { TimeSelect } from "@/features/calendar/components/modals/TimeSelect";
import { RecurrenceSelector } from "@/features/calendar/components/modals/RecurrenceSelector";
import { ReminderSelector } from "@/features/calendar/components/modals/ReminderSelector";
import type { CalendarEvent, RecurrenceConfig } from "@/features/calendar/types";
import { DAY_OF_WEEK_LABELS } from "@/features/calendar/constants";
import {
  displayParts,
  formatDateWithDay,
  formatTimeRange,
  getTimezoneOffset,
  instantDayKey,
  instantFromDisplayParts,
} from "@/features/calendar/utils";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";

/** Hours as a decimal on the display zone's clock (9:15 -> 9.25). */
function getTimeValue(isoString: string): number {
  const { hours, minutes } = displayParts(isoString);
  return hours + minutes / 60;
}

function getDateString(isoString: string): string {
  return instantDayKey(isoString);
}

function generateDateOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const today = new Date();

  for (let i = 30; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = getDateString(date.toISOString());
    options.push({ value: dateString, label: formatDateWithWeekday(dateString) });
  }

  for (let i = 0; i <= 60; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateString = getDateString(date.toISOString());
    const label =
      i === 0 ? `Today, ${formatDateWithWeekday(dateString)}` : formatDateWithWeekday(dateString);
    options.push({ value: dateString, label });
  }

  return options;
}

function describeRecurrence(r: RecurrenceConfig): string {
  const interval = r.interval || 1;
  const plural = interval > 1;

  switch (r.pattern) {
    case "daily": {
      const base = plural ? `Every ${interval} days` : "Daily";
      if (r.daysOfWeek && r.daysOfWeek.length > 0 && r.daysOfWeek.length < 7) {
        if (
          r.daysOfWeek.length === 5 &&
          !r.daysOfWeek.includes("saturday") &&
          !r.daysOfWeek.includes("sunday")
        ) {
          return `${base} (weekdays)`;
        }
        const dayNames = r.daysOfWeek.map((d) => DAY_OF_WEEK_LABELS[d]?.full || d).join(", ");
        return `${base} on ${dayNames}`;
      }
      return base;
    }
    case "weekly":
    case "biweekly": {
      const weeks = r.pattern === "biweekly" ? interval * 2 : interval;
      const prefix = weeks > 1 ? `Every ${weeks} weeks` : "Weekly";
      if (r.daysOfWeek && r.daysOfWeek.length > 0) {
        const dayNames = r.daysOfWeek.map((d) => DAY_OF_WEEK_LABELS[d]?.full || d).join(", ");
        return `${prefix} on ${dayNames}`;
      }
      return prefix;
    }
    case "monthly":
      if (r.dayOfMonth) {
        return plural
          ? `Every ${interval} months on the ${r.dayOfMonth}th`
          : `Monthly on the ${r.dayOfMonth}th`;
      }
      return plural ? `Every ${interval} months` : "Monthly";
    case "yearly":
      return plural ? `Every ${interval} years` : "Yearly";
    default:
      return "Does not repeat";
  }
}

interface EventScheduleSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventScheduleSection({ event, canEdit, commit }: EventScheduleSectionProps) {
  const dateOptions = useMemo(() => generateDateOptions(), []);

  const startDate = getDateString(event.startTime);
  const startTime = getTimeValue(event.startTime);
  const endDate = getDateString(event.endTime);
  const endTime = getTimeValue(event.endTime);
  const timezoneLabel = formatTimeZoneLabel();
  const timezoneTitle = `${timezoneLabel} (${getTimezoneOffset()})`;

  const commitStartDate = (next: string) => {
    const { hours, minutes } = displayParts(event.startTime);
    const current = instantFromDisplayParts(next, hours, minutes);
    commit({ startTime: current.toISOString() });
  };

  // Dragging the start past the end would invert the event, so the end follows by 30 minutes.
  const commitStartTime = (next: number) => {
    const current = instantFromDisplayParts(
      instantDayKey(event.startTime),
      Math.floor(next),
      Math.round((next % 1) * 60),
    );

    const end = new Date(event.endTime);
    if (current >= end) {
      const shifted = new Date(current.getTime() + 30 * 60000);
      commit({ startTime: current.toISOString(), endTime: shifted.toISOString() });
      return;
    }
    commit({ startTime: current.toISOString() });
  };

  const commitEndDate = (next: string) => {
    const { hours, minutes } = displayParts(event.endTime);
    const current = instantFromDisplayParts(next, hours, minutes);
    commit({ endTime: current.toISOString() });
  };

  const commitEndTime = (next: number) => {
    const current = instantFromDisplayParts(
      instantDayKey(event.endTime),
      Math.floor(next),
      Math.round((next % 1) * 60),
    );
    commit({ endTime: current.toISOString() });
  };

  if (!canEdit) {
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 text-sm">
          <CalendarDots size={16} weight="duotone" className="text-muted-foreground" />
          <span className="text-foreground">{formatDateWithDay(event.startTime)}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Clock size={16} weight="duotone" className="text-muted-foreground" />
          {event.isAllDay ? (
            <span className="text-foreground">All day</span>
          ) : (
            <>
              <span className="text-foreground">
                {formatTimeRange(event.startTime, event.endTime)}
              </span>
              <span className="text-muted-foreground text-xs" title={timezoneTitle}>
                ({timezoneLabel})
              </span>
            </>
          )}
        </div>
        {event.recurrence && event.recurrence.pattern !== "none" && (
          <div className="flex items-center gap-3 text-sm">
            <ArrowsClockwise size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-foreground">{describeRecurrence(event.recurrence)}</span>
          </div>
        )}
        {event.reminders.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <Bell size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-foreground">
              {event.reminders.map((m) => `${m} min before`).join(", ")}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel
          action={
            <button
              type="button"
              onClick={() => commit({ isAllDay: !event.isAllDay })}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <span
                className={cn(
                  "w-3 h-3 rounded-full border-2 transition-colors",
                  event.isAllDay ? "border-primary bg-primary" : "border-muted-foreground",
                )}
              />
              <span>Multi-day</span>
            </button>
          }
        >
          When{" "}
          <span className="normal-case font-normal" title={timezoneTitle}>
            ({timezoneLabel})
          </span>
        </SectionLabel>

        {event.isAllDay ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={startDate}
                onChange={commitStartDate}
                options={dateOptions}
                size="sm"
                className="w-full"
              />
              <TimeSelect value={startTime} onChange={commitStartTime} className="w-full" compact />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={endDate}
                onChange={commitEndDate}
                options={dateOptions}
                size="sm"
                className="w-full"
              />
              <TimeSelect value={endTime} onChange={commitEndTime} className="w-full" compact />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Select
              value={startDate}
              onChange={commitStartDate}
              options={dateOptions}
              size="sm"
              className="w-full"
            />
            <div className="grid grid-cols-2 gap-2">
              <TimeSelect value={startTime} onChange={commitStartTime} className="w-full" compact />
              <TimeSelect value={endTime} onChange={commitEndTime} className="w-full" compact />
            </div>
          </div>
        )}
      </div>

      {event.recurrenceId && (
        <p className="text-xs text-muted-foreground italic">
          Modified occurrence of a recurring series
        </p>
      )}

      <RecurrenceSelector
        value={event.recurrence}
        onChange={(recurrence) => commit({ recurrence })}
      />

      <div>
        <SectionLabel>Reminders</SectionLabel>
        <ReminderSelector
          value={event.reminders}
          onChange={(reminders) => commit({ reminders })}
          compact
        />
      </div>
    </div>
  );
}
