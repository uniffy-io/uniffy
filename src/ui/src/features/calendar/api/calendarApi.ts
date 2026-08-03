import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { CalendarService, AddAttendeesRequestSchema, CreateCategoryRequestSchema, CreateEventRequestSchema, CreateEventTemplateRequestSchema, DeleteCategoryRequestSchema, DeleteEventRequestSchema, DeleteEventTemplateRequestSchema, EventActivityAction as ProtoEventActivityAction, GetEventRequestSchema, GetEventTemplateRequestSchema, GetEventsInRangeRequestSchema, ListCategoriesRequestSchema, ListEventActivitiesRequestSchema, ListEventTemplatesRequestSchema, RemoveAttendeesRequestSchema, UpdateAttendeeStatusRequestSchema, UpdateCategoryRequestSchema, UpdateEventRequestSchema, UpdateEventTemplateRequestSchema } from '@uniffy/proto/cal/v1/calendar_pb';
import type { EventActivity as ProtoEventActivity } from '@uniffy/proto/cal/v1/calendar_pb';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import type { MessageInitShape } from '@bufbuild/protobuf';
import type { EventActivity, EventActivityAction } from '@/features/calendar/types/activity';

const ACTIVITY_ACTION_FROM_PROTO: Record<number, EventActivityAction> = {
    [ProtoEventActivityAction.CREATED]: 'created',
    [ProtoEventActivityAction.TITLE_CHANGED]: 'title_changed',
    [ProtoEventActivityAction.SCHEDULE_CHANGED]: 'schedule_changed',
    [ProtoEventActivityAction.LOCATION_CHANGED]: 'location_changed',
    [ProtoEventActivityAction.MEETING_CHANGED]: 'meeting_changed',
    [ProtoEventActivityAction.DESCRIPTION_CHANGED]: 'description_changed',
    [ProtoEventActivityAction.CATEGORY_CHANGED]: 'category_changed',
    [ProtoEventActivityAction.CALENDAR_CHANGED]: 'calendar_changed',
    [ProtoEventActivityAction.RECURRENCE_CHANGED]: 'recurrence_changed',
    [ProtoEventActivityAction.REMINDERS_CHANGED]: 'reminders_changed',
    [ProtoEventActivityAction.ATTENDEES_ADDED]: 'attendees_added',
    [ProtoEventActivityAction.ATTENDEES_REMOVED]: 'attendees_removed',
    [ProtoEventActivityAction.RESPONSE_CHANGED]: 'response_changed',
    [ProtoEventActivityAction.FIELD_UPDATED]: 'field_updated',
};

function activityFromProto(proto: ProtoEventActivity): EventActivity {
    return {
        id: proto.id,
        eventId: proto.eventId,
        actorId: proto.actorId,
        action: ACTIVITY_ACTION_FROM_PROTO[proto.action] ?? 'field_updated',
        timestamp: proto.timestamp
            ? timestampDate(proto.timestamp).toISOString()
            : new Date().toISOString(),
        fieldId: proto.fieldId,
        previousValue: proto.previousValue,
        newValue: proto.newValue,
    };
}

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

    getEventsInRange: async (request: MessageInitShape<typeof GetEventsInRangeRequestSchema>) => {
        return calendarClient.getEventsInRange(request);
    },

    createCategory: async (request: MessageInitShape<typeof CreateCategoryRequestSchema>) => {
        return calendarClient.createCategory(request);
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

    listEventActivities: async (request: MessageInitShape<typeof ListEventActivitiesRequestSchema>) => {
        const response = await calendarClient.listEventActivities(request);
        return response.activities.map(activityFromProto);
    },
};
