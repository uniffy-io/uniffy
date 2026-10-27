import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, Clock, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey, formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { useTaskSearch } from "@/features/projects/hooks/useTaskSearch";
import type { Worklog } from "@/features/projects/types/time";
import { useAssignedTasks } from "@/features/projects/hooks/useAssignedTasks";
import { selectWeekEvents, selectWeekWorklogs } from "@/features/projects/store/timeSlice";
import { fetchUserWorklogs, fetchWeekEvents } from "@/features/projects/store/timeThunks";
import {
  completedSuggestions,
  eventSuggestions,
  meetingsTaskOf,
  MAX_SUGGESTIONS,
} from "@/features/projects/utils/timeSuggestions";
import { addDays, weekRangeKey, weekdayShort } from "@/features/projects/utils/timeWeek";
import { useTaskLabels } from "./useTaskLabels";

const RECENT_DAYS = 14;

export interface SuggestedEntry {
  taskId: string;
  title: string;
  workDate: string;
  durationMinutes: number;
  description: string;
}

/** The fields the rail needs from a task, whether it came from the store, a log or a search. */
export interface RailTask {
  taskId: string;
  projectId: string;
  title: string;
}

type Filter = "recent" | "assigned" | "meetings";

const FILTER_OPTIONS: { value: Filter; content: ReactNode }[] = [
  {
    value: "recent",
    content: <span className="flex h-3.5 items-center justify-center px-1 text-xs">Recent</span>,
  },
  {
    value: "assigned",
    content: <span className="flex h-3.5 items-center justify-center px-1 text-xs">Assigned</span>,
  },
  {
    value: "meetings",
    content: <span className="flex h-3.5 items-center justify-center px-1 text-xs">Meetings</span>,
  },
];

interface RailRow extends RailTask {
  code: string | null;
  type: string;
  /** A weekday label when the row stands for something that happened on one day. */
  note?: string;
}

interface TaskRailProps {
  /** The visible week, first to last day. */
  days: readonly string[];
  /** The org's internal project is listed first, whoever its tasks are assigned to. */
  pinnedProjectId: string | null;
  /** The week's entries, so a meeting already logged is not offered twice. */
  worklogs: readonly Worklog[];
  /** A click on a task: opens it in full. */
  onOpen: (task: RailTask) => void;
  /** The clock beside a task: logs time on it. */
  onLog: (task: RailTask) => void;
  /** Opens the entry dialog prefilled from a meeting. */
  onLogMeeting: (entry: SuggestedEntry) => void;
}

const dayOf = (iso: string) => effectiveDayKey(new Date(iso));

