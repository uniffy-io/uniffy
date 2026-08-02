export { CalendarPage } from '@/features/calendar/pages/CalendarPage';

export {
  CalendarLayout,
  CalendarHeader,
  LeftSidebar,
  MainContent,
} from '@/features/calendar/components/layout';

export {
  WeekView,
  DayView,
  MonthView,
  EventBlock,
  TimeColumn,
  DayHeader,
  DayHeadersRow,
  GridLines,
  CurrentTimeIndicator,
} from '@/features/calendar/components/calendar';

export {
  SidebarSection,
  QuickAccess,
  MiniCalendar,
  CategoryList,
  TemplateList,
  TagCloud,
} from '@/features/calendar/components/sidebar';

export { QuickEventModal } from '@/features/calendar/components/modals/QuickEventModal';

export {
  calendarReducer,
  calendarUiReducer,
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
  toggleSectionCollapse,
} from '@/features/calendar/store';

export { calendarApi } from '@/features/calendar/api/calendarApi';

export {
  fetchEventsInRange,
  fetchEvent,
  createEvent as createEventAsync,
  updateEvent as updateEventAsync,
  deleteEvent as deleteEventAsync,
  fetchCategories,
  createCategory as createCategoryAsync,
  updateCategory as updateCategoryAsync,
  deleteCategory as deleteCategoryAsync,
  updateAttendeeStatus,
  addAttendees,
  removeAttendees,
} from '@/features/calendar/store/calendarThunks';

export { CalendarQuickView } from '@/features/calendar/components/quick-view/CalendarQuickView';

export {
  useCalendarNavigation,
  useCalendarEvents,
  useCurrentTime,
  useTodayEvents,
} from '@/features/calendar/hooks';

export {
  getWeekDates,
  getWeekColumns,
  getMonthColumns,
  formatDate,
  formatDateWithDay,
  formatTime,
  formatTimeRange,
  formatMonthYear,
  navigateDate,
  areSameDay,
  isDateToday,
  getDurationMinutes,
  formatDuration,
  getPositionedEventsForDay,
  getPositionedEventsForWeek,
} from '@/features/calendar/utils';

export {
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES,
  getCategoryColor,
  LAYOUT,
  GRID,
} from '@/features/calendar/constants';

export type {
  CalendarEvent,
  Category,
  Attendee,
  ViewMode,
  QuickAccessFilter,
  PositionedEvent,
  RecurrenceConfig,
  RecurrencePattern,
  DayOfWeek,
  LinkedResource,
  EventFilters,
} from '@/features/calendar/types';
