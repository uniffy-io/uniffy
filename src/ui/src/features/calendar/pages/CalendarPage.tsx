/**
 * CalendarPage - Main calendar page component
 *
 * This is the entry point for the Calendar feature.
 * It renders the three-panel layout with sidebar, calendar grid, and detail panel.
 */

import { useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { AppHeader } from '@/components/layout/AppHeader';
import { CalendarLayout, LeftSidebar, MainContent, DetailPanel } from '../components/layout';
import { QuickEventModal } from '../components/modals/QuickEventModal';
import { AddCalendarModal } from '../components/modals/AddCalendarModal';
import { AddCategoryModal } from '../components/modals/AddCategoryModal';
import { CreateTemplateModal } from '../components/modals/CreateTemplateModal';
import { closeEventModal, closeAddCalendarModal, closeAddCategoryModal, closeCreateTemplateModal } from '../store';
import { fetchEventsInRange, fetchCalendars, fetchCategories } from '../store/calendarThunks';

export function CalendarPage() {
  useDocumentTitle('Calendar');
  const dispatch = useAppDispatch();
  const currentDate = useAppSelector((state) => state.calendarUi.currentDate);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const {
    isEventModalOpen,
    isAddCalendarModalOpen,
    isAddCategoryModalOpen,
    isCreateTemplateModalOpen,
  } = useAppSelector((state) => state.calendarUi);

  // Fetch calendars and categories when the page loads or organization changes
  useEffect(() => {
    if (!currentOrganizationId) return;

    dispatch(fetchCalendars());
    dispatch(fetchCategories());
  }, [dispatch, currentOrganizationId]);

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
      <div className="h-[calc(100vh-4rem)] bg-background">
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
      />

      {/* Add Calendar Modal */}
      <AddCalendarModal
        isOpen={isAddCalendarModalOpen}
        onClose={() => dispatch(closeAddCalendarModal())}
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
    </>
  );
}

export default CalendarPage;
