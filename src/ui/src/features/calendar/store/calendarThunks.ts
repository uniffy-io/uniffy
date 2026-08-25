import { createAsyncThunk } from "@reduxjs/toolkit";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import type { RootState } from "@/app/store";
import { bulkUpsertTags, tagToPlain } from "@/features/tags";
import type {
  CalendarEvent as ProtoCalendarEvent,
  Category as ProtoCategory,
  Attendee as ProtoAttendee,
  RecurrenceConfig as ProtoRecurrenceConfig,
  LinkedResource as ProtoLinkedResource,
  EventTemplate as ProtoEventTemplate,
  BusyInterval as ProtoBusyInterval,
} from "@uniffy/proto/cal/v1/calendar_pb";
import type {
  FreeBusyData,
  MeetingSuggestion,
  SchedulingBusyInterval,
} from "@/features/calendar/types/scheduling";
import {
  RecurrencePattern as ProtoRecurrencePattern,
  AttendeeStatus as ProtoAttendeeStatus,
  AttendeeRole as ProtoAttendeeRole,
  DayOfWeek as ProtoDayOfWeek,
  ResourceType as ProtoResourceType,
  EventStatus as ProtoEventStatus,
  EventVisibility as ProtoEventVisibility,
  EventTransparency as ProtoEventTransparency,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema, timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  CalendarEvent,
  Category,
  Attendee,
  RecurrenceConfig,
  RecurrenceEditScope,
  LinkedResource,
  RecurrencePattern,
  DayOfWeek,
  ResourceType,
  AttendeeStatus,
  AttendeeRole,
  EventStatus,
  EventVisibility,
  EventTransparency,
  EventTemplate,
  CreateTemplatePayload,
  UpdateTemplatePayload,
  EventActivity,
} from "@/features/calendar/types";
import { RecurrenceEditScope as ProtoRecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) {
    throw new Error("No organization selected");
  }
  return orgId;
};

const timestampToIso = (ts: Timestamp | undefined): string => {
  if (!ts) return new Date().toISOString();
  const seconds = typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds;
  return new Date(seconds * 1000).toISOString();
};

const isoToTimestamp = (iso: string): Timestamp => {
  const date = new Date(iso);
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(date.getTime() / 1000)),
    nanos: 0,
  });
};

const RECURRENCE_FROM_PROTO: Record<ProtoRecurrencePattern, RecurrencePattern> = {
  [ProtoRecurrencePattern.UNSPECIFIED]: "none",
  [ProtoRecurrencePattern.NONE]: "none",
  [ProtoRecurrencePattern.DAILY]: "daily",
  [ProtoRecurrencePattern.WEEKLY]: "weekly",
  [ProtoRecurrencePattern.BIWEEKLY]: "biweekly",
  [ProtoRecurrencePattern.MONTHLY]: "monthly",
  [ProtoRecurrencePattern.YEARLY]: "yearly",
};

const RECURRENCE_TO_PROTO: Record<RecurrencePattern, ProtoRecurrencePattern> = {
  none: ProtoRecurrencePattern.NONE,
  daily: ProtoRecurrencePattern.DAILY,
  weekly: ProtoRecurrencePattern.WEEKLY,
  biweekly: ProtoRecurrencePattern.BIWEEKLY,
  monthly: ProtoRecurrencePattern.MONTHLY,
  yearly: ProtoRecurrencePattern.YEARLY,
};

const DAY_OF_WEEK_FROM_PROTO: Record<ProtoDayOfWeek, DayOfWeek> = {
  [ProtoDayOfWeek.UNSPECIFIED]: "monday",
  [ProtoDayOfWeek.MONDAY]: "monday",
  [ProtoDayOfWeek.TUESDAY]: "tuesday",
  [ProtoDayOfWeek.WEDNESDAY]: "wednesday",
  [ProtoDayOfWeek.THURSDAY]: "thursday",
  [ProtoDayOfWeek.FRIDAY]: "friday",
  [ProtoDayOfWeek.SATURDAY]: "saturday",
  [ProtoDayOfWeek.SUNDAY]: "sunday",
};

