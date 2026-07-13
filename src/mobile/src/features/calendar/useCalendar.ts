import { useQuery } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { useAuth } from "@core/providers/auth-context";
import { calendarApi } from "@features/calendar/calendarApi";
import { eventToPlain, categoryToPlain } from "@features/calendar/calendarSerializer";

function isoToTimestamp(iso: string) {
  const date = new Date(iso);
  return create(TimestampSchema, {
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
