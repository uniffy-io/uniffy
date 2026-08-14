import { useEffect, useMemo, useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { fetchEventsInRange } from "@/features/calendar/store/calendarThunks";
import type { CalendarEvent } from "@/features/calendar/types";
import { displayDayKey, instantDayKey } from "@/features/calendar/utils";

interface TodayEventGroup {
  current: CalendarEvent[];
  next: CalendarEvent | null;
  later: CalendarEvent[];
  past: CalendarEvent[];
}

interface UseTodayEventsResult {
  groups: TodayEventGroup;
  now: Date;
  upcomingCount: number;
  hasCurrentEvent: boolean;
  loading: boolean;
  refresh: () => void;
}

function getTodayRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

function groupEvents(events: CalendarEvent[], now: Date): TodayEventGroup {
  const sorted = [...events].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  const current: CalendarEvent[] = [];
  const upcoming: CalendarEvent[] = [];
  const past: CalendarEvent[] = [];

  for (const event of sorted) {
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);

    if (end <= now) {
      past.push(event);
    } else if (start <= now && end > now) {
      current.push(event);
    } else {
      upcoming.push(event);
    }
  }

  return {
    current,
    next: upcoming[0] ?? null,
    later: upcoming.slice(1),
    past,
  };
}

export function useTodayEvents(enabled: boolean): UseTodayEventsResult {
  const dispatch = useAppDispatch();
  const events = useAppSelector((state) => state.calendar.events);
  const loading = useAppSelector((state) => state.calendar.loading.events);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(() => {
    const range = getTodayRange();
    dispatch(fetchEventsInRange(range));
  }, [dispatch]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  // Tick every minute so current/next regrouping stays accurate.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(refresh, 300_000);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  const todayEvents = useMemo(() => {
    const todayKey = instantDayKey(new Date());

    return Object.values(events).filter(
      (event) =>
        displayDayKey(event.startTime) === todayKey || displayDayKey(event.endTime) === todayKey,
    );
  }, [events]);

  const groups = useMemo(() => groupEvents(todayEvents, now), [todayEvents, now]);

  const upcomingCount = groups.current.length + (groups.next ? 1 : 0) + groups.later.length;
  const hasCurrentEvent = groups.current.length > 0;

  return {
    groups,
    now,
    upcomingCount,
    hasCurrentEvent,
    loading,
    refresh,
  };
}
