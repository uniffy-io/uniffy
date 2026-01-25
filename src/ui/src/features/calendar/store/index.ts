/**
 * Calendar store exports
 */

// Reducers
export { default as calendarReducer } from './calendarSlice';
export { default as calendarUiReducer } from './calendarUiSlice';

// Thunks (API calls)
export {
  fetchEventsInRange,
  fetchEvent,
  createEvent,
  updateEvent as updateEventThunk,
  deleteEvent,
  fetchCalendars,
  createCalendar,
  updateCalendar as updateCalendarThunk,
  deleteCalendar,
  fetchCategories,
  createCategory,
  updateCategory as updateCategoryThunk,
  deleteCategory,
  updateAttendeeStatus,
  addAttendees,
  removeAttendees,
} from './calendarThunks';

// Calendar slice actions
export {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  toggleEventFavorite,
  toggleCalendarVisibility,
  setVisibleCalendars,
  addCalendar,
  updateCalendar,
  removeCalendar,
  addCategory,
  updateCategory,
  removeCategory,
  setFilters,
  clearFilters,
  setSearchQuery,
  toggleCategoryFilter,
  toggleTagFilter,
  setEventsLoading,
  setCreatingLoading,
  setUpdatingLoading,
  setDeletingLoading,
  setEventsError,
  setCreatingError,
  clearErrors,
  setPagination,
  resetCalendarState,
} from './calendarSlice';

// Calendar UI slice actions
export {
  setViewMode,
  setCurrentDate,
  goToToday,
  setQuickAccessFilter,
  selectEvent,
  deselectEvent,
  toggleDetailPanel,
  openDetailPanel,
  closeDetailPanel,
  setDetailPanelWidth,
  setActiveDetailTab,
  openEventModal,
  closeEventModal,
  toggleSidebar,
  setSidebarCollapsed,
  setSidebarWidth,
  toggleSectionCollapse,
  setSectionCollapsed,
  startDrag,
  setDropTarget,
  endDrag,
  setDisplayTimezone,
  toggleTravelingMode,
  setTravelingMode,
  openQuickCapture,
  closeQuickCapture,
  openTimezoneModal,
  closeTimezoneModal,
  openAddCalendarModal,
  closeAddCalendarModal,
  openAddCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  closeCreateTemplateModal,
  setMobileView,
  setActiveMobilePanel,
  resetCalendarUiState,
} from './calendarUiSlice';
