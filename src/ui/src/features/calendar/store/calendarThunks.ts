/**
 * Calendar Async Thunks
 *
 * Redux async thunks for calendar API operations.
 * All async operations go through these thunks for proper state management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { calendarApi } from '../api/calendarApi';
import type { RootState } from '@/app/store';
import type {
    CalendarEvent as ProtoCalendarEvent,
    Calendar as ProtoCalendar,
    Category as ProtoCategory,
    Attendee as ProtoAttendee,
    RecurrenceConfig as ProtoRecurrenceConfig,
    LinkedResource as ProtoLinkedResource,
    EventTemplate as ProtoEventTemplate,
} from '@/gen/cal/v1/calendar_pb';
import {
    CalendarType as ProtoCalendarType,
    RecurrencePattern as ProtoRecurrencePattern,
    AttendeeStatus as ProtoAttendeeStatus,
    AttendeeRole as ProtoAttendeeRole,
    DayOfWeek as ProtoDayOfWeek,
    ResourceType as ProtoResourceType,
} from '@/gen/cal/v1/calendar_pb';
import { VisibilityScope as ProtoVisibilityScope } from '@/gen/common/v1/common_pb';
import { Timestamp } from '@bufbuild/protobuf';
import type {
    CalendarEvent,
    Calendar,
    Category,
    Attendee,
    RecurrenceConfig,
    LinkedResource,
    RecurrencePattern,
    DayOfWeek,
    ResourceType,
    AttendeeStatus,
    AttendeeRole,
    CalendarType,
    EventTemplate,
    CreateTemplatePayload,
    UpdateTemplatePayload,
} from '../types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get organization ID from state.
 */
const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

/**
 * Convert proto timestamp to ISO string.
 */
const timestampToIso = (ts: Timestamp | undefined): string => {
    if (!ts) return new Date().toISOString();
    const seconds = typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds;
    return new Date(seconds * 1000).toISOString();
};

/**
 * Convert ISO string to proto timestamp.
 */
const isoToTimestamp = (iso: string): Timestamp => {
    const date = new Date(iso);
    return new Timestamp({
        seconds: BigInt(Math.floor(date.getTime() / 1000)),
        nanos: 0,
    });
};

// ============================================================================
// Enum Converters
// ============================================================================

const RECURRENCE_FROM_PROTO: Record<ProtoRecurrencePattern, RecurrencePattern> = {
    [ProtoRecurrencePattern.UNSPECIFIED]: 'none',
    [ProtoRecurrencePattern.NONE]: 'none',
    [ProtoRecurrencePattern.DAILY]: 'daily',
    [ProtoRecurrencePattern.WEEKLY]: 'weekly',
    [ProtoRecurrencePattern.BIWEEKLY]: 'biweekly',
    [ProtoRecurrencePattern.MONTHLY]: 'monthly',
    [ProtoRecurrencePattern.YEARLY]: 'yearly',
};

const RECURRENCE_TO_PROTO: Record<RecurrencePattern, ProtoRecurrencePattern> = {
    'none': ProtoRecurrencePattern.NONE,
    'daily': ProtoRecurrencePattern.DAILY,
    'weekly': ProtoRecurrencePattern.WEEKLY,
    'biweekly': ProtoRecurrencePattern.BIWEEKLY,
    'monthly': ProtoRecurrencePattern.MONTHLY,
    'yearly': ProtoRecurrencePattern.YEARLY,
};

const DAY_OF_WEEK_FROM_PROTO: Record<ProtoDayOfWeek, DayOfWeek> = {
    [ProtoDayOfWeek.UNSPECIFIED]: 'monday',
    [ProtoDayOfWeek.MONDAY]: 'monday',
    [ProtoDayOfWeek.TUESDAY]: 'tuesday',
    [ProtoDayOfWeek.WEDNESDAY]: 'wednesday',
    [ProtoDayOfWeek.THURSDAY]: 'thursday',
    [ProtoDayOfWeek.FRIDAY]: 'friday',
    [ProtoDayOfWeek.SATURDAY]: 'saturday',
    [ProtoDayOfWeek.SUNDAY]: 'sunday',
};

