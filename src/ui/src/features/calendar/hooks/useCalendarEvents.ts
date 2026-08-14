import { useMemo, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { addEvent, updateEvent, removeEvent } from "@/features/calendar/store/calendarSlice";
import {
  selectEvent,
  deselectEvent,
  openEventModal,
  closeEventModal,
} from "@/features/calendar/store/calendarUiSlice";
import type { CalendarEvent, EventModalPrefill, PositionedEvent } from "@/features/calendar/types";
import {
  getPositionedEventsForDay,
  getPositionedEventsForWeek,
  areSameDay,
  matchesQuickAccess,
} from "@/features/calendar/utils";
import { GRID } from "@/features/calendar/constants";

export function useCalendarEvents() {
  const dispatch = useAppDispatch();

  const events = useAppSelector((state) => state.calendar.events);
  const filters = useAppSelector((state) => state.calendar.filters);
  const loading = useAppSelector((state) => state.calendar.loading);
  const errors = useAppSelector((state) => state.calendar.errors);

  const quickAccessFilter = useAppSelector((state) => state.calendarUi.quickAccessFilter);
  const bookmarkedUrns = useAppSelector((state) => state.bookmarks.bookmarkedUrns);

  const selectedEventId = useAppSelector((state) => state.calendarUi.selectedEventId);
  const isEventModalOpen = useAppSelector((state) => state.calendarUi.isEventModalOpen);
  const eventModalMode = useAppSelector((state) => state.calendarUi.eventModalMode);
  const eventModalPrefill = useAppSelector((state) => state.calendarUi.eventModalPrefill);

  const visibleEvents = useMemo(() => {
    const allEvents = Object.values(events);
    const now = new Date();

    return allEvents.filter((event) => {
      if (quickAccessFilter && !matchesQuickAccess(event, quickAccessFilter, now, bookmarkedUrns)) {
        return false;
      }

      if (filters.categoryIds.length > 0 && !filters.categoryIds.includes(event.categoryId)) {
        return false;
      }

      // Tag filter is logical AND, matching server-side `tag_ids[]` on ListEventsRequest.
      if (filters.tagIds.length > 0) {
        const hasAllTags = filters.tagIds.every((tagId) => event.tagIds.includes(tagId));
        if (!hasAllTags) {
          return false;
        }
      }

      if (filters.focusTimeOnly && !event.isFocusTime) {
        return false;
      }

      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesTitle = event.title.toLowerCase().includes(query);
        const matchesDescription = event.description.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDescription) {
          return false;
        }
      }

      return true;
    });
  }, [events, filters, quickAccessFilter, bookmarkedUrns]);

  const getEventsForDate = useCallback(
    (date: Date | string) => {
      return visibleEvents.filter((event) => areSameDay(event.startTime, date));
    },
    [visibleEvents],
  );

  const getPositionedEvents = useCallback(
    (date: Date | string): PositionedEvent[] => {
      return getPositionedEventsForDay(visibleEvents, date, GRID.START_HOUR, GRID.HOUR_HEIGHT);
    },
    [visibleEvents],
  );

  const getPositionedEventsWeek = useCallback(
    (weekDates: Date[]): Map<string, PositionedEvent[]> => {
      return getPositionedEventsForWeek(
        visibleEvents,
        weekDates,
        GRID.START_HOUR,
        GRID.HOUR_HEIGHT,
      );
    },
    [visibleEvents],
  );

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events[selectedEventId] ?? null;
  }, [events, selectedEventId]);

  const allTagIds = useMemo(() => {
    const tagSet = new Set<string>();
    visibleEvents.forEach((event) => {
      event.tagIds.forEach((tagId) => tagSet.add(tagId));
    });
    return Array.from(tagSet);
  }, [visibleEvents]);

  const handleSelectEvent = useCallback(
    (eventId: string | null) => {
      dispatch(selectEvent(eventId));
    },
    [dispatch],
  );

  const handleDeselectEvent = useCallback(() => {
    dispatch(deselectEvent());
  }, [dispatch]);

  const handleAddEvent = useCallback(
    (event: CalendarEvent) => {
      dispatch(addEvent(event));
    },
    [dispatch],
  );

  const handleUpdateEvent = useCallback(
    (event: CalendarEvent) => {
      dispatch(updateEvent(event));
    },
    [dispatch],
  );

  const handleRemoveEvent = useCallback(
    (eventId: string) => {
      dispatch(removeEvent(eventId));
      if (selectedEventId === eventId) {
        dispatch(deselectEvent());
      }
    },
    [dispatch, selectedEventId],
  );

  const handleOpenEventModal = useCallback(
    (mode: "create" | "edit", prefill?: EventModalPrefill) => {
      dispatch(openEventModal({ mode, prefill }));
    },
    [dispatch],
  );

  const handleCloseEventModal = useCallback(() => {
    dispatch(closeEventModal());
  }, [dispatch]);

  return {
    events,
    visibleEvents,
    selectedEvent,
    selectedEventId,
    allTagIds,

    isEventModalOpen,
    eventModalMode,
    eventModalPrefill,

    loading,
    errors,

    getEventsForDate,
    getPositionedEvents,
    getPositionedEventsWeek,

    selectEvent: handleSelectEvent,
    deselectEvent: handleDeselectEvent,
    addEvent: handleAddEvent,
    updateEvent: handleUpdateEvent,
    removeEvent: handleRemoveEvent,
    openEventModal: handleOpenEventModal,
    closeEventModal: handleCloseEventModal,
  };
}
