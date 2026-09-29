import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  CalendarService,
  AddAttendeesRequestSchema,
  CreateCategoryRequestSchema,
  CreateEventRequestSchema,
  CreateEventTemplateRequestSchema,
  DeleteCategoryRequestSchema,
  DeleteEventRequestSchema,
  GetCalendarPolicyRequestSchema,
  GetEventRequestSchema,
  GetEventsInRangeRequestSchema,
  ListCalendarsRequestSchema,
  ListCategoriesRequestSchema,
  ListEventActivitiesRequestSchema,
  ListEventTemplatesRequestSchema,
  ListEventsRequestSchema,
  RemoveAttendeesRequestSchema,
  SetCalendarVisibilityRequestSchema,
  UpdateAttendeeStatusRequestSchema,
  UpdateCategoryRequestSchema,
  UpdateEventRequestSchema,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { transport } from "@core/api/transport";

const client = createClient(CalendarService, transport);

export const calendarApi = {
  createEvent: (request: MessageInitShape<typeof CreateEventRequestSchema>) =>
    client.createEvent(request),

  getEvent: (request: MessageInitShape<typeof GetEventRequestSchema>) => client.getEvent(request),

  updateEvent: (request: MessageInitShape<typeof UpdateEventRequestSchema>) =>
    client.updateEvent(request),

  deleteEvent: (request: MessageInitShape<typeof DeleteEventRequestSchema>) =>
    client.deleteEvent(request),

  listEvents: (request: MessageInitShape<typeof ListEventsRequestSchema>) =>
    client.listEvents(request),

  getEventsInRange: (request: MessageInitShape<typeof GetEventsInRangeRequestSchema>) =>
    client.getEventsInRange(request),

  listCalendars: (request: MessageInitShape<typeof ListCalendarsRequestSchema>) =>
    client.listCalendars(request),

  getCalendarPolicy: (request: MessageInitShape<typeof GetCalendarPolicyRequestSchema>) =>
    client.getCalendarPolicy(request),

  setCalendarVisibility: (request: MessageInitShape<typeof SetCalendarVisibilityRequestSchema>) =>
    client.setCalendarVisibility(request),

  listCategories: (request: MessageInitShape<typeof ListCategoriesRequestSchema>) =>
    client.listCategories(request),

  createCategory: (request: MessageInitShape<typeof CreateCategoryRequestSchema>) =>
    client.createCategory(request),

  updateCategory: (request: MessageInitShape<typeof UpdateCategoryRequestSchema>) =>
    client.updateCategory(request),

  deleteCategory: (request: MessageInitShape<typeof DeleteCategoryRequestSchema>) =>
    client.deleteCategory(request),

  updateAttendeeStatus: (request: MessageInitShape<typeof UpdateAttendeeStatusRequestSchema>) =>
    client.updateAttendeeStatus(request),

  addAttendees: (request: MessageInitShape<typeof AddAttendeesRequestSchema>) =>
    client.addAttendees(request),

  removeAttendees: (request: MessageInitShape<typeof RemoveAttendeesRequestSchema>) =>
    client.removeAttendees(request),

  listEventActivities: (request: MessageInitShape<typeof ListEventActivitiesRequestSchema>) =>
    client.listEventActivities(request),

  listEventTemplates: (request: MessageInitShape<typeof ListEventTemplatesRequestSchema>) =>
    client.listEventTemplates(request),

  createEventTemplate: (request: MessageInitShape<typeof CreateEventTemplateRequestSchema>) =>
    client.createEventTemplate(request),
};
