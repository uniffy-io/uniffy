/**
 * UI constants for the Calendar feature
 * Defines sizing, spacing, and layout values
 */

/**
 * Layout dimensions
 */
export const LAYOUT = {
  /** Left sidebar width in pixels */
  SIDEBAR_WIDTH: 280,
  /** Minimum sidebar width */
  SIDEBAR_MIN_WIDTH: 200,
  /** Maximum sidebar width */
  SIDEBAR_MAX_WIDTH: 400,
  /** Right detail panel width in pixels */
  DETAIL_PANEL_WIDTH: 300,
  /** Minimum detail panel width */
  DETAIL_PANEL_MIN_WIDTH: 280,
  /** Maximum detail panel width */
  DETAIL_PANEL_MAX_WIDTH: 400,
  /** Top header height */
  HEADER_HEIGHT: 64,
  /** Calendar sub-header height (month nav + view toggle) */
  CALENDAR_HEADER_HEIGHT: 60,
  /** Week view day headers height */
  DAY_HEADERS_HEIGHT: 50,
  /** Time column width */
  TIME_COLUMN_WIDTH: 60,
} as const;

/**
 * Calendar grid dimensions
 */
export const GRID = {
  /** Height per hour in pixels */
  HOUR_HEIGHT: 60,
  /** Height per 30-minute slot */
  HALF_HOUR_HEIGHT: 30,
  /** Height per 15-minute slot */
  QUARTER_HOUR_HEIGHT: 15,
  /** Minimum event height in pixels */
  MIN_EVENT_HEIGHT: 24,
  /** Event horizontal padding */
  EVENT_PADDING: 4,
  /** Event border radius */
  EVENT_BORDER_RADIUS: 6,
  /** Event left color bar width */
  EVENT_COLOR_BAR_WIDTH: 4,
  /** Gap between overlapping events */
  EVENT_GAP: 2,
  /** Number of days in week view */
  DAYS_IN_WEEK: 7,
  /** Hours to display (12 AM to 11 PM = 24 hours) */
  VISIBLE_HOURS: 24,
  /** First visible hour (12 AM) */
  START_HOUR: 0,
  /** Last visible hour (11 PM) */
  END_HOUR: 23,
} as const;

/**
 * Mini calendar dimensions
 */
export const MINI_CALENDAR = {
  /** Cell width/height */
  CELL_SIZE: 28,
  /** Total grid width */
  GRID_WIDTH: 220,
  /** Total grid height (including header) */
  GRID_HEIGHT: 170,
  /** Day header height */
  HEADER_HEIGHT: 24,
  /** Current day highlight radius */
  TODAY_RADIUS: 12,
} as const;

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATION = {
  /** Fast animations (hover, focus) */
  FAST: 150,
  /** Normal animations (panel slide) */
  NORMAL: 200,
  /** Slow animations (page transitions) */
  SLOW: 300,
  /** Drag animation */
  DRAG: 100,
} as const;

/**
 * Z-index layers
 */
export const Z_INDEX = {
  /** Base layer (calendar grid) */
  BASE: 0,
  /** Event blocks */
  EVENTS: 10,
  /** Selected event */
  SELECTED_EVENT: 20,
  /** Dragged event */
  DRAGGED_EVENT: 30,
  /** Current time indicator */
  TIME_INDICATOR: 40,
  /** Dropdown menus */
  DROPDOWN: 50,
  /** Modals */
  MODAL: 100,
  /** Toast notifications */
  TOAST: 200,
} as const;

/**
 * Breakpoints for responsive design
 */
export const BREAKPOINTS = {
  /** Mobile: < 640px */
  MOBILE: 640,
  /** Tablet: < 768px */
  TABLET: 768,
  /** Desktop: < 1024px */
  DESKTOP: 1024,
  /** Large desktop: < 1280px */
  LARGE: 1280,
  /** Extra large: >= 1280px */
  XL: 1536,
} as const;

/**
 * Touch interaction constants
 */
export const TOUCH = {
  /** Minimum touch target size (WCAG) */
  MIN_TARGET_SIZE: 44,
  /** Long press duration for context menu */
  LONG_PRESS_DURATION: 500,
  /** Swipe threshold in pixels */
  SWIPE_THRESHOLD: 50,
} as const;

/**
 * Autosave and debounce delays
 */
export const DELAYS = {
  /** Autosave delay */
  AUTOSAVE: 2000,
  /** Search input debounce */
  SEARCH_DEBOUNCE: 300,
  /** Resize debounce */
  RESIZE_DEBOUNCE: 100,
  /** Tooltip delay */
  TOOLTIP_DELAY: 500,
} as const;

/**
 * Pagination defaults
 */
export const PAGINATION = {
  /** Default page size */
  DEFAULT_PAGE_SIZE: 50,
  /** Max events to fetch at once */
  MAX_PAGE_SIZE: 500,
} as const;

/**
 * Avatar stack defaults
 */
export const AVATAR_STACK = {
  /** Maximum visible avatars before "+N" */
  MAX_VISIBLE: 3,
  /** Avatar size in event blocks */
  EVENT_SIZE: 20,
  /** Avatar size in detail panel */
  DETAIL_SIZE: 28,
  /** Overlap amount in pixels */
  OVERLAP: 6,
} as const;

/**
 * Sidebar section default states (expanded/collapsed)
 */
export const SIDEBAR_SECTIONS = {
  quick_access: true,
  mini_calendar: true,
  calendars: true,
  organization: true,
  categories: true,
  templates: true,
  tags: true,
} as const;
