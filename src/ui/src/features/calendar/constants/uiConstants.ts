export const LAYOUT = {
  SIDEBAR_WIDTH: 280,
  SIDEBAR_MIN_WIDTH: 200,
  SIDEBAR_MAX_WIDTH: 400,
  DETAIL_PANEL_WIDTH: 300,
  DETAIL_PANEL_MIN_WIDTH: 280,
  DETAIL_PANEL_MAX_WIDTH: 400,
  HEADER_HEIGHT: 64,
  CALENDAR_HEADER_HEIGHT: 60,
  DAY_HEADERS_HEIGHT: 50,
  TIME_COLUMN_WIDTH: 60,
} as const;

export const GRID = {
  HOUR_HEIGHT: 60,
  HALF_HOUR_HEIGHT: 30,
  QUARTER_HOUR_HEIGHT: 15,
  MIN_EVENT_HEIGHT: 24,
  EVENT_PADDING: 4,
  EVENT_BORDER_RADIUS: 6,
  EVENT_COLOR_BAR_WIDTH: 4,
  EVENT_GAP: 2,
  DAYS_IN_WEEK: 7,
  VISIBLE_HOURS: 24,
  START_HOUR: 0,
  END_HOUR: 23,
} as const;

export const MINI_CALENDAR = {
  CELL_SIZE: 28,
  GRID_WIDTH: 220,
  GRID_HEIGHT: 170,
  HEADER_HEIGHT: 24,
  TODAY_RADIUS: 12,
} as const;

export const ANIMATION = {
  FAST: 150,
  NORMAL: 200,
  SLOW: 300,
  DRAG: 100,
} as const;

export const Z_INDEX = {
  BASE: 0,
  EVENTS: 10,
  SELECTED_EVENT: 20,
  DRAGGED_EVENT: 30,
  TIME_INDICATOR: 40,
  DROPDOWN: 50,
  MODAL: 100,
  TOAST: 200,
} as const;

export const BREAKPOINTS = {
  MOBILE: 640,
  TABLET: 768,
  DESKTOP: 1024,
  LARGE: 1280,
  XL: 1536,
} as const;

export const TOUCH = {
  MIN_TARGET_SIZE: 44,
  LONG_PRESS_DURATION: 500,
  SWIPE_THRESHOLD: 50,
} as const;

export const DELAYS = {
  AUTOSAVE: 2000,
  SEARCH_DEBOUNCE: 300,
  RESIZE_DEBOUNCE: 100,
  TOOLTIP_DELAY: 500,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 500,
} as const;

export const AVATAR_STACK = {
  MAX_VISIBLE: 3,
  EVENT_SIZE: 20,
  DETAIL_SIZE: 28,
  OVERLAP: 6,
} as const;

export const SIDEBAR_SECTIONS = {
  quick_access: true,
  mini_calendar: true,
  calendars: true,
  organization: true,
  categories: true,
  templates: true,
  tags: true,
} as const;