const DAY_OF_WEEK_TO_PROTO: Record<DayOfWeek, ProtoDayOfWeek> = {
  monday: ProtoDayOfWeek.MONDAY,
  tuesday: ProtoDayOfWeek.TUESDAY,
  wednesday: ProtoDayOfWeek.WEDNESDAY,
  thursday: ProtoDayOfWeek.THURSDAY,
  friday: ProtoDayOfWeek.FRIDAY,
  saturday: ProtoDayOfWeek.SATURDAY,
  sunday: ProtoDayOfWeek.SUNDAY,
};

const ATTENDEE_STATUS_FROM_PROTO: Record<ProtoAttendeeStatus, AttendeeStatus> = {
  [ProtoAttendeeStatus.UNSPECIFIED]: "pending",
  [ProtoAttendeeStatus.PENDING]: "pending",
  [ProtoAttendeeStatus.ACCEPTED]: "accepted",
  [ProtoAttendeeStatus.TENTATIVE]: "tentative",
  [ProtoAttendeeStatus.DECLINED]: "declined",
};

const ATTENDEE_STATUS_TO_PROTO: Record<AttendeeStatus, ProtoAttendeeStatus> = {
  pending: ProtoAttendeeStatus.PENDING,
  accepted: ProtoAttendeeStatus.ACCEPTED,
  tentative: ProtoAttendeeStatus.TENTATIVE,
  declined: ProtoAttendeeStatus.DECLINED,
};

const ATTENDEE_ROLE_FROM_PROTO: Record<ProtoAttendeeRole, AttendeeRole> = {
  [ProtoAttendeeRole.UNSPECIFIED]: "required",
  [ProtoAttendeeRole.ORGANIZER]: "organizer",
  [ProtoAttendeeRole.REQUIRED]: "required",
  [ProtoAttendeeRole.OPTIONAL]: "optional",
};

const ATTENDEE_ROLE_TO_PROTO: Record<AttendeeRole, ProtoAttendeeRole> = {
  organizer: ProtoAttendeeRole.ORGANIZER,
  required: ProtoAttendeeRole.REQUIRED,
  optional: ProtoAttendeeRole.OPTIONAL,
};

const RESOURCE_TYPE_FROM_PROTO: Record<ProtoResourceType, ResourceType> = {
  [ProtoResourceType.UNSPECIFIED]: "note",
  [ProtoResourceType.NOTE]: "note",
  [ProtoResourceType.FILE]: "file",
  [ProtoResourceType.CHAT]: "chat",
};

const EVENT_STATUS_FROM_PROTO: Record<ProtoEventStatus, EventStatus> = {
  [ProtoEventStatus.UNSPECIFIED]: "confirmed",
  [ProtoEventStatus.CONFIRMED]: "confirmed",
  [ProtoEventStatus.TENTATIVE]: "tentative",
  [ProtoEventStatus.CANCELLED]: "cancelled",
};

const EVENT_STATUS_TO_PROTO: Record<EventStatus, ProtoEventStatus> = {
  confirmed: ProtoEventStatus.CONFIRMED,
  tentative: ProtoEventStatus.TENTATIVE,
  cancelled: ProtoEventStatus.CANCELLED,
};

const EVENT_VISIBILITY_FROM_PROTO: Record<ProtoEventVisibility, EventVisibility> = {
  [ProtoEventVisibility.UNSPECIFIED]: "standard",
  [ProtoEventVisibility.STANDARD]: "standard",
  [ProtoEventVisibility.PRIVATE]: "private",
};

const EVENT_VISIBILITY_TO_PROTO: Record<EventVisibility, ProtoEventVisibility> = {
  standard: ProtoEventVisibility.STANDARD,
  private: ProtoEventVisibility.PRIVATE,
};

const EVENT_TRANSPARENCY_FROM_PROTO: Record<ProtoEventTransparency, EventTransparency> = {
  [ProtoEventTransparency.UNSPECIFIED]: "opaque",
  [ProtoEventTransparency.OPAQUE]: "opaque",
  [ProtoEventTransparency.TRANSPARENT]: "transparent",
};

