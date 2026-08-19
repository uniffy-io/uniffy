import { createAsyncThunk } from "@reduxjs/toolkit";
import { roomsApi } from "@/features/rooms/api/roomsApi";
import type { RootState } from "@/app/store";
import type {
  Room as ProtoRoom,
  RoomBooking as ProtoRoomBooking,
  TimeSlot as ProtoTimeSlot,
} from "@uniffy/proto/rooms/v1/rooms_pb";
import {
  RoomType as ProtoRoomType,
  RoomStatus as ProtoRoomStatus,
  BookingStatus as ProtoBookingStatus,
} from "@uniffy/proto/rooms/v1/rooms_pb";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  Room,
  RoomType,
  RoomStatus,
  RoomBooking,
  BookingStatus,
  TimeSlot,
} from "@/features/rooms/types";
import { DEFAULT_PAGE_SIZE } from "@/features/rooms/constants";

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

const ROOM_TYPE_FROM_PROTO: Record<ProtoRoomType, RoomType> = {
  [ProtoRoomType.UNSPECIFIED]: "meeting_room",
  [ProtoRoomType.MEETING_ROOM]: "meeting_room",
  [ProtoRoomType.CONFERENCE_ROOM]: "conference_room",
  [ProtoRoomType.OFFICE]: "office",
  [ProtoRoomType.OTHER]: "other",
};

const ROOM_TYPE_TO_PROTO: Record<RoomType, ProtoRoomType> = {
  meeting_room: ProtoRoomType.MEETING_ROOM,
  conference_room: ProtoRoomType.CONFERENCE_ROOM,
  office: ProtoRoomType.OFFICE,
  other: ProtoRoomType.OTHER,
};

const ROOM_STATUS_FROM_PROTO: Record<ProtoRoomStatus, RoomStatus> = {
  [ProtoRoomStatus.UNSPECIFIED]: "active",
  [ProtoRoomStatus.ACTIVE]: "active",
  [ProtoRoomStatus.MAINTENANCE]: "maintenance",
  [ProtoRoomStatus.RETIRED]: "retired",
};

const ROOM_STATUS_TO_PROTO: Record<RoomStatus, ProtoRoomStatus> = {
  active: ProtoRoomStatus.ACTIVE,
  maintenance: ProtoRoomStatus.MAINTENANCE,
  retired: ProtoRoomStatus.RETIRED,
};

const BOOKING_STATUS_FROM_PROTO: Record<ProtoBookingStatus, BookingStatus> = {
  [ProtoBookingStatus.UNSPECIFIED]: "confirmed",
  [ProtoBookingStatus.CONFIRMED]: "confirmed",
  [ProtoBookingStatus.CANCELLED]: "cancelled",
};

const BOOKING_STATUS_TO_PROTO: Record<BookingStatus, ProtoBookingStatus> = {
  confirmed: ProtoBookingStatus.CONFIRMED,
  cancelled: ProtoBookingStatus.CANCELLED,
};

function frontendVisibilityToAccessMode(v: "private" | "organization"): {
  accessMode: number;
  baselineRole: number | undefined;
} {
  return v === "organization"
    ? { accessMode: AccessMode.OPEN_TO_ORG, baselineRole: ContentRole.VIEWER }
    : { accessMode: AccessMode.OWNER_ONLY, baselineRole: undefined };
}

function accessModeToFrontendVisibility(mode: number): "private" | "organization" {
  return mode === AccessMode.OPEN_TO_ORG ? "organization" : "private";
}

