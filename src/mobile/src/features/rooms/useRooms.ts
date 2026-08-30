import { useQuery } from "@tanstack/react-query";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { useAuth } from "@core/providers/AuthContext";
import { roomsApi } from "@features/rooms/roomsApi";
import { roomToPlain } from "@features/rooms/roomSerializer";

function isoToTimestamp(iso: string) {
  const date = new Date(iso);
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(date.getTime() / 1000)),
    nanos: 0,
  });
}

export function useRooms() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["rooms", organizationId],
    queryFn: async () => {
      const response = await roomsApi.listRooms({
        organizationId: organizationId!,
        pageSize: 100,
      });
      return response.rooms.map(roomToPlain).filter((room) => room.active);
    },
    enabled: !!organizationId,
  });
}

/** Ids of rooms free for the slot - used to mark busy ones, never to hide them. */
export function useAvailableRoomIds(startIso?: string, endIso?: string) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["rooms-available", organizationId, startIso, endIso],
    queryFn: async () => {
      const response = await roomsApi.findAvailableRooms({
        organizationId: organizationId!,
        startTime: isoToTimestamp(startIso!),
        endTime: isoToTimestamp(endIso!),
      });
      return new Set(response.rooms.map((room) => room.id));
    },
    enabled: !!organizationId && !!startIso && !!endIso,
  });
}
