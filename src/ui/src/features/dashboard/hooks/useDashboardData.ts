// Staggered priority gates throttle widget render order: P1 immediate, P2 +200ms, P3 +500ms.

import { useMemo, useRef, useEffect, useState } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useAppSelector } from '@/app/hooks';
import type { RootState } from '@/app/store';
import type { CalendarEvent } from '@/features/calendar/types';
import type { Task } from '@/features/projects/types/project';

export type FetchPriority = 1 | 2 | 3;

export interface WidgetData<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export interface DashboardStats {
  todayEventsCount: number;
  tasksDueTodayCount: number;
  overdueTasksCount: number;
  unreadNotificationsCount: number;
  teamOnlineCount: number;
}

const isSameDay = (d1: Date, d2: Date) =>
  d1.getFullYear() === d2.getFullYear() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getDate() === d2.getDate();

const selectTodayEvents = createSelector(
  [(state: RootState) => state.calendar?.events ?? {}],
  (events): CalendarEvent[] => {
    const now = new Date();
    return Object.values(events)
      .filter((event: CalendarEvent) => {
        const start = new Date(event.startTime);
        return isSameDay(start, now);
      })
      .sort((a: CalendarEvent, b: CalendarEvent) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
  },
);

const selectMyTasks = createSelector(
  [
    (state: RootState) => state.projects?.tasks ?? {},
    (state: RootState) => state.auth.user?.id ?? '',
  ],
  (tasks, userId): { overdue: Task[]; dueToday: Task[]; inProgress: Task[] } => {
    const now = new Date();
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const inProgress: Task[] = [];

    Object.values(tasks as Record<string, Task>).forEach((task) => {
      if (task.deletedAt) return;
      if (!task.assigneeIds.includes(userId)) return;
      if (task.completedAt) return;

      if (task.dueDate) {
        const due = new Date(task.dueDate);
        if (due < now && !isSameDay(due, now)) {
          overdue.push(task);
        } else if (isSameDay(due, now)) {
          dueToday.push(task);
        } else {
          inProgress.push(task);
        }
      } else {
        inProgress.push(task);
      }
    });

    overdue.sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
    dueToday.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    inProgress.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { overdue, dueToday, inProgress };
  },
);

const selectOnlineUserIds = createSelector(
  [(state: RootState) => state.presence?.statuses ?? {}],
  (statuses): string[] =>
    Object.entries(statuses)
      .filter(([, status]) => status === 'online' || status === 'away' || status === 'dnd')
      .map(([userId]) => userId),
);

const selectRecentNotes = createSelector(
  [(state: RootState) => state.notes?.notes ?? {}],
  (notes) => {
    return Object.values(notes)
      .filter((n) => !n.isDeleted)
      .sort((a, b) => {
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  },
);

const selectRecentFiles = createSelector(
  [(state: RootState) => state.files?.files ?? {}],
  (files) => {
    return Object.values(files)
      .filter((f) => !f.isDeleted)
      .sort((a, b) => {
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  },
);

export function useDashboardData() {
  const [priority2Ready, setPriority2Ready] = useState(false);
  const [priority3Ready, setPriority3Ready] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const timer2 = setTimeout(() => {
      if (mountedRef.current) setPriority2Ready(true);
    }, 200);

    const timer3 = setTimeout(() => {
      if (mountedRef.current) setPriority3Ready(true);
    }, 500);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  const todayEvents = useAppSelector(selectTodayEvents);
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);
  const categories = useAppSelector((state) => state.calendar?.categories ?? {});

  const myTasks = useAppSelector(selectMyTasks);
  const tasksLoading = useAppSelector((state) => state.projects?.loading?.tasks ?? false);
  const projects = useAppSelector((state) => state.projects?.projects ?? {});

  const unreadCount = useAppSelector((state) => state.notifications?.unreadCount ?? 0);
  const notifications = useAppSelector((state) => state.notifications?.notifications ?? []);
  const notificationsLoading = useAppSelector((state) => state.notifications?.loading ?? false);

  const onlineUserIds = useAppSelector(selectOnlineUserIds);
  const presenceStatuses = useAppSelector((state) => state.presence?.statuses ?? {});
  const customStatuses = useAppSelector((state) => state.presence?.customStatuses ?? {});

  const notes = useAppSelector((state) => state.notes?.notes ?? {});
  const notesLoading = useAppSelector((state) => state.notes?.loading ?? false);
  const recentNotes = useAppSelector(selectRecentNotes);

  const files = useAppSelector((state) => state.files?.files ?? {});
  const filesLoading = useAppSelector((state) => state.files?.loading ?? false);
  const recentFiles = useAppSelector(selectRecentFiles);

  const bookmarks = useAppSelector((state) => state.bookmarks?.bookmarks ?? {});
  const bookmarksLoading = useAppSelector((state) => state.bookmarks?.loading ?? false);

  // The sessions slice is a plain store filled by run thunks; it tracks no fetch of its own.
  const agentSessions = useAppSelector((state) => state.agentSessions?.sessions ?? {});

  const events = useAppSelector((state) => state.calendar?.events ?? {});

  const stats: DashboardStats = useMemo(
    () => ({
      todayEventsCount: todayEvents.length,
      tasksDueTodayCount: myTasks.dueToday.length,
      overdueTasksCount: myTasks.overdue.length,
      unreadNotificationsCount: unreadCount,
      teamOnlineCount: onlineUserIds.length,
    }),
    [todayEvents.length, myTasks.dueToday.length, myTasks.overdue.length, unreadCount, onlineUserIds.length],
  );

  return {
    stats,

    todayEvents: {
      data: todayEvents,
      loading: eventsLoading,
      error: null,
    } as WidgetData<CalendarEvent[]>,
    categories,

    myTasks: {
      data: myTasks,
      loading: tasksLoading,
      error: null,
    } as WidgetData<{ overdue: Task[]; dueToday: Task[]; inProgress: Task[] }>,
    projects,

    notifications: {
      data: notifications,
      loading: notificationsLoading,
      error: null,
    },
    unreadCount,

    onlineUserIds,
    presenceStatuses,
    customStatuses,

    recentNotes: {
      data: recentNotes,
      loading: notesLoading,
      error: null,
    },

    recentFiles: {
      data: recentFiles,
      loading: filesLoading,
      error: null,
    },

    bookmarks: {
      data: bookmarks,
      loading: bookmarksLoading,
      error: null,
    },

    agentSessions: {
      data: agentSessions,
      loading: false,
      error: null,
    },

    events,
    notes,
    files,

    priority2Ready,
    priority3Ready,
  };
}
