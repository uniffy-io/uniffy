import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AttendeeRole,
  DayOfWeek,
  EventStatus,
  EventTransparency,
  EventVisibility,
  RecurrenceEditScope,
  RecurrencePattern,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { useAuth } from "@core/providers/AuthContext";
import { calendarApi } from "@features/calendar/calendarApi";
import { calendarsQueryKey } from "@features/calendar/useCalendar";
import { userFacingError } from "@shared/lib/userFacingError";
import type {
  AttendeeRoleValue,
  EventStatusValue,
  SerializedCalendar,
  EventTransparencyValue,
  EventVisibilityValue,
  SerializedRecurrence,
} from "@features/calendar/calendarSerializer";

function isoToTimestamp(iso: string) {
  const date = new Date(iso);
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(date.getTime() / 1000)),
    nanos: 0,
  });
}

const PATTERN_TO_PROTO: Record<string, RecurrencePattern> = {
  NONE: RecurrencePattern.NONE,
  DAILY: RecurrencePattern.DAILY,
  WEEKLY: RecurrencePattern.WEEKLY,
  BIWEEKLY: RecurrencePattern.BIWEEKLY,
  MONTHLY: RecurrencePattern.MONTHLY,
  YEARLY: RecurrencePattern.YEARLY,
};

const DAY_TO_PROTO: Record<string, DayOfWeek> = {
  monday: DayOfWeek.MONDAY,
  tuesday: DayOfWeek.TUESDAY,
  wednesday: DayOfWeek.WEDNESDAY,
  thursday: DayOfWeek.THURSDAY,
  friday: DayOfWeek.FRIDAY,
  saturday: DayOfWeek.SATURDAY,
  sunday: DayOfWeek.SUNDAY,
};

const STATUS_TO_PROTO: Record<EventStatusValue, EventStatus> = {
  confirmed: EventStatus.CONFIRMED,
  tentative: EventStatus.TENTATIVE,
  cancelled: EventStatus.CANCELLED,
};

const VISIBILITY_TO_PROTO: Record<EventVisibilityValue, EventVisibility> = {
  standard: EventVisibility.STANDARD,
  private: EventVisibility.PRIVATE,
};

const TRANSPARENCY_TO_PROTO: Record<EventTransparencyValue, EventTransparency> = {
  opaque: EventTransparency.OPAQUE,
  transparent: EventTransparency.TRANSPARENT,
};

const ROLE_TO_PROTO: Record<AttendeeRoleValue, AttendeeRole> = {
  organizer: AttendeeRole.ORGANIZER,
  required: AttendeeRole.REQUIRED,
  optional: AttendeeRole.OPTIONAL,
};

function recurrenceToProto(recurrence: SerializedRecurrence) {
  return {
    pattern: PATTERN_TO_PROTO[recurrence.pattern] ?? RecurrencePattern.NONE,
    interval: recurrence.interval,
    daysOfWeek: recurrence.daysOfWeek
      .map((d) => DAY_TO_PROTO[d])
      .filter((d): d is DayOfWeek => d !== undefined),
    dayOfMonth: recurrence.dayOfMonth,
    endDate: recurrence.endDate ? isoToTimestamp(recurrence.endDate) : undefined,
    maxOccurrences: recurrence.maxOccurrences,
  };
}

