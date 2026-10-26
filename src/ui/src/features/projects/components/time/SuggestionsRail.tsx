import { useEffect, useMemo } from "react";
import { Plus } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { effectiveDayKey, formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import type { Task } from "@/features/projects/types";
import type { Worklog } from "@/features/projects/types/time";
import { selectTaskListLoadedIds } from "@/features/projects/store/projectsSlice";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { selectWeekEvents } from "@/features/projects/store/timeSlice";
import { fetchWeekEvents } from "@/features/projects/store/timeThunks";
import {
  completedSuggestions,
  eventSuggestions,
  meetingsTaskOf,
  MAX_SUGGESTIONS,
} from "@/features/projects/utils/timeSuggestions";
import { addDays, weekRangeKey, weekdayShort } from "@/features/projects/utils/timeWeek";
import type { WeekRowRef } from "@/features/projects/utils/timeWeek";

const RECENT_DAYS = 14;

export interface SuggestedEntry {
  taskId: string;
  title: string;
  workDate: string;
  durationMinutes: number;
  description: string;
}

interface SuggestionsRailProps {
  /** The visible week, first to last day. */
  days: readonly string[];
  /** Tasks of the org's internal project are pinned first, whoever they are assigned to. */
  pinnedProjectId: string | null;
  /** Rows already in the week; those tasks are hidden from the rail. */
  excludeTaskIds: ReadonlySet<string>;
  /** The week's entries, so a meeting already logged is not offered twice. */
  worklogs: readonly Worklog[];
  onPick: (row: WeekRowRef & { title: string }) => void;
  /** Opens the entry dialog prefilled from a suggestion. */
  onLog: (entry: SuggestedEntry) => void;
}

const dayOf = (iso: string) => effectiveDayKey(new Date(iso));

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-subtle-foreground">
      {children}
    </div>
  );
}

function Item({
  onClick,
  title,
  testId,
  children,
}: {
  onClick: () => void;
  title?: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60 transition-colors"
        data-testid={testId}
      >
        {children}
        <Plus
          size={12}
          className="mt-0.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
        />
      </button>
    </li>
  );
}

function TaskItem({
  task,
  slug,
  day,
  onPick,
}: {
  task: Task;
  slug: string;
  /** Shown before the code when the suggestion belongs to one day. */
  day?: string;
  onPick: () => void;
}) {
  return (
    <Item
      onClick={onPick}
      testId={day ? "suggested-completed" : "recent-task"}
      title={day ? `Completed ${formatDateShort(day)}` : undefined}
    >
      {day && <span className="w-7 shrink-0 text-muted-foreground">{weekdayShort(day)}</span>}
      <span className="shrink-0 font-mono text-muted-foreground">
        {slug.toUpperCase()}-{task.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
    </Item>
  );
}

/**
 * Candidates for a row or an entry: the internal project's tasks, the week's
 * meetings, the tasks finished this week and the ones touched lately.
 */
export function SuggestionsRail({
  days,
  pinnedProjectId,
  excludeTaskIds,
  worklogs,
  onPick,
  onLog,
}: SuggestionsRailProps) {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const projects = useAppSelector((state) => state.projects.projects);
  const tasks = useAppSelector((state) => state.projects.tasks);
  const loadedIds = useAppSelector(selectTaskListLoadedIds);
  const rangeKey = weekRangeKey(days[0], days[days.length - 1]);
  const events = useAppSelector(selectWeekEvents(rangeKey));

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  useEffect(() => {
    void dispatch(fetchWeekEvents({ from: days[0], to: days[days.length - 1] }));
  }, [dispatch, days]);

  // One sample page per project keeps the rail cheap; a project opened earlier already holds its tasks.
  useEffect(() => {
    for (const projectId of Object.keys(projects)) {
      if (!loadedIds[projectId]) dispatch(fetchProjectTasks({ projectId, firstPageOnly: true }));
    }
  }, [dispatch, projects, loadedIds]);

  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const meetingsTask = useMemo(
    () => meetingsTaskOf(taskList, pinnedProjectId),
    [taskList, pinnedProjectId],
  );

  const { pinned, meetings, completed, recent } = useMemo(() => {
    const since = addDays(effectiveDayKey(new Date()), -RECENT_DAYS);
    const candidates = taskList.filter((task) => !task.completedAt && !excludeTaskIds.has(task.id));
    const pinnedTasks = pinnedProjectId
      ? candidates
          .filter((task) => task.projectId === pinnedProjectId)
          .sort((a, b) => a.number - b.number)
      : [];
    const recentTasks = candidates
      .filter(
        (task) =>
          task.projectId !== pinnedProjectId &&
          task.assigneeIds.includes(userId) &&
          task.updatedAt.slice(0, 10) >= since,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, MAX_SUGGESTIONS);
    return {
      pinned: pinnedTasks,
      meetings: eventSuggestions(events, days, userId, dayOf, worklogs, meetingsTask?.id ?? null),
      completed: completedSuggestions(taskList, days, userId, excludeTaskIds, dayOf),
      recent: recentTasks,
    };
  }, [taskList, userId, pinnedProjectId, excludeTaskIds, events, days, worklogs, meetingsTask]);

  const slugOf = (task: Task) => projects[task.projectId]?.slug ?? "";
  const pick = (task: Task) =>
    onPick({ taskId: task.id, projectId: task.projectId, title: task.title });

  return (
    <aside
      className="flex h-full w-full flex-col border-l border-border bg-surface"
      data-testid="recent-tasks-rail"
    >
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border">
        Add a row
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {pinned.length > 0 && (
          <>
            <SectionTitle>Internal</SectionTitle>
            <ul>
              {pinned.map((task) => (
                <TaskItem key={task.id} task={task} slug={slugOf(task)} onPick={() => pick(task)} />
              ))}
            </ul>
          </>
        )}
        {meetings.length > 0 && (
          <>
            <SectionTitle>Meetings this week</SectionTitle>
            {meetingsTask ? (
              <ul>
                {meetings.map((meeting) => (
                  <Item
                    key={`${meeting.eventId}:${meeting.startTime}`}
                    testId="suggested-event"
                    title={`Log ${formatMinutes(meeting.minutes)} on ${meetingsTask.title} for ${formatDateShort(meeting.day)}`}
                    onClick={() =>
                      onLog({
                        taskId: meetingsTask.id,
                        title: meetingsTask.title,
                        workDate: meeting.day,
                        durationMinutes: meeting.minutes,
                        description: meeting.title,
                      })
                    }
                  >
                    <span className="w-7 shrink-0 text-muted-foreground">
                      {weekdayShort(meeting.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{meeting.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatMinutes(meeting.minutes)}
                    </span>
                  </Item>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1.5 text-xs text-subtle-foreground" data-testid="meetings-hint">
                Meetings log to the internal project once an admin creates it.
              </p>
            )}
          </>
        )}
        {completed.length > 0 && (
          <>
            <SectionTitle>Completed this week</SectionTitle>
            <ul>
              {completed.map((suggestion) => {
                const task = tasks[suggestion.taskId];
                return task ? (
                  <TaskItem
                    key={task.id}
                    task={task}
                    slug={slugOf(task)}
                    day={suggestion.day}
                    onPick={() => pick(task)}
                  />
                ) : null;
              })}
            </ul>
          </>
        )}
        <SectionTitle>Recent</SectionTitle>
        {recent.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-subtle-foreground">
            No tasks assigned to you were updated in the last {RECENT_DAYS} days.
          </p>
        ) : (
          <ul>
            {recent.map((task) => (
              <TaskItem key={task.id} task={task} slug={slugOf(task)} onPick={() => pick(task)} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
