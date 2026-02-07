/**
 * Calendar feature type exports
 */

// Event types
export type {
  CalendarEvent,
  CreateEventRequest,
  UpdateEventRequest,
  PositionedEvent,
  MultiDayPosition,
  RecurrenceConfig,
  RecurrencePattern,
  DayOfWeek,
  LinkedResource,
  ResourceType,
} from '@/features/calendar/types/event';

// Calendar types
export type {
  CalendarPreferences,
  ViewMode,
  QuickAccessFilter,
  NavigationDirection,
  TimeSlot,
  DayColumn,
} from '@/features/calendar/types/calendar';

// Category types
export type {
  Category,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CategoryColorOption,
  DefaultCategoryId,
} from '@/features/calendar/types/category';
export { DEFAULT_CATEGORY_IDS } from '@/features/calendar/types/category';

// Attendee types
export type {
  Attendee,
  AttendeeStatus,
  AttendeeRole,
  AttendeeSuggestion,
  AvatarStackConfig,
} from '@/features/calendar/types/attendee';
export { ATTENDEE_STATUS_CONFIG } from '@/features/calendar/types/attendee';

// UI types
export type {
  CalendarUIState,
  EventModalPrefill,
  DropTarget,
  CalendarLoadingState,
  CalendarErrorState,
  SidebarSectionId,
  DetailPanelTab,
  EventAction,
  KeyboardAction,
  CalendarToast,
  EventFilters,
} from '@/features/calendar/types/ui';

// Form types
export type {
  EventFormData,
  QuickCaptureData,
  ParsedQuickCapture,
  CategoryFormData,
  TemplateFormData,
} from '@/features/calendar/types/forms';

export {
  eventFormSchema,
  eventFormDefaults,
  quickCaptureSchema,
  categoryFormSchema,
  templateFormSchema,
  RECURRENCE_LABELS,
  DAY_OF_WEEK_LABELS,
} from '@/features/calendar/types/forms';

// Template types
export type {
  EventTemplate,
  CreateTemplatePayload,
  UpdateTemplatePayload,
} from '@/features/calendar/types/template';
