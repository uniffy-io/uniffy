import type { Room } from "@uniffy/proto/rooms/v1/rooms_pb";
import { RoomStatus } from "@uniffy/proto/rooms/v1/rooms_pb";

export interface SerializedRoom {
  id: string;
  name: string;
  location: string;
  floor: string;
  building: string;
  capacity: number;
  amenities: string[];
  active: boolean;
}

export function roomToPlain(room: Room): SerializedRoom {
  return {
    id: room.id,
    name: room.name,
    location: room.location,
    floor: room.floor,
    building: room.building,
    capacity: room.capacity,
    amenities: [...room.amenities],
    active: room.status === RoomStatus.ACTIVE,
  };
}