const DAY_OF_WEEK_TO_PROTO: Record<DayOfWeek, ProtoDayOfWeek> = {
    'monday': ProtoDayOfWeek.MONDAY,
    'tuesday': ProtoDayOfWeek.TUESDAY,
    'wednesday': ProtoDayOfWeek.WEDNESDAY,
    'thursday': ProtoDayOfWeek.THURSDAY,
    'friday': ProtoDayOfWeek.FRIDAY,
    'saturday': ProtoDayOfWeek.SATURDAY,
    'sunday': ProtoDayOfWeek.SUNDAY,
};

const ATTENDEE_STATUS_FROM_PROTO: Record<ProtoAttendeeStatus, AttendeeStatus> = {
    [ProtoAttendeeStatus.UNSPECIFIED]: 'pending',
    [ProtoAttendeeStatus.PENDING]: 'pending',
    [ProtoAttendeeStatus.ACCEPTED]: 'accepted',
    [ProtoAttendeeStatus.TENTATIVE]: 'tentative',
    [ProtoAttendeeStatus.DECLINED]: 'declined',
};

const ATTENDEE_STATUS_TO_PROTO: Record<AttendeeStatus, ProtoAttendeeStatus> = {
    'pending': ProtoAttendeeStatus.PENDING,
    'accepted': ProtoAttendeeStatus.ACCEPTED,
    'tentative': ProtoAttendeeStatus.TENTATIVE,
    'declined': ProtoAttendeeStatus.DECLINED,
};

const ATTENDEE_ROLE_FROM_PROTO: Record<ProtoAttendeeRole, AttendeeRole> = {
    [ProtoAttendeeRole.UNSPECIFIED]: 'required',
    [ProtoAttendeeRole.ORGANIZER]: 'organizer',
    [ProtoAttendeeRole.REQUIRED]: 'required',
    [ProtoAttendeeRole.OPTIONAL]: 'optional',
};

const ATTENDEE_ROLE_TO_PROTO: Record<AttendeeRole, ProtoAttendeeRole> = {
    'organizer': ProtoAttendeeRole.ORGANIZER,
    'required': ProtoAttendeeRole.REQUIRED,
    'optional': ProtoAttendeeRole.OPTIONAL,
};

const CALENDAR_TYPE_FROM_PROTO: Record<ProtoCalendarType, CalendarType> = {
    [ProtoCalendarType.UNSPECIFIED]: 'personal',
    [ProtoCalendarType.PERSONAL]: 'personal',
    [ProtoCalendarType.WORK]: 'work',
    [ProtoCalendarType.TEAM]: 'team',
    [ProtoCalendarType.SHARED]: 'shared',
};

const CALENDAR_TYPE_TO_PROTO: Record<CalendarType, ProtoCalendarType> = {
    'personal': ProtoCalendarType.PERSONAL,
    'work': ProtoCalendarType.WORK,
    'team': ProtoCalendarType.TEAM,
    'shared': ProtoCalendarType.SHARED,
};

const RESOURCE_TYPE_FROM_PROTO: Record<ProtoResourceType, ResourceType> = {
    [ProtoResourceType.UNSPECIFIED]: 'note',
    [ProtoResourceType.NOTE]: 'note',
    [ProtoResourceType.FILE]: 'file',
    [ProtoResourceType.CHAT]: 'chat',
};

const VISIBILITY_TO_PROTO: Record<string, ProtoVisibilityScope> = {
    'private': ProtoVisibilityScope.PRIVATE,
    'group': ProtoVisibilityScope.GROUP,
    'organization': ProtoVisibilityScope.ORGANIZATION,
    'public': ProtoVisibilityScope.PUBLIC,
};

// ============================================================================
// Proto to Domain Converters
// ============================================================================

/**
 * Convert proto attendee to domain attendee.
 */
const attendeeFromProto = (proto: ProtoAttendee): Attendee => ({
    id: proto.id,
    name: proto.name,
    email: proto.email,
    avatarUrl: proto.avatarUrl || undefined,
    initials: proto.initials,
    status: ATTENDEE_STATUS_FROM_PROTO[proto.status] || 'pending',
    role: ATTENDEE_ROLE_FROM_PROTO[proto.role] || 'required',
    timezone: proto.timezone || undefined,
});

/**
 * Convert proto linked resource to domain.
 */
const linkedResourceFromProto = (proto: ProtoLinkedResource): LinkedResource => ({
    id: proto.id,
    type: RESOURCE_TYPE_FROM_PROTO[proto.type] || 'note',
    name: proto.name,
    url: proto.url || undefined,
});

