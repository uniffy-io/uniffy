/**
 * Hook for managing calendar events
 */

import { useMemo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  addEvent,
  updateEvent,
  removeEvent,
} from '../store/calendarSlice';
import {
  selectEvent,
  deselectEvent,
  openEventModal,
  closeEventModal,
} from '../store/calendarUiSlice';
import type { CalendarEvent, EventModalPrefill, PositionedEvent } from '../types';
import { getPositionedEventsForDay, getPositionedEventsForWeek, areSameDay } from '../utils';
import { GRID } from '../constants';

/**
 * Hook for managing calendar events and event-related UI state
 */
export function useCalendarEvents() {
  const dispatch = useAppDispatch();

  // Get events from store
  const events = useAppSelector((state) => state.calendar.events);
  const visibleCalendarIds = useAppSelector(
    (state) => state.calendar.visibleCalendarIds
  );
  const filters = useAppSelector((state) => state.calendar.filters);
  const loading = useAppSelector((state) => state.calendar.loading);
  const errors = useAppSelector((state) => state.calendar.errors);

  // Get UI state
  const selectedEventId = useAppSelector(
    (state) => state.calendarUi.selectedEventId
  );
  const isEventModalOpen = useAppSelector(
    (state) => state.calendarUi.isEventModalOpen
  );
  const eventModalMode = useAppSelector(
    (state) => state.calendarUi.eventModalMode
  );
  const eventModalPrefill = useAppSelector(
    (state) => state.calendarUi.eventModalPrefill
  );

  /**
   * Get all visible events (filtered by visible calendars and filters)
   */
  const visibleEvents = useMemo(() => {
    const allEvents = Object.values(events);

    return allEvents.filter((event) => {
      // Filter by visible calendars
      if (!visibleCalendarIds.includes(event.calendarId)) {
        return false;
      }

      // Filter by category
      if (
        filters.categoryIds.length > 0 &&
        !filters.categoryIds.includes(event.categoryId)
      ) {
        return false;
      }

      // Filter by tags
      if (filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some((tag) =>
          event.tags.includes(tag)
        );
        if (!hasMatchingTag) {
          return false;
        }
      }

      // Filter by focus time only
      if (filters.focusTimeOnly && !event.isFocusTime) {
        return false;
      }

      // Filter by search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchesTitle = event.title.toLowerCase().includes(query);
        const matchesDescription = event.description
          .toLowerCase()
          .includes(query);
        if (!matchesTitle && !matchesDescription) {
          return false;
        }
      }

      return true;
    });
  }, [events, visibleCalendarIds, filters]);

  /**
   * Get events for a specific date
   */
  const getEventsForDate = useCallback(
    (date: Date | string) => {
      return visibleEvents.filter((event) => areSameDay(event.startTime, date));
    },
    [visibleEvents]
  );

  /**
   * Get positioned events for a specific date
   */
  const getPositionedEvents = useCallback(
    (date: Date | string): PositionedEvent[] => {
      return getPositionedEventsForDay(
        visibleEvents,
        date,
        GRID.START_HOUR,
        GRID.HOUR_HEIGHT
      );
    },
    [visibleEvents]
  );

  /**
   * Get positioned events for the current week
   */
  const getPositionedEventsWeek = useCallback(
    (weekDates: Date[]): Map<string, PositionedEvent[]> => {
      return getPositionedEventsForWeek(
        visibleEvents,
        weekDates,
        GRID.START_HOUR,
        GRID.HOUR_HEIGHT
      );
    },
    [visibleEvents]
  );

  /**
   * Get the currently selected event
   */
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events[selectedEventId] ?? null;
  }, [events, selectedEventId]);

  /**
   * Get all unique tags from visible events
   */
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    visibleEvents.forEach((event) => {
      event.tags.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [visibleEvents]);

  // Action handlers
  const handleSelectEvent = useCallback(
    (eventId: string | null) => {
      dispatch(selectEvent(eventId));
    },
    [dispatch]
  );

  const handleDeselectEvent = useCallback(() => {
    dispatch(deselectEvent());
  }, [dispatch]);

  const handleAddEvent = useCallback(
    (event: CalendarEvent) => {
      dispatch(addEvent(event));
    },
    [dispatch]
  );

  const handleUpdateEvent = useCallback(
    (event: CalendarEvent) => {
      dispatch(updateEvent(event));
    },
    [dispatch]
  );

  const handleRemoveEvent = useCallback(
    (eventId: string) => {
      dispatch(removeEvent(eventId));
      if (selectedEventId === eventId) {
        dispatch(deselectEvent());
      }
    },
    [dispatch, selectedEventId]
  );

  const handleOpenEventModal = useCallback(
    (mode: 'create' | 'edit', prefill?: EventModalPrefill) => {
      dispatch(openEventModal({ mode, prefill }));
    },
    [dispatch]
  );

  const handleCloseEventModal = useCallback(() => {
    dispatch(closeEventModal());
  }, [dispatch]);

  return {
    // Data
    events,
    visibleEvents,
    selectedEvent,
    selectedEventId,
    allTags,

    // Modal state
    isEventModalOpen,
    eventModalMode,
    eventModalPrefill,

    // Loading/error states
    loading,
    errors,

    // Computed data functions
    getEventsForDate,
    getPositionedEvents,
    getPositionedEventsWeek,

    // Actions
    selectEvent: handleSelectEvent,
    deselectEvent: handleDeselectEvent,
    addEvent: handleAddEvent,
    updateEvent: handleUpdateEvent,
    removeEvent: handleRemoveEvent,
    openEventModal: handleOpenEventModal,
    closeEventModal: handleCloseEventModal,
  };
}
