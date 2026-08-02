export { calendarReducer } from '@/features/calendar/store/calendarSlice';
export { calendarUiReducer } from '@/features/calendar/store/calendarUiSlice';

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
  fetchEventActivities,
} from '@/features/calendar/store/calendarThunks';

export {
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  updateCategory,
  setFilters,
  clearFilters,
  setSearchQuery,
  toggleCategoryFilter,
  toggleTagFilter,
  clearErrors,
  setPagination,
  resetCalendarState,
} from '@/features/calendar/store/calendarSlice';

export {
  setViewMode,
  setCurrentDate,
  goToToday,
  setQuickAccessFilter,
  selectEvent,
  deselectEvent,
  openEventModal,
  closeEventModal,
  toggleSidebar,
  setSidebarCollapsed,
  setSidebarWidth,
  toggleSectionCollapse,
  startDrag,
  setDropTarget,
  endDrag,
  openAddCategoryModal,
  openEditCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  openEditTemplateModal,
  closeCreateTemplateModal,
  resetCalendarUiState,
} from '@/features/calendar/store/calendarUiSlice';