/**
 * Convert proto recurrence config to domain.
 */
const recurrenceConfigFromProto = (proto: ProtoRecurrenceConfig | undefined): RecurrenceConfig | undefined => {
    if (!proto) return undefined;

    return {
        pattern: RECURRENCE_FROM_PROTO[proto.pattern] || 'none',
        interval: proto.interval || 1,
        daysOfWeek: proto.daysOfWeek?.map(d => DAY_OF_WEEK_FROM_PROTO[d] || 'monday'),
        dayOfMonth: proto.dayOfMonth || undefined,
        endDate: proto.endDate ? timestampToIso(proto.endDate) : undefined,
        maxOccurrences: proto.maxOccurrences || undefined,
    };
};

/**
 * Convert proto event to domain event.
 */
const eventFromProto = (proto: ProtoCalendarEvent): CalendarEvent => ({
    id: proto.id,
    organizationId: proto.organizationId,
    title: proto.title,
    description: proto.description,
    startTime: timestampToIso(proto.startTime),
    endTime: timestampToIso(proto.endTime),
    isAllDay: proto.isAllDay,
    timezone: proto.timezone,
    location: proto.location,
    meetingUrl: proto.meetingUrl || undefined,
    calendarId: proto.calendarId,
    categoryId: proto.categoryId || '',
    organizerId: proto.organizerId,
    attendees: proto.attendees.map(attendeeFromProto),
    recurrence: recurrenceConfigFromProto(proto.recurrence),
    isFocusTime: proto.isFocusTime,
    tags: [...proto.tags],
    linkedResources: proto.linkedResources.map(linkedResourceFromProto),
    createdAt: timestampToIso(proto.createdAt),
    updatedAt: timestampToIso(proto.updatedAt),
});

/**
 * Convert proto calendar to domain calendar.
 */
const calendarFromProto = (proto: ProtoCalendar): Calendar => ({
    id: proto.id,
    organizationId: proto.organizationId,
    name: proto.name,
    color: proto.color,
    isVisible: proto.isVisible,
    isDefault: proto.isDefault,
    ownerId: proto.ownerId,
    type: CALENDAR_TYPE_FROM_PROTO[proto.type] || 'personal',
    createdAt: timestampToIso(proto.createdAt),
    updatedAt: timestampToIso(proto.updatedAt),
});

/**
 * Convert proto category to domain category.
 */
const categoryFromProto = (proto: ProtoCategory): Category => ({
    id: proto.id,
    organizationId: proto.organizationId,
    name: proto.name,
    color: proto.color,
    icon: proto.icon || undefined,
    isDefault: proto.isDefault,
    sortOrder: proto.sortOrder,
    createdAt: timestampToIso(proto.createdAt),
    updatedAt: timestampToIso(proto.updatedAt),
});

/**
 * Convert proto template to domain template.
 */
const templateFromProto = (proto: ProtoEventTemplate): EventTemplate => ({
    id: proto.id,
    organizationId: proto.organizationId,
    title: proto.title,
    description: proto.description,
    durationMinutes: proto.durationMinutes,
    location: proto.location || '',
    meetingUrl: proto.meetingUrl,
    categoryId: proto.categoryId,
    tags: proto.tags,
    visibility: proto.visibility,
    createdBy: proto.createdBy,
    createdAt: proto.createdAt?.toDate() || new Date(),
    updatedAt: proto.updatedAt?.toDate() || new Date(),
});

// ============================================================================
// Event Thunks
// ============================================================================

/**
 * Fetch events in a date range.
 */
export const fetchEventsInRange = createAsyncThunk<
    CalendarEvent[],
    { startDate: string; endDate: string; calendarIds?: string[] },
    { state: RootState; rejectValue: string }
>('calendar/fetchEventsInRange', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.getEventsInRange({
            organizationId,
            startDate: isoToTimestamp(params.startDate),
            endDate: isoToTimestamp(params.endDate),
            calendarIds: params.calendarIds || [],
        });
        return response.events.map(eventFromProto);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch events');
    }
});

/**
 * Fetch a single event by ID.
 */
export const fetchEvent = createAsyncThunk<
    CalendarEvent,
    string,
    { state: RootState; rejectValue: string }
