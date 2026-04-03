/**
 * Calendar store exports
 */

// Reducers
export { calendarReducer } from '@/features/calendar/store/calendarSlice';
export { calendarUiReducer } from '@/features/calendar/store/calendarUiSlice';

// Thunks (API calls)
export {
  fetchEventsInRange,
  fetchEvent,
  createEvent,
  updateEvent as updateEventThunk,
  deleteEvent,
  fetchCategories,
  createCategory,
  updateCategory as updateCategoryThunk,
  deleteCategory,
  updateAttendeeStatus,
  addAttendees,
  removeAttendees,
} from '@/features/calendar/store/calendarThunks';

// Calendar slice actions
export {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
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
} from '@/features/calendar/store/calendarSlice';

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
  setDetailViewMode,
  setDetailPanelWidth,
  setActiveDetailTab,
  openEventModal,
  closeEventModal,
  openEditEvent,
  closeEditEvent,
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
  openAddCategoryModal,
  openEditCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  openEditTemplateModal,
  closeCreateTemplateModal,
  setMobileView,
  setActiveMobilePanel,
  setEventScope,
  resetCalendarUiState,
} from '@/features/calendar/store/calendarUiSlice';
