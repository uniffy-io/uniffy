export const LAYOUT = {
  SIDEBAR_WIDTH: 280,
  SIDEBAR_MIN_WIDTH: 200,
  SIDEBAR_MAX_WIDTH: 400,
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

export const SIDEBAR_SECTIONS = {
  quick_access: true,
  mini_calendar: true,
  calendars: true,
  organization: true,
  categories: true,
  templates: true,
  tags: true,
} as const;
