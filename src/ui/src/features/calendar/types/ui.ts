import type { ViewMode, QuickAccessFilter } from '@/features/calendar/types/calendar';

export interface CalendarUIState {
  viewMode: ViewMode;
  currentDate: string;
  quickAccessFilter: QuickAccessFilter | null;
  isDetailPanelOpen: boolean;
  selectedEventId: string | null;
  isEventModalOpen: boolean;
  eventModalMode: 'create' | 'edit';
  eventModalPrefill?: EventModalPrefill;
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  detailPanelWidth: number;
  collapsedSections: string[];
  draggedEventId: string | null;
  dropTarget: DropTarget | null;
  loading: CalendarLoadingState;
  errors: CalendarErrorState;
}

export interface EventModalPrefill {
  date?: string;
  startTime?: string;
  endTime?: string;
  calendarId?: string;
  categoryId?: string;
  title?: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  tagIds?: string[];
  durationMinutes?: number;
  /** Event id when opening in edit mode. */
  eventId?: string;
  context?: 'calendar' | 'chat' | 'note';
  suggestedAttendees?: string[];
  suggestedResources?: string[];
}

export interface DropTarget {
  /** ISO date string. */
  date: string;
  hour: number;
  /** 0, 15, 30, or 45. */
  minutes: number;
}

export interface CalendarLoadingState {
  events: boolean;
  eventDetail: boolean;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  calendars: boolean;
  categories: boolean;
}

export interface CalendarErrorState {
  events: string | null;
  eventDetail: string | null;
  creating: string | null;
  updating: string | null;
  deleting: string | null;
  calendars: string | null;
  categories: string | null;
}

export type SidebarSectionId =
  | 'quick_access'
  | 'mini_calendar'
  | 'calendars'
  | 'organization'
  | 'categories'
  | 'templates'
  | 'tags';

export type DetailPanelTab = 'outline' | 'links' | 'properties';

export type EventAction =
  | 'edit'
  | 'duplicate'
  | 'delete'
  | 'bookmark'
  | 'unbookmark'
  | 'add_attendee'
  | 'link_resource'
  | 'share';

export type KeyboardAction =
  | 'quick_capture'
  | 'navigate_previous'
  | 'navigate_next'
  | 'navigate_up'
  | 'navigate_down'
  | 'go_today'
  | 'toggle_view'
  | 'new_event'
  | 'close_modal'
  | 'save'
  | 'delete';

export interface CalendarToast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

export interface EventFilters {
  /** Empty = all visible. */
  calendarIds: string[];
  categoryIds: string[];
  /** Unified-tag ids. */
  tagIds: string[];
  searchQuery: string;
  focusTimeOnly: boolean;
  dateRangeStart?: string;
  dateRangeEnd?: string;
}
