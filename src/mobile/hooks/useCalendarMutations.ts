import { useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { useAuth } from "@/context/auth-context";
import { calendarApi } from "@/api/calendarApi";
import type { VisibilityScope } from "@uniffy/proto/common/v1/common_pb";

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
      calendarId: string;
      categoryId?: string;
      attendeeIds?: string[];
      tags?: string[];
      visibility?: VisibilityScope;
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
        calendarId: args.calendarId,
        categoryId: args.categoryId,
        attendeeIds: args.attendeeIds ?? [],
        tags: args.tags ?? [],
        visibility: args.visibility,
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
      categoryId?: string;
      tags?: string[];
    }) =>
      calendarApi.updateEvent({
        organizationId: organizationId!,
        eventId: args.eventId,
        title: args.title,
        description: args.description,
        startTime: args.startTime ? isoToTimestamp(args.startTime) : undefined,
        endTime: args.endTime ? isoToTimestamp(args.endTime) : undefined,
        isAllDay: args.isAllDay,
        location: args.location,
        meetingUrl: args.meetingUrl,
        categoryId: args.categoryId,
        tags: args.tags,
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
    mutationFn: (eventId: string) =>
      calendarApi.deleteEvent({
        eventId,
        organizationId: organizationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events-range"] });
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
