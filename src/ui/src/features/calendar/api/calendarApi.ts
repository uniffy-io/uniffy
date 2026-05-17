/**
 * Calendar API Service
 *
 * Centralized ConnectRPC client for calendar operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { CalendarService, AddAttendeesRequestSchema, CreateCategoryRequestSchema, CreateEventRequestSchema, CreateEventTemplateRequestSchema, DeleteCategoryRequestSchema, DeleteEventRequestSchema, DeleteEventTemplateRequestSchema, GetCategoryRequestSchema, GetEventRequestSchema, GetEventTemplateRequestSchema, GetEventsInRangeRequestSchema, ListCategoriesRequestSchema, ListEventTemplatesRequestSchema, ListEventsRequestSchema, RemoveAttendeesRequestSchema, UpdateAttendeeStatusRequestSchema, UpdateCategoryRequestSchema, UpdateEventRequestSchema, UpdateEventTemplateRequestSchema } from '@uniffy/proto/cal/v1/calendar_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a calendar service client with the shared transport.
 */
const calendarClient = createClient(CalendarService, unaryTransport);

/**
 * Calendar API service with typed methods.
 */
export const calendarApi = {
    // Event Operations

    /**
     * Create a new calendar event.
     */
    createEvent: async (request: MessageInitShape<typeof CreateEventRequestSchema>) => {
        return calendarClient.createEvent(request);
    },

    /**
     * Get an event by ID.
     */
    getEvent: async (request: MessageInitShape<typeof GetEventRequestSchema>) => {
        return calendarClient.getEvent(request);
    },

    /**
     * Update an existing event.
     */
    updateEvent: async (request: MessageInitShape<typeof UpdateEventRequestSchema>) => {
        return calendarClient.updateEvent(request);
    },

    /**
     * Delete an event (soft delete).
     */
    deleteEvent: async (request: MessageInitShape<typeof DeleteEventRequestSchema>) => {
        return calendarClient.deleteEvent(request);
    },

    /**
     * List events with filters and pagination.
     */
    listEvents: async (request: MessageInitShape<typeof ListEventsRequestSchema>) => {
        return calendarClient.listEvents(request);
    },

    /**
     * Get events for a specific date range (optimized for calendar views).
     */
    getEventsInRange: async (request: MessageInitShape<typeof GetEventsInRangeRequestSchema>) => {
        return calendarClient.getEventsInRange(request);
    },

    // Category Operations

    /**
     * Create a new category.
     */
    createCategory: async (request: MessageInitShape<typeof CreateCategoryRequestSchema>) => {
        return calendarClient.createCategory(request);
    },

    /**
     * Get a category by ID.
     */
    getCategory: async (request: MessageInitShape<typeof GetCategoryRequestSchema>) => {
        return calendarClient.getCategory(request);
    },

    /**
     * Update a category.
     */
    updateCategory: async (request: MessageInitShape<typeof UpdateCategoryRequestSchema>) => {
        return calendarClient.updateCategory(request);
    },

    /**
     * Delete a category.
     */
    deleteCategory: async (request: MessageInitShape<typeof DeleteCategoryRequestSchema>) => {
        return calendarClient.deleteCategory(request);
    },

    /**
     * List categories.
     */
    listCategories: async (request: MessageInitShape<typeof ListCategoriesRequestSchema>) => {
        return calendarClient.listCategories(request);
    },

    // Attendee Operations

    /**
     * Update attendee response status.
     */
    updateAttendeeStatus: async (request: MessageInitShape<typeof UpdateAttendeeStatusRequestSchema>) => {
        return calendarClient.updateAttendeeStatus(request);
    },

    /**
     * Add attendees to an event.
     */
    addAttendees: async (request: MessageInitShape<typeof AddAttendeesRequestSchema>) => {
        return calendarClient.addAttendees(request);
    },

    /**
     * Remove attendees from an event.
     */
    removeAttendees: async (request: MessageInitShape<typeof RemoveAttendeesRequestSchema>) => {
        return calendarClient.removeAttendees(request);
    },

    // Template Operations

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

