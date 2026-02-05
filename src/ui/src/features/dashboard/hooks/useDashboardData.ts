/**
 * useDashboardData - Aggregates data from all domain stores for the dashboard
 *
 * Provides a single hook to access all dashboard-relevant metrics
 * and loading states.
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';

export interface DashboardStats {
  notes: {
    total: number;
    loading: boolean;
  };
  files: {
    total: number;
    loading: boolean;
  };
  events: {
    upcoming: number;
    thisWeek: number;
    loading: boolean;
  };
  bookmarks: {
    total: number;
    loading: boolean;
  };
}

export function useDashboardData() {
  // Notes stats
  const notesCount = useAppSelector((state) => state.notes?.pagination?.totalCount ?? 0);
  const notesLoading = useAppSelector((state) => state.notes?.loading ?? false);

  // Files stats
  const filesCount = useAppSelector((state) => state.files?.pagination?.totalCount ?? 0);
  const filesLoading = useAppSelector((state) => state.files?.loading ?? false);

  // Calendar events
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const eventsLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  // Bookmarks
  const bookmarksCount = useAppSelector((state) => state.bookmarks?.totalCount ?? 0);
  const bookmarksLoading = useAppSelector((state) => state.bookmarks?.loading ?? false);

  // Calculate event counts
  const eventCounts = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let upcoming = 0;
    let thisWeek = 0;

    Object.values(events).forEach((event) => {
      const eventDate = new Date(event.startTime);
      if (eventDate >= now) {
        upcoming++;
        if (eventDate <= weekFromNow) {
          thisWeek++;
        }
      }
    });

    return { upcoming, thisWeek };
  }, [events]);

  const stats: DashboardStats = {
    notes: {
      total: notesCount,
      loading: notesLoading,
    },
    files: {
      total: filesCount,
      loading: filesLoading,
    },
    events: {
      upcoming: eventCounts.upcoming,
      thisWeek: eventCounts.thisWeek,
      loading: eventsLoading,
    },
    bookmarks: {
      total: bookmarksCount,
      loading: bookmarksLoading,
    },
  };

  const isLoading = notesLoading || filesLoading || eventsLoading || bookmarksLoading;

  return {
    stats,
    isLoading,
  };
}