export function useCreateEvent() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
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
      /** Omitted = the member's default calendar. */
      calendarId?: string;
      categoryId?: string;
      attendeeIds?: string[];
      attendees?: { userId: string; role?: AttendeeRoleValue }[];
      tagIds?: string[];
      isFocusTime?: boolean;
      /** Omitted or empty = the server applies the user's reminder defaults. */
      reminders?: number[];
      recurrence?: SerializedRecurrence;
      roomId?: string;
      status?: EventStatusValue;
      visibility?: EventVisibilityValue;
      transparency?: EventTransparencyValue;
      isOutOfOffice?: boolean;
    }) =>
      calendarApi.createEvent({
        organizationId: organizationId!,
        title: args.title,
        description: args.description,
        startTime: isoToTimestamp(args.startTime),
        endTime: isoToTimestamp(args.endTime),
        isAllDay: args.isAllDay ?? false,
        timezone: args.timezone,
        location: args.location,
        meetingUrl: args.meetingUrl,
        channelId: args.channelId,
        channelAutoCreated: args.channelAutoCreated,
        calendarId: args.calendarId ?? "",
        categoryId: args.categoryId,
        attendeeIds: args.attendeeIds ?? [],
        attendees: (args.attendees ?? []).map((a) => ({
          userId: a.userId,
          role: ROLE_TO_PROTO[a.role ?? "required"],
        })),
        tagIds: args.tagIds ?? [],
        isFocusTime: args.isFocusTime ?? false,
        reminders: args.reminders ?? [],
        recurrence: args.recurrence ? recurrenceToProto(args.recurrence) : undefined,
        roomId: args.roomId,
        // UNSPECIFIED (unset) lets the server apply its defaults.
        status: args.status ? STATUS_TO_PROTO[args.status] : undefined,
        visibility: args.visibility ? VISIBILITY_TO_PROTO[args.visibility] : undefined,
        transparency: args.transparency ? TRANSPARENCY_TO_PROTO[args.transparency] : undefined,
        isOutOfOffice: args.isOutOfOffice ?? false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
    },
  });
}

export function useUpdateEvent() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      eventId: string;
      title?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
      isAllDay?: boolean;
      location?: string;
      meetingUrl?: string;
      channelId?: string;
      channelAutoCreated?: boolean;
      /** Moves the whole series; undefined leaves it where it is. */
      calendarId?: string;
      categoryId?: string;
      recurrenceEditScope?: RecurrenceEditScope;
      occurrenceDate?: string;
      isFocusTime?: boolean;
      /** Replacement set; undefined leaves reminders untouched, [] clears them. */
      reminders?: number[];
      recurrence?: SerializedRecurrence;
      /** "" clears the room, undefined leaves it untouched. */
      roomId?: string;
      /** Replacement set; undefined leaves tags untouched, [] clears them. */
      tagIds?: string[];
      status?: EventStatusValue;
      visibility?: EventVisibilityValue;
      transparency?: EventTransparencyValue;
      isOutOfOffice?: boolean;
    }) =>
      calendarApi.updateEvent({
        organizationId: organizationId!,
        eventId: args.eventId,
        // The backend applies a scope only when it is told WHICH occurrence the
        // edit started from, so the pair travels together or not at all.
        recurrenceEditScope: args.occurrenceDate ? args.recurrenceEditScope : undefined,
        occurrenceDate: args.recurrenceEditScope ? args.occurrenceDate : undefined,
        title: args.title,
        description: args.description,
        startTime: args.startTime ? isoToTimestamp(args.startTime) : undefined,
        endTime: args.endTime ? isoToTimestamp(args.endTime) : undefined,
        isAllDay: args.isAllDay,
        location: args.location,
        meetingUrl: args.meetingUrl,
        channelId: args.channelId,
        channelAutoCreated: args.channelAutoCreated,
        calendarId: args.calendarId,
        categoryId: args.categoryId,
        isFocusTime: args.isFocusTime,
        reminders: args.reminders ?? [],
        clearReminders: args.reminders !== undefined && args.reminders.length === 0,
        recurrence: args.recurrence ? recurrenceToProto(args.recurrence) : undefined,
        roomId: args.roomId,
        tagIds: args.tagIds !== undefined ? { ids: args.tagIds } : undefined,
        status: args.status ? STATUS_TO_PROTO[args.status] : undefined,
        visibility: args.visibility ? VISIBILITY_TO_PROTO[args.visibility] : undefined,
        transparency: args.transparency ? TRANSPARENCY_TO_PROTO[args.transparency] : undefined,
        isOutOfOffice: args.isOutOfOffice,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      // Prefix match: the entry on screen may be keyed by an occurrence's
      // synthetic `{masterId}__occurrence__{date}` id while the mutation was
      // given the master id the server resolved it to.
      queryClient.invalidateQueries({ queryKey: ["event", organizationId] });
    },
  });
}

export function useDeleteEvent() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      eventId: string;
      recurrenceEditScope?: RecurrenceEditScope;
      occurrenceDate?: string;
    }) =>
      calendarApi.deleteEvent({
        eventId: args.eventId,
        organizationId: organizationId!,
        recurrenceEditScope: args.occurrenceDate ? args.recurrenceEditScope : undefined,
        occurrenceDate: args.recurrenceEditScope ? args.occurrenceDate : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      // A scoped delete leaves the series alive, so the cached detail entries
      // have to be dropped rather than assumed gone with the screen.
      queryClient.invalidateQueries({ queryKey: ["event", organizationId] });
    },
  });
}

