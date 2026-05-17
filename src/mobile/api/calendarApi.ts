import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { CalendarService, AddAttendeesRequestSchema, CreateCategoryRequestSchema, CreateEventRequestSchema, DeleteCategoryRequestSchema, DeleteEventRequestSchema, GetEventRequestSchema, GetEventsInRangeRequestSchema, ListCalendarsRequestSchema, ListCategoriesRequestSchema, ListEventsRequestSchema, RemoveAttendeesRequestSchema, UpdateAttendeeStatusRequestSchema, UpdateCategoryRequestSchema, UpdateEventRequestSchema } from "@uniffy/proto/cal/v1/calendar_pb";
import { transport } from "@/lib/transport";

const client = createClient(CalendarService, transport);

export const calendarApi = {
  createEvent: (request: MessageInitShape<typeof CreateEventRequestSchema>) => client.createEvent(request),

  getEvent: (request: MessageInitShape<typeof GetEventRequestSchema>) => client.getEvent(request),

  updateEvent: (request: MessageInitShape<typeof UpdateEventRequestSchema>) => client.updateEvent(request),

  deleteEvent: (request: MessageInitShape<typeof DeleteEventRequestSchema>) => client.deleteEvent(request),

  listEvents: (request: MessageInitShape<typeof ListEventsRequestSchema>) => client.listEvents(request),

  getEventsInRange: (request: MessageInitShape<typeof GetEventsInRangeRequestSchema>) =>
    client.getEventsInRange(request),

  listCalendars: (request: MessageInitShape<typeof ListCalendarsRequestSchema>) => client.listCalendars(request),

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

  addAttendees: (request: MessageInitShape<typeof AddAttendeesRequestSchema>) => client.addAttendees(request),

  removeAttendees: (request: MessageInitShape<typeof RemoveAttendeesRequestSchema>) =>
    client.removeAttendees(request),
};
