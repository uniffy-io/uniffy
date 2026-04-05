/**
 * Calendar Feature
 *
 * A full-featured calendar module for UNIFFY with:
 * - Day/Week/Month views
 * - Event management (create, edit, delete)
 * - Categories and color coding
 * - Templates for quick event creation
 * - Focus time blocks
 * - Attendee management
 * - Resource linking (notes, files, chats)
 * - Organization-wide event visibility
 */

// Main page
export { CalendarPage } from '@/features/calendar/pages/CalendarPage';

// Layout components
export {
  CalendarLayout,
  CalendarHeader,
  LeftSidebar,
  MainContent,
  DetailPanel,
} from '@/features/calendar/components/layout';

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
} from '@/features/calendar/components/calendar';

// Sidebar components
export {
  SidebarSection,
  QuickAccess,
  MiniCalendar,
  CategoryList,
  TemplateList,
  TagCloud,
  EventScopeFilter,
} from '@/features/calendar/components/sidebar';

// Modals
export { QuickEventModal } from '@/features/calendar/components/modals/QuickEventModal';
export { EventEditor } from '@/features/calendar/components/modals/EventEditor';

// Redux store
export {
  calendarReducer,
  calendarUiReducer,
  // Event actions
  setEvents,
  addEvent,
  updateEvent,
  removeEvent,
  // Category actions
  addCategory,
  updateCategory,
  removeCategory,
  // Filter actions
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
  setEventScope,
} from '@/features/calendar/store';

// API
export { calendarApi } from '@/features/calendar/api/calendarApi';

// Thunks
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

// Quick view (header widget)
export { CalendarQuickView } from '@/features/calendar/components/quick-view/CalendarQuickView';

// Hooks
export {
  useCalendarNavigation,
  useCalendarEvents,
  useCurrentTime,
  useIsToday,
  useTodayEvents,
} from '@/features/calendar/hooks';

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
} from '@/features/calendar/utils';

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
} from '@/features/calendar/constants';

// Types
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
  EventFormData,
  CalendarUIState,
  EventFilters,
} from '@/features/calendar/types';
