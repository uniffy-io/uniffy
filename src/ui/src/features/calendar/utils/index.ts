/**
 * Calendar feature utility exports
 */

// Date utilities
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
  getDayStart,
  getDayEnd,
  getDurationMinutes,
  formatDuration,
  setTime,
  parseTimeString,
  toDateString,
  toTimeString,
  getCurrentTimeInfo,
  getTimePosition,
  getTimeFromPosition,
  roundTimeToInterval,
  isMultiDayEvent,
  getDateRangeLabel,
  getTimezoneOffset,
  convertTimezone,
  // Re-exported from date-fns
  parseISO,
  format,
  isToday,
  isBefore,
  isAfter,
  addDays,
  addWeeks,
  addMonths,
  getHours,
  getMinutes,
  getDate,
  getMonth,
  getYear,
} from './dateUtils';

// Event positioning
export {
  calculateEventPosition,
  eventsOverlap,
  groupOverlappingEvents,
  assignEventColumns,
  getPositionedEventsForDay,
  getPositionedEventsForWeek,
  positionAllDayEvents,
  getAllDayRowHeight,
} from './eventPositioning';