export function useAddAttendees() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; userIds: string[] }) =>
      calendarApi.addAttendees({
        organizationId: organizationId!,
        eventId: args.eventId,
        userIds: args.userIds,
        role: AttendeeRole.REQUIRED,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      // Prefix match, not the exact key: an occurrence of a recurring event is
      // cached under its synthetic `{masterId}__occurrence__{date}` id, so the
      // entry the user is looking at need not be the one keyed by the id the
      // mutation was given.
      queryClient.invalidateQueries({ queryKey: ["event", organizationId] });
    },
  });
}

export function useRemoveAttendees() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; userIds: string[] }) =>
      calendarApi.removeAttendees({
        organizationId: organizationId!,
        eventId: args.eventId,
        userIds: args.userIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      queryClient.invalidateQueries({ queryKey: ["event", organizationId] });
    },
  });
}

export function useCreateCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { name: string; color: string; icon?: string }) =>
      calendarApi.createCategory({
        organizationId: organizationId!,
        name: args.name,
        color: args.color,
        icon: args.icon,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-categories"] });
    },
  });
}

export function useUpdateCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      categoryId: string;
      name?: string;
      color?: string;
      icon?: string;
      sortOrder?: number;
    }) =>
      calendarApi.updateCategory({
        organizationId: organizationId!,
        categoryId: args.categoryId,
        name: args.name,
        color: args.color,
        icon: args.icon,
        sortOrder: args.sortOrder,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-categories"] });
    },
  });
}

export function useDeleteCategory() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryId: string) =>
      calendarApi.deleteCategory({
        categoryId,
        organizationId: organizationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-categories"] });
    },
  });
}

export function useCreateEventTemplate() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      title: string;
      description?: string;
      durationMinutes: number;
      location?: string;
      meetingUrl?: string;
      categoryId?: string;
    }) =>
      calendarApi.createEventTemplate({
        organizationId: organizationId!,
        title: args.title,
        description: args.description ?? "",
        durationMinutes: args.durationMinutes,
        location: args.location ?? "",
        meetingUrl: args.meetingUrl ?? "",
        categoryId: args.categoryId ?? "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-templates"] });
    },
  });
}

export function useUpdateAttendeeStatus() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; status: number }) =>
      calendarApi.updateAttendeeStatus({
        eventId: args.eventId,
        organizationId: organizationId!,
        status: args.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      // Prefix match: the entry on screen may be keyed by an occurrence's
      // synthetic `{masterId}__occurrence__{date}` id, not the master id the
      // mutation was given.
      queryClient.invalidateQueries({ queryKey: ["event", organizationId] });
    },
  });
}

const VISIBILITY_MUTATION_KEY = ["calendar-visibility"];

/**
 * Hiding is per member and server-side: range reads leave a hidden calendar's
 * events out, so the grid refetches rather than filtering locally. Toggles run
 * one at a time in tap order so the last tap is the one the server keeps.
 */
export function useSetCalendarVisibility() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = calendarsQueryKey(organizationId);

  return useMutation({
    mutationKey: VISIBILITY_MUTATION_KEY,
    scope: { id: "calendar-visibility" },
    mutationFn: (args: { calendarId: string; hidden: boolean }) =>
      calendarApi.setCalendarVisibility({
        organizationId: organizationId!,
        calendarId: args.calendarId,
        hidden: args.hidden,
      }),
    onMutate: async (args) => {
      // A list fetch already in flight would land with the old flag and undo the tap.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<SerializedCalendar[]>(key, (calendars) =>
        calendars?.map((calendar) =>
          calendar.id === args.calendarId ? { ...calendar, isHidden: args.hidden } : calendar,
        ),
      );
    },
    onError: (error) => {
      Alert.alert("Could not update calendar", userFacingError(error, "Please try again."));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      // Refetching while later taps are queued would flash them back to the server's older state.
      if (queryClient.isMutating({ mutationKey: VISIBILITY_MUTATION_KEY }) <= 1) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
