/**
 * Calendar API Service
 *
 * Centralized ConnectRPC client for calendar operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { CalendarService } from '@/gen/cal/v1/calendar_connect';
import type {
    CreateEventRequest,
    GetEventRequest,
    UpdateEventRequest,
    DeleteEventRequest,
    ListEventsRequest,
    GetEventsInRangeRequest,
    CreateCalendarRequest,
    GetCalendarRequest,
    UpdateCalendarRequest,
    DeleteCalendarRequest,
    ListCalendarsRequest,
    CreateCategoryRequest,
    GetCategoryRequest,
    UpdateCategoryRequest,
    DeleteCategoryRequest,
    ListCategoriesRequest,
    UpdateAttendeeStatusRequest,
    AddAttendeesRequest,
    RemoveAttendeesRequest,
} from '@/gen/cal/v1/calendar_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a calendar service client with the shared transport.
 */
const calendarClient = createClient(CalendarService, transport);

/**
 * Calendar API service with typed methods.
 */
export const calendarApi = {
    // ========================================================================
    // Event Operations
    // ========================================================================

    /**
     * Create a new calendar event.
     */
    createEvent: async (request: PartialMessage<CreateEventRequest>) => {
        return calendarClient.createEvent(request);
    },

    /**
     * Get an event by ID.
     */
    getEvent: async (request: PartialMessage<GetEventRequest>) => {
        return calendarClient.getEvent(request);
    },

    /**
     * Update an existing event.
     */
    updateEvent: async (request: PartialMessage<UpdateEventRequest>) => {
        return calendarClient.updateEvent(request);
    },

    /**
     * Delete an event (soft delete).
     */
    deleteEvent: async (request: PartialMessage<DeleteEventRequest>) => {
        return calendarClient.deleteEvent(request);
    },

    /**
     * List events with filters and pagination.
     */
    listEvents: async (request: PartialMessage<ListEventsRequest>) => {
        return calendarClient.listEvents(request);
    },

    /**
     * Get events for a specific date range (optimized for calendar views).
     */
    getEventsInRange: async (request: PartialMessage<GetEventsInRangeRequest>) => {
        return calendarClient.getEventsInRange(request);
    },

    // ========================================================================
    // Calendar Operations
    // ========================================================================

    /**
     * Create a new calendar.
     */
    createCalendar: async (request: PartialMessage<CreateCalendarRequest>) => {
        return calendarClient.createCalendar(request);
    },

    /**
     * Get a calendar by ID.
     */
    getCalendar: async (request: PartialMessage<GetCalendarRequest>) => {
        return calendarClient.getCalendar(request);
    },

    /**
     * Update a calendar.
     */
    updateCalendar: async (request: PartialMessage<UpdateCalendarRequest>) => {
        return calendarClient.updateCalendar(request);
    },

    /**
     * Delete a calendar.
     */
    deleteCalendar: async (request: PartialMessage<DeleteCalendarRequest>) => {
        return calendarClient.deleteCalendar(request);
    },

    /**
     * List user's calendars.
     */
    listCalendars: async (request: PartialMessage<ListCalendarsRequest>) => {
        return calendarClient.listCalendars(request);
    },

    // ========================================================================
    // Category Operations
    // ========================================================================

    /**
     * Create a new category.
     */
    createCategory: async (request: PartialMessage<CreateCategoryRequest>) => {
        return calendarClient.createCategory(request);
    },

    /**
     * Get a category by ID.
     */
    getCategory: async (request: PartialMessage<GetCategoryRequest>) => {
        return calendarClient.getCategory(request);
    },

    /**
     * Update a category.
     */
    updateCategory: async (request: PartialMessage<UpdateCategoryRequest>) => {
        return calendarClient.updateCategory(request);
    },

    /**
     * Delete a category.
     */
    deleteCategory: async (request: PartialMessage<DeleteCategoryRequest>) => {
        return calendarClient.deleteCategory(request);
    },

    /**
     * List categories.
     */
    listCategories: async (request: PartialMessage<ListCategoriesRequest>) => {
        return calendarClient.listCategories(request);
    },

    // ========================================================================
    // Attendee Operations
    // ========================================================================

    /**
     * Update attendee response status.
     */
    updateAttendeeStatus: async (request: PartialMessage<UpdateAttendeeStatusRequest>) => {
        return calendarClient.updateAttendeeStatus(request);
    },

    /**
     * Add attendees to an event.
     */
    addAttendees: async (request: PartialMessage<AddAttendeesRequest>) => {
        return calendarClient.addAttendees(request);
    },

    /**
     * Remove attendees from an event.
     */
    removeAttendees: async (request: PartialMessage<RemoveAttendeesRequest>) => {
        return calendarClient.removeAttendees(request);
    },
};

export default calendarApi;