const EVENT_TRANSPARENCY_TO_PROTO: Record<EventTransparency, ProtoEventTransparency> = {
  opaque: ProtoEventTransparency.OPAQUE,
  transparent: ProtoEventTransparency.TRANSPARENT,
};

const EDIT_SCOPE_TO_PROTO: Record<RecurrenceEditScope, ProtoRecurrenceEditScope> = {
  this_event: ProtoRecurrenceEditScope.THIS_EVENT,
  all_events: ProtoRecurrenceEditScope.ALL_EVENTS,
  this_and_following: ProtoRecurrenceEditScope.THIS_AND_FOLLOWING,
};

const attendeeFromProto = (proto: ProtoAttendee): Attendee => ({
  id: proto.id,
  name: proto.name,
  email: proto.email,
  avatarUrl: proto.avatarUrl || undefined,
  initials: proto.initials,
  status: ATTENDEE_STATUS_FROM_PROTO[proto.status] || "pending",
  role: ATTENDEE_ROLE_FROM_PROTO[proto.role] || "required",
  timezone: proto.timezone || undefined,
  invitedViaGroupId: proto.invitedViaGroupId || undefined,
});

const linkedResourceFromProto = (proto: ProtoLinkedResource): LinkedResource => ({
  id: proto.id,
  type: RESOURCE_TYPE_FROM_PROTO[proto.type] || "note",
  name: proto.name,
  url: proto.url || undefined,
});

const recurrenceConfigFromProto = (
  proto: ProtoRecurrenceConfig | undefined,
): RecurrenceConfig | undefined => {
  if (!proto) return undefined;

  return {
    pattern: RECURRENCE_FROM_PROTO[proto.pattern] || "none",
    interval: proto.interval || 1,
    daysOfWeek: proto.daysOfWeek?.map((d) => DAY_OF_WEEK_FROM_PROTO[d] || "monday"),
    dayOfMonth: proto.dayOfMonth || undefined,
    endDate: proto.endDate ? timestampToIso(proto.endDate) : undefined,
    maxOccurrences: proto.maxOccurrences || undefined,
  };
};

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
  channelId: proto.channelId || undefined,
  channelAutoCreated: proto.channelAutoCreated || undefined,
  calendarId: proto.calendarId,
  categoryId: proto.categoryId || "",
  organizerId: proto.organizerId,
  attendees: proto.attendees.map(attendeeFromProto),
  recurrence: recurrenceConfigFromProto(proto.recurrence),
  isFocusTime: proto.isFocusTime,
  tagIds: proto.tags.map((tag) => tag.id),
  linkedResources: proto.linkedResources.map(linkedResourceFromProto),
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
  reminders: [...(proto.reminders || [])],
  isRecurring: proto.isRecurring || false,
  recurrenceId: proto.recurrenceId || undefined,
  occurrenceDate: proto.occurrenceDate || undefined,
  roomId: proto.roomId || undefined,
  roomName: proto.roomName || undefined,
  roomLocation: proto.roomLocation || undefined,
  roomCapacity: proto.roomCapacity || undefined,
  roomAmenities: proto.roomAmenities?.length ? [...proto.roomAmenities] : undefined,
  userRole: proto.userRole,
  status: EVENT_STATUS_FROM_PROTO[proto.status] || "confirmed",
  visibility: EVENT_VISIBILITY_FROM_PROTO[proto.visibility] || "standard",
  transparency: EVENT_TRANSPARENCY_FROM_PROTO[proto.transparency] || "opaque",
  isOutOfOffice: proto.isOutOfOffice,
  detailsHidden: proto.detailsHidden,
});

/** Push hydrated tag rows into tags-slice cache so chips render without a follow-up RPC. */
const hydrateEventTags = (proto: ProtoCalendarEvent, dispatch: (action: unknown) => void): void => {
  if (!proto.tags.length) return;
  dispatch(bulkUpsertTags(proto.tags.map(tagToPlain)));
};

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

const templateFromProto = (proto: ProtoEventTemplate): EventTemplate => ({
  id: proto.id,
  organizationId: proto.organizationId,
  title: proto.title,
  description: proto.description,
  durationMinutes: proto.durationMinutes,
  location: proto.location || "",
  meetingUrl: proto.meetingUrl,
  categoryId: proto.categoryId,
  tags: proto.tags,
  visibility: proto.accessMode,
  createdBy: proto.createdBy,
  createdAt: proto.createdAt ? timestampDate(proto.createdAt) : new Date(),
  updatedAt: proto.updatedAt ? timestampDate(proto.updatedAt) : new Date(),
});