>('calendar/fetchEvent', async (eventId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.getEvent({
            eventId,
            organizationId,
        });
        if (!response.event) {
            return rejectWithValue('Event not found');
        }
        return eventFromProto(response.event);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch event');
    }
});

/**
 * Create a new event.
 */
export const createEvent = createAsyncThunk<
    CalendarEvent,
    {
        title: string;
        description?: string;
        startTime: string;
        endTime: string;
        isAllDay?: boolean;
        timezone?: string;
        location?: string;
        meetingUrl?: string;
        calendarId: string;
        categoryId?: string;
        attendeeIds?: string[];
        recurrence?: RecurrenceConfig;
        isFocusTime?: boolean;
        tags?: string[];
        visibility?: string;
    },
    { state: RootState; rejectValue: string }
>('calendar/createEvent', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        // Build recurrence config if provided
        let recurrenceConfig = undefined;
        if (params.recurrence && params.recurrence.pattern !== 'none') {
            recurrenceConfig = {
                pattern: RECURRENCE_TO_PROTO[params.recurrence.pattern],
                interval: params.recurrence.interval || 1,
                daysOfWeek: params.recurrence.daysOfWeek?.map(d => DAY_OF_WEEK_TO_PROTO[d]),
                dayOfMonth: params.recurrence.dayOfMonth,
                endDate: params.recurrence.endDate ? isoToTimestamp(params.recurrence.endDate) : undefined,
                maxOccurrences: params.recurrence.maxOccurrences,
            };
        }

        const response = await calendarApi.createEvent({
            organizationId,
            title: params.title,
            description: params.description || '',
            startTime: isoToTimestamp(params.startTime),
            endTime: isoToTimestamp(params.endTime),
            isAllDay: params.isAllDay || false,
            timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: params.location || '',
            meetingUrl: params.meetingUrl,
            calendarId: params.calendarId,
            categoryId: params.categoryId,
            attendeeIds: params.attendeeIds || [],
            recurrence: recurrenceConfig,
            isFocusTime: params.isFocusTime || false,
            tags: params.tags || [],
            visibility: VISIBILITY_TO_PROTO[params.visibility || 'private'] || ProtoVisibilityScope.PRIVATE,
        });

        if (!response.event) {
            return rejectWithValue('Failed to create event');
        }
        return eventFromProto(response.event);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create event');
    }
});

/**
 * Update an existing event.
 */
export const updateEvent = createAsyncThunk<
    CalendarEvent,
    {
        eventId: string;
        title?: string;
        description?: string;
        startTime?: string;
        endTime?: string;
        isAllDay?: boolean;
        timezone?: string;
        location?: string;
        meetingUrl?: string;
        calendarId?: string;
        categoryId?: string;
        attendeeIds?: string[];
        recurrence?: RecurrenceConfig;
        isFocusTime?: boolean;
        tags?: string[];
    },
    { state: RootState; rejectValue: string }
>('calendar/updateEvent', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        // Build recurrence config if provided
        let recurrenceConfig = undefined;
        if (params.recurrence) {
            recurrenceConfig = {
                pattern: RECURRENCE_TO_PROTO[params.recurrence.pattern],
                interval: params.recurrence.interval || 1,
                daysOfWeek: params.recurrence.daysOfWeek?.map(d => DAY_OF_WEEK_TO_PROTO[d]),
                dayOfMonth: params.recurrence.dayOfMonth,
                endDate: params.recurrence.endDate ? isoToTimestamp(params.recurrence.endDate) : undefined,
                maxOccurrences: params.recurrence.maxOccurrences,
            };
        }

        const response = await calendarApi.updateEvent({
            eventId: params.eventId,
            organizationId,
            title: params.title,
            description: params.description,
            startTime: params.startTime ? isoToTimestamp(params.startTime) : undefined,
            endTime: params.endTime ? isoToTimestamp(params.endTime) : undefined,
            isAllDay: params.isAllDay,
            timezone: params.timezone,
            location: params.location,
            meetingUrl: params.meetingUrl,
            calendarId: params.calendarId,
            categoryId: params.categoryId,
            attendeeIds: params.attendeeIds,
            recurrence: recurrenceConfig,
            isFocusTime: params.isFocusTime,
            tags: params.tags,
        });

        if (!response.event) {
            return rejectWithValue('Failed to update event');
        }
        return eventFromProto(response.event);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update event');
    }
});

