/**
 * UI state type definitions for the Calendar feature
 */

import type { ViewMode, QuickAccessFilter } from './calendar';

/**
 * Calendar UI state
 */
export interface CalendarUIState {
  /** Current view mode (day, week, month) */
  viewMode: ViewMode;
  /** Currently displayed date (center of view) */
  currentDate: string;
  /** Active quick access filter */
  quickAccessFilter: QuickAccessFilter | null;
  /** Whether the right detail panel is open */
  isDetailPanelOpen: boolean;
  /** ID of the currently selected event */
  selectedEventId: string | null;
  /** Whether the event creation/edit modal is open */
  isEventModalOpen: boolean;
  /** Mode for the event modal */
  eventModalMode: 'create' | 'edit';
  /** Pre-filled data for event creation */
  eventModalPrefill?: EventModalPrefill;
  /** Whether the sidebar is collapsed (mobile) */
  isSidebarCollapsed: boolean;
  /** Sidebar width in pixels */
  sidebarWidth: number;
  /** Detail panel width in pixels */
  detailPanelWidth: number;
  /** Collapsed sidebar sections */
  collapsedSections: string[];
  /** Currently dragged event ID (for drag-and-drop) */
  draggedEventId: string | null;
  /** Drop target slot (date + time) */
  dropTarget: DropTarget | null;
  /** Loading states */
  loading: CalendarLoadingState;
  /** Error messages */
  errors: CalendarErrorState;
}

/**
 * Pre-filled data when opening event modal
 */
export interface EventModalPrefill {
  /** Pre-selected date */
  date?: string;
  /** Pre-selected start time */
  startTime?: string;
  /** Pre-selected end time */
  endTime?: string;
  /** Pre-selected calendar ID */
  calendarId?: string;
  /** Pre-selected category ID */
  categoryId?: string;
  /** Event ID to edit (for edit mode) */
  eventId?: string;
  /** Context for quick capture (chat, note, etc.) */
  context?: 'calendar' | 'chat' | 'note';
  /** Suggested attendees from context */
  suggestedAttendees?: string[];
  /** Suggested resources from context */
  suggestedResources?: string[];
}

/**
 * Drop target for drag-and-drop
 */
export interface DropTarget {
  /** Target date (ISO string) */
  date: string;
  /** Target hour (0-23) */
  hour: number;
  /** Target minutes (0, 15, 30, 45) */
  minutes: number;
}

/**
 * Loading state for various operations
 */
export interface CalendarLoadingState {
  /** Loading events list */
  events: boolean;
  /** Loading specific event */
  eventDetail: boolean;
  /** Creating event */
  creating: boolean;
  /** Updating event */
  updating: boolean;
  /** Deleting event */
  deleting: boolean;
  /** Loading calendars */
  calendars: boolean;
  /** Loading categories */
  categories: boolean;
}

/**
 * Error state for various operations
 */
export interface CalendarErrorState {
  events: string | null;
  eventDetail: string | null;
  creating: string | null;
  updating: string | null;
  deleting: string | null;
  calendars: string | null;
  categories: string | null;
}

/**
 * Sidebar section IDs for collapse state
 */
export type SidebarSectionId =
  | 'quick_access'
  | 'mini_calendar'
  | 'calendars'
  | 'categories'
  | 'templates'
  | 'tags';

/**
 * Detail panel tab options
 */
export type DetailPanelTab = 'outline' | 'links' | 'properties';

/**
 * Event action menu options
 */
export type EventAction =
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'bookmark'
  | 'unbookmark'
  | 'add_attendee'
  | 'link_resource'
  | 'share';

/**
 * Keyboard shortcut action
 */
export type KeyboardAction =
  | 'quick_capture'      // Cmd+Shift+E
  | 'navigate_previous'  // Left arrow
  | 'navigate_next'      // Right arrow
  | 'navigate_up'        // Up arrow (previous week)
  | 'navigate_down'      // Down arrow (next week)
  | 'go_today'           // T key
  | 'toggle_view'        // V key
  | 'new_event'          // N key
  | 'close_modal'        // Escape
  | 'save'               // Cmd+S
  | 'delete';            // Delete/Backspace

/**
 * Toast notification type
 */
export interface CalendarToast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

/**
 * Filter state for event filtering
 */
export interface EventFilters {
  /** Filter by calendar IDs (empty = all visible) */
  calendarIds: string[];
  /** Filter by category IDs (empty = all) */
  categoryIds: string[];
  /** Filter by tags (empty = all) */
  tags: string[];
  /** Search query */
  searchQuery: string;
  /** Show only focus time events */
  focusTimeOnly: boolean;
  /** Date range start */
  dateRangeStart?: string;
  /** Date range end */
  dateRangeEnd?: string;
}
