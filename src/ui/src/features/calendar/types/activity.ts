export type EventActivityAction =
  | 'created'
  | 'title_changed'
  | 'schedule_changed'
  | 'location_changed'
  | 'meeting_changed'
  | 'description_changed'
  | 'category_changed'
  | 'calendar_changed'
  | 'recurrence_changed'
  | 'reminders_changed'
  | 'attendees_added'
  | 'attendees_removed'
  | 'response_changed'
  | 'field_updated';

export interface EventActivity {
  id: string;
  eventId: string;
  actorId: string;
  action: EventActivityAction;
  timestamp: string;
  /** Field the change applies to, for field-scoped actions. */
  fieldId?: string;
  previousValue?: string;
  newValue?: string;
}
