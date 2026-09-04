import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PlusCircle,
  PencilSimple,
  Clock,
  MapPin,
  VideoCamera,
  Swatches,
  ArrowsClockwise,
  Bell,
  UserPlus,
  UserMinus,
  Check,
  X,
  Question,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { fetchEventActivities } from "@/features/calendar/store/calendarThunks";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import type { Subject } from "@/components/subject/types";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";
import type { EventActivity } from "@/features/calendar/types";

const INITIAL_VISIBLE = 6;

interface EventActivityLogProps {
  eventId: string;
}

export function EventActivityLog({ eventId }: EventActivityLogProps) {
  const dispatch = useAppDispatch();
  const activities = useAppSelector((state) => state.calendar.activities[eventId]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    dispatch(fetchEventActivities(eventId));
  }, [dispatch, eventId]);

  // Backend returns newest first; sort defensively so a stale cache still reads right.
  const sorted = useMemo(
    () =>
      [...(activities ?? [])].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    [activities],
  );

  const visible = isExpanded ? sorted : sorted.slice(0, INITIAL_VISIBLE);
  const hiddenCount = sorted.length - visible.length;

  const subjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const activity of visible) {
      ids.add(activity.actorId);
      for (const id of attendeeIdsFrom(activity)) {
        ids.add(id);
      }
    }
    return [...ids];
  }, [visible]);

  const { subjects } = useSubjectResolver(subjectIds);
  const subjectMap = useMemo(() => {
    const map: Record<string, Subject> = {};
    for (const subject of subjects) {
      map[subject.id] = subject;
    }
    return map;
  }, [subjects]);

  return (
    <div className="space-y-3">
      <SectionLabel>Activity</SectionLabel>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No activity yet</p>
      ) : (
        <div className="space-y-3">
          {visible.map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              actor={subjectMap[activity.actorId]}
              subjectMap={subjectMap}
            />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Show {hiddenCount} earlier {hiddenCount === 1 ? "entry" : "entries"}
            </button>
          )}
          {isExpanded && sorted.length > INITIAL_VISIBLE && (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ActivityItemProps {
  activity: EventActivity;
  actor?: Subject;
  subjectMap: Record<string, Subject>;
}

function ActivityItem({ activity, actor, subjectMap }: ActivityItemProps) {
  return (
    <div className="flex gap-2.5 text-sm">
      <div className="mt-0.5 shrink-0">
        {actor ? (
          <SubjectAvatar subject={actor} size="xs" />
        ) : (
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground font-medium">?</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-foreground text-xs">
            {actor?.name || "Unknown user"}
          </span>
          <span className="text-subtle-foreground shrink-0">
            <ActivityIcon activity={activity} />
          </span>
          <span className="text-foreground text-xs">{describeActivity(activity, subjectMap)}</span>
          <span className="text-muted-foreground text-[10px] shrink-0">
            {formatRelativeTime(activity.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ActivityIcon({ activity }: { activity: EventActivity }) {
  const size = 12;

  switch (activity.action) {
    case "created":
      return <PlusCircle size={size} />;
    case "schedule_changed":
      return <Clock size={size} />;
    case "location_changed":
      return <MapPin size={size} />;
    case "meeting_changed":
      return <VideoCamera size={size} />;
    case "category_changed":
    case "calendar_changed":
      return <Swatches size={size} />;
    case "recurrence_changed":
      return <ArrowsClockwise size={size} />;
    case "reminders_changed":
      return <Bell size={size} />;
    case "attendees_added":
      return <UserPlus size={size} />;
    case "attendees_removed":
      return <UserMinus size={size} />;
    case "response_changed":
      return <ResponseIcon status={activity.newValue} size={size} />;
    default:
      return <PencilSimple size={size} />;
  }
}

function ResponseIcon({ status, size }: { status?: string; size: number }) {
  switch (normalizeStatus(status)) {
    case "accepted":
      return <Check size={size} weight="bold" style={{ color: "var(--status-success)" }} />;
    case "declined":
      return <X size={size} weight="bold" style={{ color: "var(--status-error)" }} />;
    case "tentative":
      return <Question size={size} weight="bold" style={{ color: "var(--status-warning)" }} />;
    default:
      return <ClockCounterClockwise size={size} />;
  }
}

function describeActivity(activity: EventActivity, subjectMap: Record<string, Subject>): ReactNode {
  switch (activity.action) {
    case "created":
      return "created this event";

    case "title_changed":
      return (
        <span>
          renamed it to <Strong>{activity.newValue}</Strong>
        </span>
      );

    case "schedule_changed":
      return describeScheduleChange(activity);

    case "location_changed":
      return activity.newValue ? (
        <span>
          set the location to <Strong>{activity.newValue}</Strong>
        </span>
      ) : (
        "removed the location"
      );

    case "meeting_changed":
      if (activity.fieldId === "channel_id") return "changed the linked channel";
      return activity.newValue ? "updated the meeting link" : "removed the meeting link";

    case "description_changed":
      return "updated the description";

    case "category_changed":
      return "changed the category";

    case "calendar_changed":
      return "moved it to another calendar";

    case "recurrence_changed":
      return describeRecurrenceChange(activity);

    case "reminders_changed":
      return activity.newValue ? "updated the reminders" : "removed the reminders";

    case "attendees_added":
      return (
        <span>
          invited <Strong>{namesFor(activity.newValue, subjectMap)}</Strong>
        </span>
      );

    case "attendees_removed":
      return (
        <span>
          removed <Strong>{namesFor(activity.previousValue, subjectMap)}</Strong>
        </span>
      );

    case "response_changed":
      return describeResponse(activity.newValue);

    default:
      return activity.fieldId ? (
        <span>
          updated <Strong>{humanizeField(activity.fieldId)}</Strong>
        </span>
      ) : (
        "updated the event"
      );
  }
}

function describeScheduleChange(activity: EventActivity): ReactNode {
  switch (activity.fieldId) {
    case "start_time":
      return (
        <span>
          moved the start to <Strong>{formatDateTimeValue(activity.newValue)}</Strong>
        </span>
      );
    case "end_time":
      return (
        <span>
          moved the end to <Strong>{formatDateTimeValue(activity.newValue)}</Strong>
        </span>
      );
    case "is_all_day":
      return activity.newValue === "True" ? "made it an all-day event" : "gave it a set time";
    case "timezone":
      return (
        <span>
          changed the timezone to <Strong>{activity.newValue}</Strong>
        </span>
      );
    default:
      return "changed the schedule";
  }
}

function describeRecurrenceChange(activity: EventActivity): ReactNode {
  switch (activity.fieldId) {
    case "cancelled_occurrence":
      return (
        <span>
          cancelled the occurrence on <Strong>{formatDateValue(activity.newValue)}</Strong>
        </span>
      );
    case "occurrence_override":
      return (
        <span>
          edited the occurrence on <Strong>{formatDateValue(activity.newValue)}</Strong>
        </span>
      );
    case "series_split":
      return (
        <span>
          split the series from <Strong>{formatDateValue(activity.newValue)}</Strong>
        </span>
      );
    default:
      return "changed the recurrence";
  }
}

function describeResponse(status?: string): ReactNode {
  switch (normalizeStatus(status)) {
    case "accepted":
      return "accepted the invite";
    case "declined":
      return "declined the invite";
    case "tentative":
      return "responded maybe";
    default:
      return "reset their response";
  }
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function attendeeIdsFrom(activity: EventActivity): string[] {
  if (activity.action === "attendees_added") return splitIds(activity.newValue);
  if (activity.action === "attendees_removed") return splitIds(activity.previousValue);
  return [];
}

function splitIds(value?: string): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

function namesFor(value: string | undefined, subjectMap: Record<string, Subject>): string {
  const ids = splitIds(value);
  if (ids.length === 0) return "someone";

  const names = ids.map((id) => subjectMap[id]?.name ?? "someone");
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function normalizeStatus(status?: string): string {
  return (status ?? "").toLowerCase();
}

function humanizeField(fieldId: string): string {
  return fieldId.replace(/_/g, " ");
}

function formatDateTimeValue(value?: string): string {
  if (!value) return "a new time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateValue(value?: string): string {
  if (!value) return "that date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
