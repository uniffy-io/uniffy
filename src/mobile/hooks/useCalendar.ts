import { useQuery } from "@tanstack/react-query";
import { Timestamp } from "@bufbuild/protobuf";
import { useAuth } from "@/context/auth-context";
import { calendarApi } from "@/api/calendarApi";
import { eventToPlain, calendarToPlain, categoryToPlain } from "@/lib/calendarSerializer";

function isoToTimestamp(iso: string) {
  const date = new Date(iso);
  return new Timestamp({
    seconds: BigInt(Math.floor(date.getTime() / 1000)),
    nanos: 0,
  });
}

export function useEventsInRange(startDate: string, endDate: string) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["events-range", organizationId, startDate, endDate],
    queryFn: async () => {
      const response = await calendarApi.getEventsInRange({
        organizationId: organizationId!,
        startDate: isoToTimestamp(startDate),
        endDate: isoToTimestamp(endDate),
      });
      return response.events.map(eventToPlain);
    },
    enabled: !!organizationId && !!startDate && !!endDate,
  });
}

export function useEvent(eventId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["event", organizationId, eventId],
    queryFn: async () => {
      const response = await calendarApi.getEvent({
        eventId: eventId!,
        organizationId: organizationId!,
      });
      if (!response.event) throw new Error("Event not found");
      return eventToPlain(response.event);
    },
    enabled: !!organizationId && !!eventId,
  });
}

export function useCalendars() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["calendars", organizationId],
    queryFn: async () => {
      const response = await calendarApi.listCalendars({
        organizationId: organizationId!,
      });
      return response.calendars.map(calendarToPlain);
    },
    enabled: !!organizationId,
  });
}

export function useCategories() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["calendar-categories", organizationId],
    queryFn: async () => {
      const response = await calendarApi.listCategories({
        organizationId: organizationId!,
      });
      return response.categories.map(categoryToPlain);
    },
    enabled: !!organizationId,
  });
}
