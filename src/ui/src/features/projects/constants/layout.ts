/**
 * Layout constants for the Projects feature
 */

export const LAYOUT = {
  /** Left sidebar default width in pixels */
  SIDEBAR_WIDTH: 280,
  /** Minimum sidebar width in pixels */
  SIDEBAR_MIN_WIDTH: 200,
  /** Maximum sidebar width in pixels */
  SIDEBAR_MAX_WIDTH: 400,
  /** Right detail panel default width in pixels */
  DETAIL_PANEL_WIDTH: 340,
  /** Minimum detail panel width in pixels */
  DETAIL_PANEL_MIN_WIDTH: 300,
  /** Maximum detail panel width in pixels */
  DETAIL_PANEL_MAX_WIDTH: 600,
  /** Top header height */
  HEADER_HEIGHT: 56,
  /** View tabs section height */
  VIEW_TABS_HEIGHT: 48,
  /** Filter bar height */
  FILTER_BAR_HEIGHT: 44,
  /** Table header row height */
  TABLE_HEADER_HEIGHT: 40,
  /** Table row height */
  TABLE_ROW_HEIGHT: 44,
  /** Board column width */
  BOARD_COLUMN_WIDTH: 340,
  /** Board card minimum height */
  BOARD_CARD_MIN_HEIGHT: 100,
  /** Roadmap task list width */
  ROADMAP_TASK_LIST_WIDTH: 340,
  /** Roadmap row height */
  ROADMAP_ROW_HEIGHT: 52,
  /** Gantt bar height */
  GANTT_BAR_HEIGHT: 24,
} as const;

/**
 * Table column defaults
 */
export const TABLE_COLUMNS = {
  /** Checkbox column width */
  CHECKBOX_WIDTH: 40,
  /** Minimum column width */
  MIN_COLUMN_WIDTH: 80,
  /** Default column widths by field type */
  DEFAULT_WIDTHS: {
    text: 200,
    number: 100,
    single_select: 120,
    multi_select: 150,
    date: 120,
    person: 150,
    reference: 200,
  },
} as const;

/**
 * Animation constants
 */
export const ANIMATION = {
  /** Panel resize transition duration (ms) */
  PANEL_TRANSITION: 200,
  /** Drag and drop transition duration (ms) */
  DRAG_TRANSITION: 150,
  /** Hover delay for previews (ms) */
  HOVER_DELAY: 400,
} as const;

/**
 * Z-index values
 */
export const Z_INDEX = {
  /** Table header (sticky) */
  TABLE_HEADER: 10,
  /** Drag overlay */
  DRAG_OVERLAY: 100,
  /** Dropdown menus */
  DROPDOWN: 50,
  /** Modal backdrops */
  MODAL_BACKDROP: 200,
  /** Modals */
  MODAL: 201,
} as const;