export const fetchEventsInRange = createAsyncThunk<
  CalendarEvent[],
  { startDate: string; endDate: string; calendarIds?: string[] },
  { state: RootState; rejectValue: string }
>("calendar/fetchEventsInRange", async (params, { dispatch, getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getEventsInRange({
      organizationId,
      startDate: isoToTimestamp(params.startDate),
      endDate: isoToTimestamp(params.endDate),
      calendarIds: params.calendarIds || [],
    });
    const upserts = response.events.flatMap((proto) => proto.tags).map(tagToPlain);
    if (upserts.length > 0) {
      dispatch(bulkUpsertTags(upserts));
    }
    return response.events.map(eventFromProto);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch events");
  }
});

export const fetchEvent = createAsyncThunk<
  CalendarEvent,
  string,
  { state: RootState; rejectValue: string }
>("calendar/fetchEvent", async (eventId, { dispatch, getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getEvent({
      eventId,
      organizationId,
    });
    if (!response.event) {
      return rejectWithValue("Event not found");
    }
    hydrateEventTags(response.event, dispatch);
    return eventFromProto(response.event);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch event");
  }
});

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
    channelId?: string;
    channelAutoCreated?: boolean;
    calendarId: string;
    categoryId?: string;
    attendeeIds?: string[];
    attendees?: { userId: string; role: AttendeeRole }[];
    recurrence?: RecurrenceConfig;
    isFocusTime?: boolean;
    tagIds?: string[];
    reminders?: number[];
    roomId?: string;
    status?: EventStatus;
    visibility?: EventVisibility;
    transparency?: EventTransparency;
    isOutOfOffice?: boolean;
  },
  { state: RootState; rejectValue: string; dispatch: typeof import("@/app/store").store.dispatch }
>("calendar/createEvent", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());

    const recurrence = params.recurrence;
    const isRecurring = recurrence && recurrence.pattern !== "none";
    let recurrenceConfig = undefined;
    if (isRecurring) {
      recurrenceConfig = {
        pattern: RECURRENCE_TO_PROTO[recurrence.pattern],
        interval: recurrence.interval || 1,
        daysOfWeek: recurrence.daysOfWeek?.map((d) => DAY_OF_WEEK_TO_PROTO[d]),
        dayOfMonth: recurrence.dayOfMonth,
        endDate: recurrence.endDate ? isoToTimestamp(recurrence.endDate) : undefined,
        maxOccurrences: recurrence.maxOccurrences,
      };
    }

    const response = await calendarApi.createEvent({
      organizationId,
      title: params.title,
      description: params.description || "",
      startTime: isoToTimestamp(params.startTime),
      endTime: isoToTimestamp(params.endTime),
      isAllDay: params.isAllDay || false,
      timezone: params.timezone || getEffectiveTimeZone(),
      location: params.location || "",
      meetingUrl: params.meetingUrl,
      calendarId: params.calendarId,
      categoryId: params.categoryId,
      attendeeIds: params.attendeeIds || [],
      attendees: (params.attendees || []).map((a) => ({
        userId: a.userId,
        role: ATTENDEE_ROLE_TO_PROTO[a.role],
      })),
      recurrence: recurrenceConfig,
      isFocusTime: params.isFocusTime || false,
      tagIds: params.tagIds || [],
      reminders: params.reminders || [],
      roomId: params.roomId || undefined,
      channelId: params.channelId,
      channelAutoCreated: params.channelAutoCreated,
      status: params.status ? EVENT_STATUS_TO_PROTO[params.status] : undefined,
      visibility: params.visibility ? EVENT_VISIBILITY_TO_PROTO[params.visibility] : undefined,
      transparency: params.transparency
        ? EVENT_TRANSPARENCY_TO_PROTO[params.transparency]
        : undefined,
      isOutOfOffice: params.isOutOfOffice || false,
    });

    if (!response.event) {
      return rejectWithValue("Failed to create event");
    }
    hydrateEventTags(response.event, dispatch);
    const created = eventFromProto(response.event);

    // Refetch range so server-expanded occurrences populate.
    if (isRecurring) {
      const currentDate = getState().calendarUi.currentDate;
      const d = new Date(currentDate);
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 2, 0);
      await dispatch(
        fetchEventsInRange({
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      );
    }

    return created;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create event");
  }
});

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
    channelId?: string;
    channelAutoCreated?: boolean;
    calendarId?: string;
    categoryId?: string;
    attendeeIds?: string[];
    recurrence?: RecurrenceConfig;
    isFocusTime?: boolean;
    tagIds?: string[];
    reminders?: number[];
    recurrenceEditScope?: RecurrenceEditScope;
    occurrenceDate?: string;
    roomId?: string;
    status?: EventStatus;
    visibility?: EventVisibility;
    transparency?: EventTransparency;
    isOutOfOffice?: boolean;
  },
  { state: RootState; rejectValue: string; dispatch: typeof import("@/app/store").store.dispatch }
