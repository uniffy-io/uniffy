/**
 * Calendar Feature
 *
 * A full-featured calendar module for UWOS with:
 * - Day/Week/Month views
 * - Event management (create, edit, delete)
 * - Multiple calendars support
 * - Categories and color coding
 * - Templates for quick event creation
 * - Focus time blocks
 * - Attendee management
 * - Resource linking (notes, files, chats)
 */

// Main page
export { CalendarPage } from './pages/CalendarPage';

// Layout components
export {
  CalendarLayout,
  CalendarHeader,
  LeftSidebar,
  MainContent,
  DetailPanel,
} from './components/layout';

// Calendar grid components
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
} from './components/calendar';

// Sidebar components
export {
  SidebarSection,
  QuickAccess,
  MiniCalendar,
  CalendarList,
  CategoryList,
  TemplateList,
  TagCloud,
} from './components/sidebar';

// Modals
export { QuickEventModal } from './components/modals/QuickEventModal';
export { EventEditor } from './components/modals/EventEditor';

// Redux store
export {
  calendarReducer,
  calendarUiReducer,
  // Calendar actions
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
  // UI actions
  setViewMode,
  setCurrentDate,
  goToToday,
  setQuickAccessFilter,
  selectEvent,
  deselectEvent,
  toggleDetailPanel,
  openDetailPanel,
  closeDetailPanel,
  openEventModal,
  closeEventModal,
  toggleSidebar,
  setSidebarCollapsed,
  toggleSectionCollapse,
  openQuickCapture,
  closeQuickCapture,
  openTimezoneModal,
  closeTimezoneModal,
} from './store';

// API
export { calendarApi } from './api/calendarApi';

// Thunks
export {
  fetchEventsInRange,
  fetchEvent,
  createEvent as createEventAsync,
  updateEvent as updateEventAsync,
  deleteEvent as deleteEventAsync,
  fetchCalendars,
  createCalendar as createCalendarAsync,
  updateCalendar as updateCalendarAsync,
  deleteCalendar as deleteCalendarAsync,
  fetchCategories,
  createCategory as createCategoryAsync,
  updateCategory as updateCategoryAsync,
  deleteCategory as deleteCategoryAsync,
  updateAttendeeStatus,
  addAttendees,
  removeAttendees,
} from './store/calendarThunks';

// Hooks
export {
  useCalendarNavigation,
  useCalendarEvents,
  useCurrentTime,
  useIsToday,
} from './hooks';

// Utilities
export {
  getWeekDates,
  getWeekColumns,
  getMonthDates,
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
} from './utils';

// Constants
export {
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES,
  getCategoryColor,
  getCategoryBackgroundColor,
  LAYOUT,
  GRID,
  ANIMATION,
  WORKING_HOURS,
  DEFAULT_DURATIONS,
  DEFAULT_TEMPLATES,
} from './constants';

// Types
export type {
  CalendarEvent,
  Calendar,
  Category,
  Attendee,
  ViewMode,
  QuickAccessFilter,
  PositionedEvent,
  RecurrenceConfig,
  RecurrencePattern,
  DayOfWeek,
  LinkedResource,
  EventFormData,
  CalendarUIState,
  EventFilters,
} from './types';
