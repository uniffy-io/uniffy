/**
 * CalendarPage - Main calendar page component
 *
 * This is the entry point for the Calendar feature.
 * It renders the three-panel layout with sidebar, calendar grid, and detail panel.
 *
 * Supports two routes:
 * - /calendar - Shows the calendar view
 * - /calendar/:eventId - Shows the calendar with a specific event selected and detail panel open
 */

import { useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { useShortcutHandler } from '@/features/settings';
import { cn } from '@/shared/utils/cn';
import { AppHeader } from '@/components/layout/AppHeader';
import { CalendarLayout, LeftSidebar, MainContent, DetailPanel } from '@/features/calendar/components/layout';
import { QuickEventModal } from '@/features/calendar/components/modals/QuickEventModal';
import { AddCategoryModal } from '@/features/calendar/components/modals/AddCategoryModal';
import { CreateTemplateModal } from '@/features/calendar/components/modals/CreateTemplateModal';
import { EventEditor } from '@/features/calendar/components/modals/EventEditor';
import { closeEventModal, closeAddCategoryModal, closeCreateTemplateModal, closeEditEvent, selectEvent, setCurrentDate, toggleSidebar } from '@/features/calendar/store';
import { fetchEventsInRange, fetchCategories, fetchEvent } from '@/features/calendar/store/calendarThunks';
import { toDateString } from '@/features/calendar/utils';

export function CalendarPage() {
  const dispatch = useAppDispatch();
  const { eventId } = useParams<{ eventId: string }>();
  const currentDate = useAppSelector((state) => state.calendarUi.currentDate);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  // Track if we've handled the URL eventId to prevent duplicate fetches
  const handledEventIdRef = useRef<string | null>(null);
  const {
    isEventModalOpen,
    isAddCategoryModalOpen,
    isCreateTemplateModalOpen,
    isEditingEventOpen,
    selectedEventId,
    eventModalPrefill,
  } = useAppSelector((state) => state.calendarUi);

  // Get selected event for dynamic document title
  const events = useAppSelector((state) => state.calendar.events);
  const selectedEvent = selectedEventId ? events[selectedEventId] : null;
  const pageTitle = selectedEvent?.title || 'Calendar';
  useDocumentTitle(pageTitle);

  // Keyboard shortcut for toggling sidebar (global shortcut)
  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

  // Fetch categories when the page loads or organization changes
  useEffect(() => {
    if (!currentOrganizationId) return;

    dispatch(fetchCategories());
  }, [dispatch, currentOrganizationId]);

  // Handle eventId from URL (e.g., /calendar/:eventId from URN mentions)
  useEffect(() => {
    if (!currentOrganizationId || !eventId) return;
    if (handledEventIdRef.current === eventId) return;

    handledEventIdRef.current = eventId;

    // Select the event to open the detail panel
    dispatch(selectEvent(eventId));

    // Fetch the full event data
    dispatch(fetchEvent(eventId))
      .unwrap()
      .then((event) => {
        // Navigate the calendar to the event's date so it's visible
        const eventDate = toDateString(new Date(event.startTime));
        if (eventDate !== currentDate) {
          dispatch(setCurrentDate(eventDate));
        }
      })
      .catch(() => {
        // Event not found or error - the detail panel will handle showing an error
      });
  }, [dispatch, eventId, currentOrganizationId, currentDate]);

  // Fetch events when the current date changes or on initial load
  useEffect(() => {
    if (!currentOrganizationId) return;

    const date = new Date(currentDate);
    const startDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 2, 0);

    dispatch(fetchEventsInRange({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    }));
  }, [dispatch, currentDate, currentOrganizationId]);

  return (
    <>
      <AppHeader />
      <div className={cn(
        "bg-background transition-[height] duration-300 ease-in-out",
        isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0"
      )}>
        <CalendarLayout
          sidebar={<LeftSidebar />}
          mainContent={<MainContent />}
          detailPanel={<DetailPanel />}
        />
      </div>

      {/* Quick Event Creation Modal */}
      <QuickEventModal
        isOpen={isEventModalOpen}
        onClose={() => dispatch(closeEventModal())}
        initialDate={eventModalPrefill?.startTime ? new Date(eventModalPrefill.startTime) : undefined}
        initialStartHour={eventModalPrefill?.startTime
          ? new Date(eventModalPrefill.startTime).getHours() + new Date(eventModalPrefill.startTime).getMinutes() / 60
          : undefined}
        initialEndHour={eventModalPrefill?.endTime
          ? new Date(eventModalPrefill.endTime).getHours() + new Date(eventModalPrefill.endTime).getMinutes() / 60
          : undefined}
      />

      {/* Add Category Modal */}
      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => dispatch(closeAddCategoryModal())}
      />

      {/* Create Template Modal */}
      <CreateTemplateModal
        isOpen={isCreateTemplateModalOpen}
        onClose={() => dispatch(closeCreateTemplateModal())}
      />

      {/* Event Editor Modal (double-click or edit button) */}
      {isEditingEventOpen && selectedEvent && (
        <EventEditor
          event={selectedEvent}
          isOpen={isEditingEventOpen}
          onClose={() => dispatch(closeEditEvent())}
        />
      )}
    </>
  );
}
