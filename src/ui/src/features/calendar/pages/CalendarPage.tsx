import { useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import { cn } from "@/shared/utils/cn";
import { AppHeader } from "@/components/layout/AppHeader";
import { CalendarLayout, LeftSidebar, MainContent } from "@/features/calendar/components/layout";
import { QuickEventModal } from "@/features/calendar/components/modals/QuickEventModal";
import { AddCategoryModal } from "@/features/calendar/components/modals/AddCategoryModal";
import { CreateTemplateModal } from "@/features/calendar/components/modals/CreateTemplateModal";
import {
  closeEventModal,
  closeAddCategoryModal,
  closeCreateTemplateModal,
  selectEvent,
  setCurrentDate,
  toggleSidebar,
} from "@/features/calendar/store";
import {
  fetchEventsInRange,
  fetchCategories,
  fetchEvent,
} from "@/features/calendar/store/calendarThunks";
import { displayParts, instantDayKey, parseISO } from "@/features/calendar/utils";
import { useContentAccessRefetch } from "@/features/notifications/hooks/useContentAccessRefetch";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

/** Fractional wall-clock hour of an instant on the display zone's clock. */
function displayHourOf(instant: string): number {
  const { hours, minutes } = displayParts(instant);
  return hours + minutes / 60;
}

export function CalendarPage() {
  const dispatch = useAppDispatch();
  const { eventId } = useParams<{ eventId: string }>();
  const currentDate = useAppSelector((state) => state.calendarUi.currentDate);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  // Guards against re-fetching when the same eventId stays in the URL.
  const handledEventIdRef = useRef<string | null>(null);
  const {
    isEventModalOpen,
    isAddCategoryModalOpen,
    isCreateTemplateModalOpen,
    selectedEventId,
    eventModalPrefill,
  } = useAppSelector((state) => state.calendarUi);

  const events = useAppSelector((state) => state.calendar.events);
  const selectedEvent = selectedEventId ? events[selectedEventId] : null;
  const pageTitle = selectedEvent?.title || "Calendar";
  useDocumentTitle(pageTitle);

  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutHandler("app.toggleSidebar", handleToggleSidebar);

  useEffect(() => {
    if (!currentOrganizationId) return;

    dispatch(fetchCategories());
  }, [dispatch, currentOrganizationId]);

  // /calendar/:eventId opens an event from a URN mention.
  useEffect(() => {
    if (!currentOrganizationId || !eventId) return;
    if (handledEventIdRef.current === eventId) return;

    handledEventIdRef.current = eventId;

    dispatch(selectEvent(eventId));

    dispatch(fetchEvent(eventId))
      .unwrap()
      .then((event) => {
        // Snap the calendar to the event's date so the selection is visible.
        const eventDate = instantDayKey(event.startTime);
        if (eventDate !== currentDate) {
          dispatch(setCurrentDate(eventDate));
        }
      })
      .catch(() => {
        // The detail modal surfaces fetch errors.
      });
  }, [dispatch, eventId, currentOrganizationId, currentDate]);

  const refetchVisibleEvents = useCallback(() => {
    if (!currentOrganizationId) return;

    const date = new Date(currentDate);
    const startDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const endDate = new Date(date.getFullYear(), date.getMonth() + 2, 0);

    dispatch(
      fetchEventsInRange({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }),
    );
  }, [dispatch, currentDate, currentOrganizationId]);

  useEffect(() => {
    refetchVisibleEvents();
  }, [refetchVisibleEvents]);

  // An event shared with this user or flipped to OPEN_TO_ORG won't be in the
  // current range fetch; refetch the visible window when access changes.
  useContentAccessRefetch(ContentType.CALENDAR_EVENT, refetchVisibleEvents);

  return (
    <>
      <AppHeader />
      <div
        className={cn(
          "bg-background transition-[height] duration-300 ease-in-out",
          isZenMode ? "h-dvh delay-150" : "h-[calc(100dvh-3rem)] delay-0",
        )}
      >
        <CalendarLayout sidebar={<LeftSidebar />} mainContent={<MainContent />} />
      </div>

      <QuickEventModal
        isOpen={isEventModalOpen}
        onClose={() => dispatch(closeEventModal())}
        initialDate={
          eventModalPrefill?.startTime
            ? parseISO(eventModalPrefill.date || instantDayKey(eventModalPrefill.startTime))
            : undefined
        }
        initialStartHour={
          eventModalPrefill?.startTime ? displayHourOf(eventModalPrefill.startTime) : undefined
        }
        initialEndHour={
          eventModalPrefill?.endTime ? displayHourOf(eventModalPrefill.endTime) : undefined
        }
      />

      <AddCategoryModal
        isOpen={isAddCategoryModalOpen}
        onClose={() => dispatch(closeAddCategoryModal())}
      />

      <CreateTemplateModal
        isOpen={isCreateTemplateModalOpen}
        onClose={() => dispatch(closeCreateTemplateModal())}
      />
    </>
  );
}