>("calendar/updateEvent", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());

    let recurrenceConfig = undefined;
    if (params.recurrence) {
      recurrenceConfig = {
        pattern: RECURRENCE_TO_PROTO[params.recurrence.pattern],
        interval: params.recurrence.interval || 1,
        daysOfWeek: params.recurrence.daysOfWeek?.map((d) => DAY_OF_WEEK_TO_PROTO[d]),
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
      tagIds: params.tagIds !== undefined ? { ids: params.tagIds } : undefined,
      reminders: params.reminders,
      recurrenceEditScope: params.recurrenceEditScope
        ? EDIT_SCOPE_TO_PROTO[params.recurrenceEditScope]
        : undefined,
      occurrenceDate: params.occurrenceDate,
      roomId: params.roomId,
      channelId: params.channelId,
      channelAutoCreated: params.channelAutoCreated,
      status: params.status ? EVENT_STATUS_TO_PROTO[params.status] : undefined,
      visibility: params.visibility ? EVENT_VISIBILITY_TO_PROTO[params.visibility] : undefined,
      transparency: params.transparency
        ? EVENT_TRANSPARENCY_TO_PROTO[params.transparency]
        : undefined,
      isOutOfOffice: params.isOutOfOffice,
    });

    if (!response.event) {
      return rejectWithValue("Failed to update event");
    }
    hydrateEventTags(response.event, dispatch);
    const updated = eventFromProto(response.event);

    // Refetch range so updated expansion lands in the store.
    if (params.recurrenceEditScope) {
      const currentDate = getState().calendarUi.currentDate;
      const d = new Date(currentDate);
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 2, 0);
      await dispatch(
        fetchEventsInRange({
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      );
    }

    dispatch(fetchEventActivities(params.eventId));

    return updated;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update event");
  }
});

export const deleteEvent = createAsyncThunk<
  { eventId: string },
  { eventId: string; recurrenceEditScope?: RecurrenceEditScope; occurrenceDate?: string },
  { state: RootState; rejectValue: string; dispatch: typeof import("@/app/store").store.dispatch }
>("calendar/deleteEvent", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.deleteEvent({
      eventId: params.eventId,
      organizationId,
      recurrenceEditScope: params.recurrenceEditScope
        ? EDIT_SCOPE_TO_PROTO[params.recurrenceEditScope]
        : undefined,
      occurrenceDate: params.occurrenceDate,
    });
    if (!response.success) {
      return rejectWithValue("Failed to delete event");
    }

    // Refetch range so updated expansion lands in the store.
    if (params.recurrenceEditScope) {
      const currentDate = getState().calendarUi.currentDate;
      const d = new Date(currentDate);
      const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 2, 0);
      await dispatch(
        fetchEventsInRange({
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      );
    }

    return { eventId: params.eventId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete event");
  }
});

export const fetchCategories = createAsyncThunk<
  Category[],
  void,
  { state: RootState; rejectValue: string }
>("calendar/fetchCategories", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listCategories({
      organizationId,
    });
    return response.categories.map(categoryFromProto);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch categories");
  }
});