/**
 * Delete an event.
 */
export const deleteEvent = createAsyncThunk<
    { eventId: string },
    string,
    { state: RootState; rejectValue: string }
>('calendar/deleteEvent', async (eventId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.deleteEvent({
            eventId,
            organizationId,
        });
        if (!response.success) {
            return rejectWithValue('Failed to delete event');
        }
        return { eventId };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete event');
    }
});

// ============================================================================
// Calendar Thunks
// ============================================================================

/**
 * Fetch all calendars for the current user.
 */
export const fetchCalendars = createAsyncThunk<
    Calendar[],
    void,
    { state: RootState; rejectValue: string }
>('calendar/fetchCalendars', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.listCalendars({
            organizationId,
        });
        return response.calendars.map(calendarFromProto);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch calendars');
    }
});

/**
 * Create a new calendar.
 */
export const createCalendar = createAsyncThunk<
    Calendar,
    {
        name: string;
        color: string;
        type?: CalendarType;
        isDefault?: boolean;
    },
    { state: RootState; rejectValue: string }
>('calendar/createCalendar', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.createCalendar({
            organizationId,
            name: params.name,
            color: params.color,
            type: CALENDAR_TYPE_TO_PROTO[params.type || 'personal'],
            isDefault: params.isDefault || false,
        });
        if (!response.calendar) {
            return rejectWithValue('Failed to create calendar');
        }
        return calendarFromProto(response.calendar);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create calendar');
    }
});

/**
 * Update a calendar.
 */
export const updateCalendar = createAsyncThunk<
    Calendar,
    {
        calendarId: string;
        name?: string;
        color?: string;
        isVisible?: boolean;
        isDefault?: boolean;
    },
    { state: RootState; rejectValue: string }
>('calendar/updateCalendar', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.updateCalendar({
            calendarId: params.calendarId,
            organizationId,
            name: params.name,
            color: params.color,
            isVisible: params.isVisible,
            isDefault: params.isDefault,
        });
        if (!response.calendar) {
            return rejectWithValue('Failed to update calendar');
        }
        return calendarFromProto(response.calendar);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update calendar');
    }
});

/**
 * Delete a calendar.
 */
export const deleteCalendar = createAsyncThunk<
    { calendarId: string },
    string,
    { state: RootState; rejectValue: string }
>('calendar/deleteCalendar', async (calendarId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.deleteCalendar({
            calendarId,
            organizationId,
        });
        if (!response.success) {
            return rejectWithValue('Failed to delete calendar');
        }
        return { calendarId };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete calendar');
    }
});

// ============================================================================
// Category Thunks
// ============================================================================

/**
 * Fetch all categories for the current organization.
 */
export const fetchCategories = createAsyncThunk<
    Category[],
    void,
    { state: RootState; rejectValue: string }
>('calendar/fetchCategories', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.listCategories({
            organizationId,
        });
        return response.categories.map(categoryFromProto);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch categories');
    }
});

/**
 * Create a new category.
 */
export const createCategory = createAsyncThunk<
    Category,
    {
        name: string;
        color: string;
        icon?: string;
    },
    { state: RootState; rejectValue: string }
>('calendar/createCategory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.createCategory({
            organizationId,
            name: params.name,
            color: params.color,
            icon: params.icon,
        });
        if (!response.category) {
            return rejectWithValue('Failed to create category');
        }
        return categoryFromProto(response.category);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create category');
    }
});

/**
 * Update a category.
 */
export const updateCategory = createAsyncThunk<
    Category,
    {
        categoryId: string;
        name?: string;
        color?: string;
        icon?: string;
        sortOrder?: number;
    },
    { state: RootState; rejectValue: string }
>('calendar/updateCategory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.updateCategory({
            categoryId: params.categoryId,
            organizationId,
            name: params.name,
            color: params.color,
            icon: params.icon,
            sortOrder: params.sortOrder,
        });
        if (!response.category) {
            return rejectWithValue('Failed to update category');
        }
        return categoryFromProto(response.category);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update category');
    }
});

/**
 * Delete a category.
 */
export const deleteCategory = createAsyncThunk<
    { categoryId: string },
    string,
    { state: RootState; rejectValue: string }
>('calendar/deleteCategory', async (categoryId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.deleteCategory({
            categoryId,
            organizationId,
        });
        if (!response.success) {
            return rejectWithValue('Failed to delete category');
        }
        return { categoryId };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete category');
    }
});

