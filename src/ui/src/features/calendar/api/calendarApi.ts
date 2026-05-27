import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { CalendarService, AddAttendeesRequestSchema, CreateCategoryRequestSchema, CreateEventRequestSchema, CreateEventTemplateRequestSchema, DeleteCategoryRequestSchema, DeleteEventRequestSchema, DeleteEventTemplateRequestSchema, GetCategoryRequestSchema, GetEventRequestSchema, GetEventTemplateRequestSchema, GetEventsInRangeRequestSchema, ListCategoriesRequestSchema, ListEventTemplatesRequestSchema, ListEventsRequestSchema, RemoveAttendeesRequestSchema, UpdateAttendeeStatusRequestSchema, UpdateCategoryRequestSchema, UpdateEventRequestSchema, UpdateEventTemplateRequestSchema } from '@uniffy/proto/cal/v1/calendar_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const calendarClient = createClient(CalendarService, unaryTransport);

export const calendarApi = {
    createEvent: async (request: MessageInitShape<typeof CreateEventRequestSchema>) => {
        return calendarClient.createEvent(request);
    },

    getEvent: async (request: MessageInitShape<typeof GetEventRequestSchema>) => {
        return calendarClient.getEvent(request);
    },

    updateEvent: async (request: MessageInitShape<typeof UpdateEventRequestSchema>) => {
        return calendarClient.updateEvent(request);
    },

    deleteEvent: async (request: MessageInitShape<typeof DeleteEventRequestSchema>) => {
        return calendarClient.deleteEvent(request);
    },

    listEvents: async (request: MessageInitShape<typeof ListEventsRequestSchema>) => {
        return calendarClient.listEvents(request);
    },

    getEventsInRange: async (request: MessageInitShape<typeof GetEventsInRangeRequestSchema>) => {
        return calendarClient.getEventsInRange(request);
    },

    createCategory: async (request: MessageInitShape<typeof CreateCategoryRequestSchema>) => {
        return calendarClient.createCategory(request);
    },

    getCategory: async (request: MessageInitShape<typeof GetCategoryRequestSchema>) => {
        return calendarClient.getCategory(request);
    },

    updateCategory: async (request: MessageInitShape<typeof UpdateCategoryRequestSchema>) => {
        return calendarClient.updateCategory(request);
    },

    deleteCategory: async (request: MessageInitShape<typeof DeleteCategoryRequestSchema>) => {
        return calendarClient.deleteCategory(request);
    },

    listCategories: async (request: MessageInitShape<typeof ListCategoriesRequestSchema>) => {
        return calendarClient.listCategories(request);
    },

    updateAttendeeStatus: async (request: MessageInitShape<typeof UpdateAttendeeStatusRequestSchema>) => {
        return calendarClient.updateAttendeeStatus(request);
    },

    addAttendees: async (request: MessageInitShape<typeof AddAttendeesRequestSchema>) => {
        return calendarClient.addAttendees(request);
    },

    removeAttendees: async (request: MessageInitShape<typeof RemoveAttendeesRequestSchema>) => {
        return calendarClient.removeAttendees(request);
    },

    createEventTemplate: async (request: MessageInitShape<typeof CreateEventTemplateRequestSchema>) => {
        return calendarClient.createEventTemplate(request);
    },

    getEventTemplate: async (request: MessageInitShape<typeof GetEventTemplateRequestSchema>) => {
        return calendarClient.getEventTemplate(request);
    },

    updateEventTemplate: async (request: MessageInitShape<typeof UpdateEventTemplateRequestSchema>) => {
        return calendarClient.updateEventTemplate(request);
    },

    deleteEventTemplate: async (request: MessageInitShape<typeof DeleteEventTemplateRequestSchema>) => {
        return calendarClient.deleteEventTemplate(request);
    },

    listEventTemplates: async (request: MessageInitShape<typeof ListEventTemplatesRequestSchema>) => {
        return calendarClient.listEventTemplates(request);
    },
};
