import type { Task } from "@/features/projects/types";
import type { WeekEvent, Worklog } from "@/features/projects/types/time";
import type { WeekRowRef } from "@/features/projects/utils/timeWeek";

export const MAX_SUGGESTIONS = 30;
const MINUTE_MS = 60_000;
const MAX_ENTRY_MINUTES = 1440;
const MEETINGS_TITLE = "meetings";

export interface EventSuggestion {
  eventId: string;
  title: string;
  day: string;
  minutes: number;
  startTime: string;
}

export interface CompletedSuggestion extends WeekRowRef {
  day: string;
}

/** Meetings the person sat in during the week that are not logged on the target task yet. */
export function eventSuggestions(
  events: readonly WeekEvent[],
  days: readonly string[],
  userId: string,
  dayOf: (iso: string) => string,
  logged: readonly Worklog[],
  targetTaskId: string | null,
): EventSuggestion[] {
  const inWeek = new Set(days);
  const alreadyLogged = new Set(
    logged
      .filter((entry) => entry.taskId === targetTaskId)
      .map((entry) => `${entry.workDate}\n${entry.description}`),
  );
  return events
    .filter(
      (event) =>
        event.participantIds.includes(userId) &&
        !event.allDay &&
        !event.outOfOffice &&
        !event.focusTime &&
        !event.cancelled &&
        !event.transparent,
    )
    .map((event) => ({
      eventId: event.id,
      title: event.title,
      day: dayOf(event.startTime),
      minutes: Math.round((Date.parse(event.endTime) - Date.parse(event.startTime)) / MINUTE_MS),
      startTime: event.startTime,
    }))
    .filter(
      (suggestion) =>
        inWeek.has(suggestion.day) &&
        suggestion.minutes > 0 &&
        suggestion.minutes <= MAX_ENTRY_MINUTES &&
        !alreadyLogged.has(`${suggestion.day}\n${suggestion.title}`),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_SUGGESTIONS);
}

/** The person's tasks finished inside the week that have no row yet, newest first. */
export function completedSuggestions(
  tasks: readonly Task[],
  days: readonly string[],
  userId: string,
  excludeTaskIds: ReadonlySet<string>,
  dayOf: (iso: string) => string,
): CompletedSuggestion[] {
  const inWeek = new Set(days);
  return tasks
    .flatMap((task) =>
      task.completedAt && task.assigneeIds.includes(userId) && !excludeTaskIds.has(task.id)
        ? [{ task, completedAt: task.completedAt, day: dayOf(task.completedAt) }]
        : [],
    )
    .filter((candidate) => inWeek.has(candidate.day))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ task, day }) => ({ taskId: task.id, projectId: task.projectId, day }));
}

/** Where a meeting lands: the internal project's Meetings task, else its first open task. */
export function meetingsTaskOf(
  tasks: readonly Task[],
  internalProjectId: string | null,
): Task | null {
  if (!internalProjectId) return null;
  const open = tasks
    .filter((task) => task.projectId === internalProjectId && !task.completedAt)
    .sort((a, b) => a.number - b.number);
  return open.find((task) => task.title.trim().toLowerCase() === MEETINGS_TITLE) ?? open[0] ?? null;
}
