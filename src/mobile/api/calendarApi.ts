import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { CalendarService } from "@uniffy/proto/cal/v1/calendar_connect";
import type {
  CreateEventRequest,
  GetEventRequest,
  UpdateEventRequest,
  DeleteEventRequest,
  ListEventsRequest,
  GetEventsInRangeRequest,
  ListCalendarsRequest,
  ListCategoriesRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DeleteCategoryRequest,
  UpdateAttendeeStatusRequest,
  AddAttendeesRequest,
  RemoveAttendeesRequest,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { transport } from "@/lib/transport";

const client = createClient(CalendarService, transport);

export const calendarApi = {
  createEvent: (request: PartialMessage<CreateEventRequest>) => client.createEvent(request),

  getEvent: (request: PartialMessage<GetEventRequest>) => client.getEvent(request),

  updateEvent: (request: PartialMessage<UpdateEventRequest>) => client.updateEvent(request),

  deleteEvent: (request: PartialMessage<DeleteEventRequest>) => client.deleteEvent(request),

  listEvents: (request: PartialMessage<ListEventsRequest>) => client.listEvents(request),

  getEventsInRange: (request: PartialMessage<GetEventsInRangeRequest>) =>
    client.getEventsInRange(request),

  listCalendars: (request: PartialMessage<ListCalendarsRequest>) => client.listCalendars(request),

  listCategories: (request: PartialMessage<ListCategoriesRequest>) =>
    client.listCategories(request),

  createCategory: (request: PartialMessage<CreateCategoryRequest>) =>
    client.createCategory(request),

  updateCategory: (request: PartialMessage<UpdateCategoryRequest>) =>
    client.updateCategory(request),

  deleteCategory: (request: PartialMessage<DeleteCategoryRequest>) =>
    client.deleteCategory(request),

  updateAttendeeStatus: (request: PartialMessage<UpdateAttendeeStatusRequest>) =>
    client.updateAttendeeStatus(request),

  addAttendees: (request: PartialMessage<AddAttendeesRequest>) => client.addAttendees(request),

  removeAttendees: (request: PartialMessage<RemoveAttendeesRequest>) =>
    client.removeAttendees(request),
};
