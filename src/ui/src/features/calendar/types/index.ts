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
} from './event';

// Calendar types
export type {
  Calendar,
  CalendarType,
  CalendarPreferences,
  ViewMode,
  QuickAccessFilter,
  NavigationDirection,
  TimeSlot,
  DayColumn,
} from './calendar';

// Category types
export type {
  Category,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CategoryColorOption,
  DefaultCategoryId,
} from './category';
export { DEFAULT_CATEGORY_IDS } from './category';

// Attendee types
export type {
  Attendee,
  AttendeeStatus,
  AttendeeRole,
  AttendeeSuggestion,
  AvatarStackConfig,
} from './attendee';
export { ATTENDEE_STATUS_CONFIG } from './attendee';

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
} from './ui';

// Form types
export type {
  EventFormData,
  QuickCaptureData,
  ParsedQuickCapture,
  CategoryFormData,
  TemplateFormData,
} from './forms';

export {
  eventFormSchema,
  eventFormDefaults,
  quickCaptureSchema,
  categoryFormSchema,
  templateFormSchema,
  RECURRENCE_LABELS,
  DAY_OF_WEEK_LABELS,
} from './forms';

// Template types
export type {
  EventTemplate,
  CreateTemplatePayload,
  UpdateTemplatePayload,
} from './template';
