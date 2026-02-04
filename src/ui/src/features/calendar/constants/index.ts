/**
 * Calendar feature constants exports
 */

// Category colors
export {
  CATEGORY_COLORS,
  DEFAULT_CATEGORIES,
  getCategoryColor,
  getCategoryBackgroundColor,
  hexToRgba,
  CALENDAR_COLORS,
  FOCUS_TIME_COLOR,
  CURRENT_TIME_COLOR,
} from '@/features/calendar/constants/categoryColors';

// UI constants
export {
  LAYOUT,
  GRID,
  MINI_CALENDAR,
  ANIMATION,
  Z_INDEX,
  BREAKPOINTS,
  TOUCH,
  DELAYS,
  PAGINATION,
  AVATAR_STACK,
  SIDEBAR_SECTIONS,
} from '@/features/calendar/constants/uiConstants';

// Time ranges
export {
  WORKING_HOURS,
  DEFAULT_DURATIONS,
  TIME_INTERVALS,
  TIME_FORMATS,
  COMMON_TIMEZONES,
  generateTimeSlots,
  getBusinessHoursSlots,
  DURATION_OPTIONS,
  REMINDER_OPTIONS,
  WEEK_START_OPTIONS,
  DISPLAY_HOURS,
} from '@/features/calendar/constants/timeRanges';

// Templates
export {
  DEFAULT_TEMPLATES,
  getTemplateById,
  TEMPLATE_QUICK_ACTIONS,
} from '@/features/calendar/constants/defaultTemplates';
export type { EventTemplate } from '@/features/calendar/constants/defaultTemplates';
