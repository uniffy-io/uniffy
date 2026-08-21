import { useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AttendeeRole, RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import { useAuth } from "@core/providers/AuthContext";
import { calendarApi } from "@features/calendar/calendarApi";

function isoToTimestamp(iso: string) {
  const date = new Date(iso);
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(date.getTime() / 1000)),
    nanos: 0,
  });
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
      categoryId?: string;
      attendeeIds?: string[];
      tagIds?: string[];
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
        categoryId: args.categoryId,
        attendeeIds: args.attendeeIds ?? [],
        tagIds: args.tagIds ?? [],
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
      categoryId?: string;
      recurrenceEditScope?: RecurrenceEditScope;
      occurrenceDate?: string;
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
        categoryId: args.categoryId,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      queryClient.invalidateQueries({ queryKey: ["event", organizationId, variables.eventId] });
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
      queryClient.invalidateQueries({ queryKey: ["event", organizationId, variables.eventId] });
    },
  });
}