export const createCategory = createAsyncThunk<
  Category,
  {
    name: string;
    color: string;
    icon?: string;
  },
  { state: RootState; rejectValue: string }
>("calendar/createCategory", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.createCategory({
      organizationId,
      name: params.name,
      color: params.color,
      icon: params.icon,
    });
    if (!response.category) {
      return rejectWithValue("Failed to create category");
    }
    return categoryFromProto(response.category);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create category");
  }
});

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
>("calendar/updateCategory", async (params, { getState, rejectWithValue }) => {
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
      return rejectWithValue("Failed to update category");
    }
    return categoryFromProto(response.category);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update category");
  }
});

export const deleteCategory = createAsyncThunk<
  { categoryId: string },
  string,
  { state: RootState; rejectValue: string }
>("calendar/deleteCategory", async (categoryId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.deleteCategory({
      categoryId,
      organizationId,
    });
    if (!response.success) {
      return rejectWithValue("Failed to delete category");
    }
    return { categoryId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete category");
  }
});

export const updateAttendeeStatus = createAsyncThunk<
  { eventId: string; userId: string; status: AttendeeStatus },
  { eventId: string; status: AttendeeStatus },
  { state: RootState; rejectValue: string }
>("calendar/updateAttendeeStatus", async (params, { getState, rejectWithValue, dispatch }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const userId = getState().auth.user?.id;
    if (!userId) {
      return rejectWithValue("No user logged in");
    }

    const response = await calendarApi.updateAttendeeStatus({
      eventId: params.eventId,
      organizationId,
      status: ATTENDEE_STATUS_TO_PROTO[params.status],
    });

    if (!response.success) {
      return rejectWithValue("Failed to update attendee status");
    }

    // Ensure full event lands in the store (notification accept may target an unloaded event).
    dispatch(fetchEvent(params.eventId));
    dispatch(fetchEventActivities(params.eventId));

    return {
      eventId: params.eventId,
      userId,
      status: params.status,
    };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to update attendee status",
    );
  }
});

export const addAttendees = createAsyncThunk<
  CalendarEvent,
  { eventId: string; userIds: string[]; role?: AttendeeRole },
  { state: RootState; rejectValue: string }
>("calendar/addAttendees", async (params, { dispatch, getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.addAttendees({
      eventId: params.eventId,
      organizationId,
      userIds: params.userIds,
      role: ATTENDEE_ROLE_TO_PROTO[params.role || "required"],
    });
    if (!response.event) {
      return rejectWithValue("Failed to add attendees");
    }
    hydrateEventTags(response.event, dispatch);
    return eventFromProto(response.event);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to add attendees");
  }
});

export const removeAttendees = createAsyncThunk<
  CalendarEvent,
  { eventId: string; userIds: string[] },
  { state: RootState; rejectValue: string }
>("calendar/removeAttendees", async (params, { dispatch, getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.removeAttendees({
      eventId: params.eventId,
      organizationId,
      userIds: params.userIds,
    });
    if (!response.event) {
      return rejectWithValue("Failed to remove attendees");
    }
    hydrateEventTags(response.event, dispatch);
    return eventFromProto(response.event);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to remove attendees");
  }
});

export const createEventTemplate = createAsyncThunk<
  EventTemplate,
  CreateTemplatePayload,
  { state: RootState; rejectValue: string }
>("calendar/createTemplate", async (params, { getState, rejectWithValue }) => {
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
      accessMode: params.visibility ?? AccessMode.OWNER_ONLY,
    });
    if (!response.template) {
      return rejectWithValue("Failed to create template");
    }
    return templateFromProto(response.template);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create template");
  }
});

export const getEventTemplate = createAsyncThunk<
  EventTemplate,
  string,
  { state: RootState; rejectValue: string }
>("calendar/getTemplate", async (templateId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getEventTemplate({
      templateId,
      organizationId,
    });
    if (!response.template) {
      return rejectWithValue("Failed to get template");
    }
    return templateFromProto(response.template);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to get template");
  }
});

export const updateEventTemplate = createAsyncThunk<
  EventTemplate,
  UpdateTemplatePayload,
  { state: RootState; rejectValue: string }