const roomFromProto = (proto: ProtoRoom): Room => ({
  id: proto.id,
  organizationId: proto.organizationId,
  ownerId: proto.ownerId,
  name: proto.name,
  description: proto.description,
  roomType: ROOM_TYPE_FROM_PROTO[proto.roomType] || "meeting_room",
  status: ROOM_STATUS_FROM_PROTO[proto.status] || "active",
  capacity: proto.capacity,
  floor: proto.floor,
  building: proto.building,
  location: proto.location,
  amenities: [...proto.amenities],
  imageFileId: proto.imageFileId || null,
  visibility: accessModeToFrontendVisibility(proto.accessMode),
  accessMode: proto.accessMode,
  baselineRole: proto.baselineRole ?? null,
  userRole: proto.userRole,
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

const bookingFromProto = (proto: ProtoRoomBooking): RoomBooking => ({
  id: proto.id,
  roomId: proto.roomId,
  organizationId: proto.organizationId,
  userId: proto.userId,
  eventId: proto.eventId || null,
  title: proto.title,
  startTime: timestampToIso(proto.startTime),
  endTime: timestampToIso(proto.endTime),
  status: BOOKING_STATUS_FROM_PROTO[proto.status] || "confirmed",
  notes: proto.notes,
  bookerName: proto.bookerName,
  roomName: proto.roomName,
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

const timeSlotFromProto = (proto: ProtoTimeSlot): TimeSlot => ({
  startTime: timestampToIso(proto.startTime),
  endTime: timestampToIso(proto.endTime),
  isAvailable: proto.isAvailable,
  bookingId: proto.bookingId || null,
  eventTitle: proto.eventTitle,
  bookerName: proto.bookerName,
});

export const fetchRooms = createAsyncThunk<
  { rooms: Room[]; totalCount: number; page: number; pageSize: number; totalPages: number },
  {
    organizationId: string;
    roomType?: RoomType;
    status?: RoomStatus;
    minCapacity?: number;
    amenities?: string[];
    building?: string;
    floor?: string;
    searchQuery?: string;
    page?: number;
    pageSize?: number;
  },
  { state: RootState; rejectValue: string }
>("rooms/fetchRooms", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.listRooms({
      organizationId: params.organizationId,
      roomType: params.roomType ? ROOM_TYPE_TO_PROTO[params.roomType] : undefined,
      status: params.status ? ROOM_STATUS_TO_PROTO[params.status] : undefined,
      minCapacity: params.minCapacity,
      amenities: params.amenities || [],
      building: params.building,
      floor: params.floor,
      searchQuery: params.searchQuery,
      page: params.page || 1,
      pageSize: params.pageSize || DEFAULT_PAGE_SIZE,
    });
    return {
      rooms: response.rooms.map(roomFromProto),
      totalCount: response.totalCount,
      page: response.page,
      pageSize: response.pageSize,
      totalPages: response.totalPages,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch rooms");
  }
});

/** Loads first page then fans out remaining pages in parallel. */
export const initializeRoomsData = createAsyncThunk<
  { rooms: Room[]; totalCount: number },
  {
    organizationId: string;
    roomType?: RoomType;
    status?: RoomStatus;
    minCapacity?: number;
    amenities?: string[];
    building?: string;
    floor?: string;
    searchQuery?: string;
  },
  { state: RootState; rejectValue: string }
>("rooms/initializeRoomsData", async (params, { rejectWithValue }) => {
  try {
    const firstResponse = await roomsApi.listRooms({
      organizationId: params.organizationId,
      roomType: params.roomType ? ROOM_TYPE_TO_PROTO[params.roomType] : undefined,
      status: params.status ? ROOM_STATUS_TO_PROTO[params.status] : undefined,
      minCapacity: params.minCapacity,
      amenities: params.amenities || [],
      building: params.building,
      floor: params.floor,
      searchQuery: params.searchQuery,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    const allRooms = firstResponse.rooms.map(roomFromProto);

    if (firstResponse.totalPages > 1) {
      const remainingPages = Array.from({ length: firstResponse.totalPages - 1 }, (_, i) => i + 2);
      const pageResponses = await Promise.all(
        remainingPages.map((page) =>
          roomsApi.listRooms({
            organizationId: params.organizationId,
            roomType: params.roomType ? ROOM_TYPE_TO_PROTO[params.roomType] : undefined,
            status: params.status ? ROOM_STATUS_TO_PROTO[params.status] : undefined,
            minCapacity: params.minCapacity,
            amenities: params.amenities || [],
            building: params.building,
            floor: params.floor,
            searchQuery: params.searchQuery,
            page,
            pageSize: DEFAULT_PAGE_SIZE,
          }),
        ),
      );
      for (const response of pageResponses) {
        allRooms.push(...response.rooms.map(roomFromProto));
      }
    }

    return { rooms: allRooms, totalCount: firstResponse.totalCount };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load rooms");
  }
});

export const fetchRoom = createAsyncThunk<
  Room,
  { roomId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>("rooms/fetchRoom", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.getRoom({
      roomId: params.roomId,
      organizationId: params.organizationId,
    });
    if (!response.room) {
      return rejectWithValue("Room not found");
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch room");
  }
});

/**
 * Everything the room viewer shows, in one call: the room itself, the coming week's
 * bookings, and today's availability. Kept out of the list-scoped state so opening a
 * room from a mention never disturbs whatever the rooms admin table is showing.
 */
export const openRoomViewer = createAsyncThunk<
  { roomId: string; room: Room; bookings: RoomBooking[]; slots: TimeSlot[] },
  /** `inline` marks the room page, which renders the same state itself, so the modal stays out of its way. */
  { roomId: string; inline?: boolean },
  { state: RootState; rejectValue: string }
>("rooms/openRoomViewer", async ({ roomId }, { getState, rejectWithValue }) => {
  const organizationId = getState().auth.currentOrganizationId;
  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  try {
    const roomResponse = await roomsApi.getRoom({ roomId, organizationId });
    if (!roomResponse.room) {
      return rejectWithValue("Room not found");
    }

    const [bookingsResponse, availabilityResponse] = await Promise.all([
      roomsApi.listBookings({
        organizationId,
        roomId,
        startDate: isoToTimestamp(now.toISOString()),
        endDate: isoToTimestamp(endOfWeek.toISOString()),
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
      roomsApi.checkAvailability({
        organizationId,
        roomId,
        startDate: isoToTimestamp(startOfDay.toISOString()),
        endDate: isoToTimestamp(endOfDay.toISOString()),
      }),
    ]);

    return {
      roomId,
      room: roomFromProto(roomResponse.room),
      bookings: bookingsResponse.bookings.map(bookingFromProto),
      slots: availabilityResponse.slots.map(timeSlotFromProto),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load room");
  }
});

export const createRoom = createAsyncThunk<
  Room,
  {
    organizationId: string;
    name: string;
    description?: string;
    roomType: RoomType;
    capacity: number;
    floor?: string;
    building?: string;
    location?: string;
    amenities?: string[];
    visibility?: string;
    groupIds?: string[];
  },
  { state: RootState; rejectValue: string }
>("rooms/createRoom", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.createRoom({
      organizationId: params.organizationId,
      name: params.name,
      description: params.description,
      roomType: ROOM_TYPE_TO_PROTO[params.roomType],
      capacity: params.capacity,
      floor: params.floor,
      building: params.building,
      location: params.location,
      amenities: params.amenities || [],
      ...(params.visibility
        ? frontendVisibilityToAccessMode(params.visibility as "private" | "organization")
        : {}),
      groupIds: params.groupIds || [],
    });
    if (!response.room) {
      return rejectWithValue("Failed to create room");
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create room");
  }
});

export const updateRoom = createAsyncThunk<
  Room,
  {
    roomId: string;
    organizationId: string;
    name?: string;
    description?: string;
    roomType?: RoomType;
    status?: RoomStatus;
    capacity?: number;
    floor?: string;
    building?: string;
    location?: string;
    amenities?: string[];
    replaceAmenities?: boolean;
    visibility?: string;
  },
  { state: RootState; rejectValue: string }
>("rooms/updateRoom", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.updateRoom({
      roomId: params.roomId,
      organizationId: params.organizationId,
      name: params.name,
      description: params.description,
      roomType: params.roomType ? ROOM_TYPE_TO_PROTO[params.roomType] : undefined,
      status: params.status ? ROOM_STATUS_TO_PROTO[params.status] : undefined,
      capacity: params.capacity,
      floor: params.floor,
      building: params.building,
      location: params.location,
      amenities: params.amenities || [],
      replaceAmenities: params.replaceAmenities || false,
      ...(params.visibility
        ? frontendVisibilityToAccessMode(params.visibility as "private" | "organization")
        : {}),
    });
    if (!response.room) {
      return rejectWithValue("Failed to update room");
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update room");
  }
});

export const deleteRoom = createAsyncThunk<
  { roomId: string },
  { roomId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>("rooms/deleteRoom", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.deleteRoom({
      roomId: params.roomId,
      organizationId: params.organizationId,
    });
    if (!response.success) {
      return rejectWithValue("Failed to delete room");
    }
    return { roomId: params.roomId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete room");
  }
});

export const createBooking = createAsyncThunk<
  RoomBooking,
  {
    organizationId: string;
    roomId: string;
    startTime: string;
    endTime: string;
    title?: string;
    notes?: string;
    eventId?: string;
  },
  { state: RootState; rejectValue: string }
>("rooms/createBooking", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.createBooking({
      organizationId: params.organizationId,
      roomId: params.roomId,
      startTime: isoToTimestamp(params.startTime),
      endTime: isoToTimestamp(params.endTime),
      title: params.title,
      notes: params.notes,
      eventId: params.eventId,
    });
    if (!response.booking) {
      return rejectWithValue("Failed to create booking");
    }
    return bookingFromProto(response.booking);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create booking");
  }
});

export const cancelBooking = createAsyncThunk<
  RoomBooking,
  { bookingId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>("rooms/cancelBooking", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.cancelBooking({
      bookingId: params.bookingId,
      organizationId: params.organizationId,
    });
    if (!response.booking) {
      return rejectWithValue("Failed to cancel booking");
    }
    return bookingFromProto(response.booking);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to cancel booking");
  }
});

export const fetchBookings = createAsyncThunk<
  {
    bookings: RoomBooking[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  },
  {
    organizationId: string;
    roomId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    status?: BookingStatus;
    page?: number;
    pageSize?: number;
  },
  { state: RootState; rejectValue: string }
>("rooms/fetchBookings", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.listBookings({
      organizationId: params.organizationId,
      roomId: params.roomId,
      userId: params.userId,
      startDate: params.startDate ? isoToTimestamp(params.startDate) : undefined,
      endDate: params.endDate ? isoToTimestamp(params.endDate) : undefined,
      status: params.status ? BOOKING_STATUS_TO_PROTO[params.status] : undefined,
      page: params.page || 1,
      pageSize: params.pageSize || DEFAULT_PAGE_SIZE,
    });
    return {
      bookings: response.bookings.map(bookingFromProto),
      totalCount: response.totalCount,
      page: response.page,
      pageSize: response.pageSize,
      totalPages: response.totalPages,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch bookings");
  }
});

export const checkAvailability = createAsyncThunk<
  { roomId: string; slots: TimeSlot[] },
  { organizationId: string; roomId: string; startDate: string; endDate: string },
  { state: RootState; rejectValue: string }
>("rooms/checkAvailability", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.checkAvailability({
      organizationId: params.organizationId,
      roomId: params.roomId,
      startDate: isoToTimestamp(params.startDate),
      endDate: isoToTimestamp(params.endDate),
    });
    return {
      roomId: params.roomId,
      slots: response.slots.map(timeSlotFromProto),
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to check availability");
  }
});

export const findAvailableRooms = createAsyncThunk<
  Room[],
  {
    organizationId: string;
    startTime: string;
    endTime: string;
    minCapacity?: number;
    amenities?: string[];
    roomType?: RoomType;
  },
  { state: RootState; rejectValue: string }
>("rooms/findAvailableRooms", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.findAvailableRooms({
      organizationId: params.organizationId,
      startTime: isoToTimestamp(params.startTime),
      endTime: isoToTimestamp(params.endTime),
      minCapacity: params.minCapacity,
      amenities: params.amenities || [],
      roomType: params.roomType ? ROOM_TYPE_TO_PROTO[params.roomType] : undefined,
    });
    return response.rooms.map(roomFromProto);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to find available rooms",
    );
  }
});

/** IDs-only fetch for RoomPicker; does not replace the rooms map. */
export const fetchAvailableRoomIds = createAsyncThunk<
  string[],
  {
    organizationId: string;
    startTime: string;
    endTime: string;
  },
  { state: RootState; rejectValue: string }
>("rooms/fetchAvailableRoomIds", async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.findAvailableRooms({
      organizationId: params.organizationId,
      startTime: isoToTimestamp(params.startTime),
      endTime: isoToTimestamp(params.endTime),
    });
    return response.rooms.map((r) => r.id);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to check room availability",
    );
  }
});