// ============================================================================
// Attendee Thunks
// ============================================================================

/**
 * Update attendee status for an event.
 */
export const updateAttendeeStatus = createAsyncThunk<
    { eventId: string; userId: string; status: AttendeeStatus },
    { eventId: string; status: AttendeeStatus },
    { state: RootState; rejectValue: string }
>('calendar/updateAttendeeStatus', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const userId = getState().auth.user?.id;
        if (!userId) {
            return rejectWithValue('No user logged in');
        }

        const response = await calendarApi.updateAttendeeStatus({
            eventId: params.eventId,
            organizationId,
            status: ATTENDEE_STATUS_TO_PROTO[params.status],
        });

        if (!response.success) {
            return rejectWithValue('Failed to update attendee status');
        }

        return {
            eventId: params.eventId,
            userId,
            status: params.status,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update attendee status');
    }
});

/**
 * Add attendees to an event.
 */
export const addAttendees = createAsyncThunk<
    CalendarEvent,
    { eventId: string; userIds: string[]; role?: AttendeeRole },
    { state: RootState; rejectValue: string }
>('calendar/addAttendees', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.addAttendees({
            eventId: params.eventId,
            organizationId,
            userIds: params.userIds,
            role: ATTENDEE_ROLE_TO_PROTO[params.role || 'required'],
        });
        if (!response.event) {
            return rejectWithValue('Failed to add attendees');
        }
        return eventFromProto(response.event);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to add attendees');
    }
});

/**
 * Remove attendees from an event.
 */
export const removeAttendees = createAsyncThunk<
    CalendarEvent,
    { eventId: string; userIds: string[] },
    { state: RootState; rejectValue: string }
>('calendar/removeAttendees', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.removeAttendees({
            eventId: params.eventId,
            organizationId,
            userIds: params.userIds,
        });
        if (!response.event) {
            return rejectWithValue('Failed to remove attendees');
        }
        return eventFromProto(response.event);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to remove attendees');
    }
});

// ============================================================================
// Template Thunks
// ============================================================================

export const createEventTemplate = createAsyncThunk<
    EventTemplate,
    CreateTemplatePayload,
    { state: RootState; rejectValue: string }
>('calendar/createTemplate', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.createEventTemplate({
            organizationId,
            title: params.title,
            description: params.description,
            durationMinutes: params.durationMinutes,
            location: params.location,
            meetingUrl: params.meetingUrl,
            categoryId: params.categoryId,
            tags: params.tags,
            visibility: params.visibility ?? ProtoVisibilityScope.PRIVATE,
        });
        if (!response.template) {
            return rejectWithValue('Failed to create template');
        }
        return templateFromProto(response.template);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create template');
    }
});

export const getEventTemplate = createAsyncThunk<
    EventTemplate,
    string,
    { state: RootState; rejectValue: string }
>('calendar/getTemplate', async (templateId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.getEventTemplate({
            templateId,
            organizationId,
        });
        if (!response.template) {
            return rejectWithValue('Failed to get template');
        }
        return templateFromProto(response.template);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to get template');
    }
});

export const updateEventTemplate = createAsyncThunk<
    EventTemplate,
    UpdateTemplatePayload,
    { state: RootState; rejectValue: string }
>('calendar/updateTemplate', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.updateEventTemplate({
            templateId: params.id,
            organizationId,
            title: params.title,
            description: params.description,
            durationMinutes: params.durationMinutes,
            location: params.location,
            meetingUrl: params.meetingUrl,
            categoryId: params.categoryId,
            tags: params.tags,
            visibility: params.visibility,
        });
        if (!response.template) {
            return rejectWithValue('Failed to update template');
        }
        return templateFromProto(response.template);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update template');
    }
});

export const deleteEventTemplate = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('calendar/deleteTemplate', async (templateId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await calendarApi.deleteEventTemplate({
            templateId,
            organizationId,
        });
        return templateId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete template');
    }
});

export const listEventTemplates = createAsyncThunk<
    EventTemplate[],
    void,
    { state: RootState; rejectValue: string }
>('calendar/listTemplates', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await calendarApi.listEventTemplates({
            organizationId,
        });
        return (response.templates || []).map(templateFromProto);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to list templates');
    }
});