>("calendar/updateTemplate", async (params, { getState, rejectWithValue }) => {
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
      accessMode: params.visibility,
    });
    if (!response.template) {
      return rejectWithValue("Failed to update template");
    }
    return templateFromProto(response.template);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update template");
  }
});

export const deleteEventTemplate = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("calendar/deleteTemplate", async (templateId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await calendarApi.deleteEventTemplate({
      templateId,
      organizationId,
    });
    return templateId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete template");
  }
});

export const listEventTemplates = createAsyncThunk<
  EventTemplate[],
  void,
  { state: RootState; rejectValue: string }
>("calendar/listTemplates", async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.listEventTemplates({
      organizationId,
    });
    return (response.templates || []).map(templateFromProto);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to list templates");
  }
});

export const fetchEventActivities = createAsyncThunk<
  { eventId: string; activities: EventActivity[] },
  string,
  { state: RootState; rejectValue: string }
>("calendar/fetchEventActivities", async (eventId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const activities = await calendarApi.listEventActivities({
      eventId,
      organizationId,
    });
    return { eventId, activities };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch activity");
  }
});

const busyIntervalFromProto = (proto: ProtoBusyInterval): SchedulingBusyInterval => ({
  start: timestampToIso(proto.startTime),
  end: timestampToIso(proto.endTime),
  isOutOfOffice: proto.isOutOfOffice,
});

export interface FreeBusyParams {
  userIds: string[];
  windowStart: string;
  windowEnd: string;
  roomId?: string;
}

export const freeBusyKey = (params: FreeBusyParams): string =>
  [params.userIds.join(","), params.windowStart, params.windowEnd, params.roomId ?? ""].join("|");

export const fetchFreeBusy = createAsyncThunk<
  { key: string; data: FreeBusyData },
  FreeBusyParams,
  { state: RootState; rejectValue: string }
>("calendar/fetchFreeBusy", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.getFreeBusy({
      organizationId,
      userIds: params.userIds,
      windowStart: isoToTimestamp(params.windowStart),
      windowEnd: isoToTimestamp(params.windowEnd),
      roomId: params.roomId,
    });
    return {
      key: freeBusyKey(params),
      data: {
        users: response.users.map((user) => ({
          userId: user.userId,
          intervals: user.intervals.map(busyIntervalFromProto),
          timezone: user.timezone,
          workdayStart: user.workdayStart,
          workdayEnd: user.workdayEnd,
          workdays: [...user.workdays],
        })),
        roomBusy: response.roomBusy.map(busyIntervalFromProto),
      },
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch free/busy");
  }
});

export interface SuggestTimesParams {
  requiredUserIds: string[];
  optionalUserIds: string[];
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  roomId?: string;
  maxResults?: number;
}

export const fetchMeetingSuggestions = createAsyncThunk<
  MeetingSuggestion[],
  SuggestTimesParams,
  { state: RootState; rejectValue: string }
>("calendar/fetchMeetingSuggestions", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await calendarApi.suggestMeetingTimes({
      organizationId,
      requiredUserIds: params.requiredUserIds,
      optionalUserIds: params.optionalUserIds,
      windowStart: isoToTimestamp(params.windowStart),
      windowEnd: isoToTimestamp(params.windowEnd),
      durationMinutes: params.durationMinutes,
      roomId: params.roomId,
      maxResults: params.maxResults ?? 5,
    });
    return response.suggestions.map((s) => ({
      start: timestampToIso(s.startTime),
      end: timestampToIso(s.endTime),
      unavailableOptionalUserIds: [...s.unavailableOptionalUserIds],
    }));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to suggest times");
  }
});

export const updateAttendeeRole = createAsyncThunk<
  { eventId: string; userId: string; role: AttendeeRole },
  { eventId: string; userId: string; role: AttendeeRole },
  { state: RootState; rejectValue: string }
>("calendar/updateAttendeeRole", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await calendarApi.updateAttendeeRole({
      eventId: params.eventId,
      organizationId,
      userId: params.userId,
      role: ATTENDEE_ROLE_TO_PROTO[params.role],
    });
    return params;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to update attendee role",
    );
  }
});