function ProjectGroup({
  name,
  rows,
  collapsed,
  onToggle,
  onOpen,
  onLog,
}: {
  name: string;
  rows: RailRow[];
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (row: RailRow) => void;
  onLog: (row: RailRow) => void;
}) {
  return (
    <li data-testid="rail-project">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted/60"
        data-testid="rail-project-toggle"
      >
        {collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 tabular-nums text-subtle-foreground">{rows.length}</span>
      </button>
      {!collapsed && (
        <ul className="mb-1">
          {rows.map((row) => (
            <li key={row.taskId} className="group relative" data-testid="rail-task">
              <button
                type="button"
                onClick={() => onOpen(row)}
                title={`Open ${row.title}`}
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-8 pl-5 text-left text-xs hover:bg-muted/60"
              >
                <TaskTypeIcon type={row.type} size={12} className="text-muted-foreground" />
                {row.note && <span className="shrink-0 text-muted-foreground">{row.note}</span>}
                {row.code && (
                  <span className="shrink-0 font-mono text-muted-foreground">{row.code}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
              </button>
              <button
                type="button"
                onClick={() => onLog(row)}
                aria-label={`Log time on ${row.title}`}
                title="Log time"
                className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                data-testid="rail-log"
              >
                <Clock size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Find a task by search or by a quick filter, grouped by project; open it, or log time on it. */
export function TaskRail({
  days,
  pinnedProjectId,
  worklogs,
  onOpen,
  onLog,
  onLogMeeting,
}: TaskRailProps) {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const projects = useAppSelector((state) => state.projects.projects);
  const tasks = useAppSelector((state) => state.projects.tasks);
  const rangeKey = weekRangeKey(days[0], days[days.length - 1]);
  const events = useAppSelector(selectWeekEvents(rangeKey));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("recent");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { hits, loading: searching } = useTaskSearch(query);

  useEffect(() => {
    void dispatch(fetchWeekEvents({ from: days[0], to: days[days.length - 1] }));
  }, [dispatch, days]);

  const assignedTasks = useAssignedTasks();

  // What the person logged lately is the best guess at what they will log next.
  const today = effectiveDayKey(new Date());
  const recentFrom = addDays(today, -RECENT_DAYS);
  const loggedLately = useAppSelector(selectWeekWorklogs(weekRangeKey(recentFrom, today)));
  useEffect(() => {
    void dispatch(fetchUserWorklogs({ from: recentFrom, to: today }));
    // A new or removed entry can change what is recent; a moved one cannot.
  }, [dispatch, recentFrom, today, worklogs.length]);

  const taskList = useMemo(() => Object.values(tasks), [tasks]);
  const meetingsTask = useMemo(
    () => meetingsTaskOf(taskList, pinnedProjectId),
    [taskList, pinnedProjectId],
  );
  const meetings = useMemo(
    () => eventSuggestions(events, days, userId, dayOf, worklogs, meetingsTask?.id ?? null),
    [events, days, userId, worklogs, meetingsTask],
  );

  const loggedIds = useMemo(
    () => [...new Set(loggedLately.map((entry) => entry.taskId))],
    [loggedLately],
  );
  const labels = useTaskLabels(loggedIds);

  const rowOf = useCallback(
    (taskId: string, projectId: string): RailRow => {
      const task = tasks[taskId];
      const slug = projects[projectId]?.slug;
      return {
        taskId,
        projectId,
        title: task?.title || labels[taskId] || "Task",
        code: task && slug ? `${slug.toUpperCase()}-${task.number}` : null,
        type: task?.taskType || "task",
      };
    },
    [tasks, projects, labels],
  );

  const filtered = useMemo((): RailRow[] => {
    if (filter === "assigned") {
      return assignedTasks.map((task) => rowOf(task.id, task.projectId));
    }
    if (filter === "recent") {
      // Newest first: time logged, tasks finished this week, then assigned tasks touched lately.
      const since = addDays(today, -RECENT_DAYS);
      const seen = new Map<string, RailRow>();
      const byLatest = [...loggedLately].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const entry of byLatest) {
        if (!seen.has(entry.taskId)) seen.set(entry.taskId, rowOf(entry.taskId, entry.projectId));
      }
      for (const done of completedSuggestions(taskList, days, userId, new Set(), dayOf)) {
        const task = tasks[done.taskId];
        if (task && !seen.has(task.id)) {
          seen.set(task.id, { ...rowOf(task.id, task.projectId), note: weekdayShort(done.day) });
        }
      }
      for (const task of taskList) {
        if (
          !seen.has(task.id) &&
          !task.completedAt &&
          task.assigneeIds.includes(userId) &&
          task.updatedAt.slice(0, 10) >= since
        ) {
          seen.set(task.id, rowOf(task.id, task.projectId));
        }
      }
      return [...seen.values()].slice(0, MAX_SUGGESTIONS);
    }
    return [];
  }, [filter, assignedTasks, taskList, userId, loggedLately, rowOf, tasks, days, today]);

  const searchRows = useMemo(
    (): RailRow[] =>
      hits.map((hit) => ({
        taskId: hit.id,
        projectId: hit.projectId,
        title: hit.title,
        code: hit.code,
        type: hit.type,
      })),
    [hits],
  );
  const searchProjectNames = useMemo(
    () => Object.fromEntries(hits.map((hit) => [hit.projectId, hit.projectName])),
    [hits],
  );

  const hasQuery = query.trim().length > 0;
  const rows = hasQuery ? searchRows : filtered;
  const groups = useMemo(() => {
    const byProject = new Map<string, RailRow[]>();
    for (const row of rows) {
      const list = byProject.get(row.projectId) ?? [];
      list.push(row);
      byProject.set(row.projectId, list);
    }
    const nameOf = (projectId: string) =>
      projects[projectId]?.name || searchProjectNames[projectId] || "Project";
    return [...byProject.entries()]
      .map(([projectId, list]) => ({ projectId, name: nameOf(projectId), rows: list }))
      .sort((a, b) =>
        a.projectId === pinnedProjectId
          ? -1
          : b.projectId === pinnedProjectId
            ? 1
            : a.name.localeCompare(b.name),
      );
  }, [rows, projects, searchProjectNames, pinnedProjectId]);

  const toggle = (projectId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });

  const emptyText = hasQuery
    ? searching
      ? "Searching"
      : "No tasks match"
    : filter === "assigned"
      ? "No open tasks are assigned to you."
      : `Nothing logged, finished or assigned to you in the last ${RECENT_DAYS} days.`;

  return (
    <aside
      className="flex h-full w-full flex-col border-l border-border bg-surface"
      data-testid="task-rail"
    >
      <div className="space-y-2 border-b border-border p-2">
        <div className="relative">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-7 py-1 pr-7 pl-8 text-xs"
            data-testid="rail-search"
          />
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {!hasQuery && (
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={FILTER_OPTIONS}
            ariaLabel="Quick filter"
            className="h-7 w-full [&>button]:flex-1"
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!hasQuery && filter === "meetings" ? (
          meetings.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-subtle-foreground">
              No meetings left to log this week.
            </p>
          ) : !meetingsTask ? (
            <p className="px-2 py-1.5 text-xs text-subtle-foreground" data-testid="meetings-hint">
              Meetings log to the internal project once an admin creates it.
            </p>
          ) : (
            <ul>
              {meetings.map((meeting) => (
                <li key={`${meeting.eventId}:${meeting.startTime}`}>
                  <button
                    type="button"
                    title={`Log ${formatMinutes(meeting.minutes)} on ${meetingsTask.title} for ${formatDateShort(meeting.day)}`}
                    onClick={() =>
                      onLogMeeting({
                        taskId: meetingsTask.id,
                        title: meetingsTask.title,
                        workDate: meeting.day,
                        durationMinutes: meeting.minutes,
                        description: meeting.title,
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60"
                    data-testid="suggested-event"
                  >
                    <span className="w-7 shrink-0 text-muted-foreground">
                      {weekdayShort(meeting.day)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{meeting.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatMinutes(meeting.minutes)}
                    </span>
                    <Clock size={14} className="shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : groups.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-subtle-foreground">{emptyText}</p>
        ) : (
          <ul className={cn(hasQuery && searching && "opacity-60")}>
            {groups.map((group) => (
              <ProjectGroup
                key={group.projectId}
                name={group.name}
                rows={group.rows}
                collapsed={collapsed.has(group.projectId)}
                onToggle={() => toggle(group.projectId)}
                onOpen={onOpen}
                onLog={onLog}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
