/**
 * Rooms Async Thunks
 *
 * Redux async thunks for room and booking API operations.
 * All async operations go through these thunks for proper state management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { roomsApi } from '@/features/rooms/api/roomsApi';
import type { RootState } from '@/app/store';
import type {
  Room as ProtoRoom,
  RoomBooking as ProtoRoomBooking,
  TimeSlot as ProtoTimeSlot,
} from '@uniffy/proto/rooms/v1/rooms_pb';
import {
  RoomType as ProtoRoomType,
  RoomStatus as ProtoRoomStatus,
  BookingStatus as ProtoBookingStatus,
} from '@uniffy/proto/rooms/v1/rooms_pb';
import { VisibilityScope as ProtoVisibilityScope } from '@uniffy/proto/common/v1/common_pb';
import { Timestamp } from '@bufbuild/protobuf';
import type {
  Room,
  RoomType,
  RoomStatus,
  RoomBooking,
  BookingStatus,
  TimeSlot,
} from '@/features/rooms/types';
import { DEFAULT_PAGE_SIZE } from '@/features/rooms/constants';


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

// Enum Converters

const ROOM_TYPE_FROM_PROTO: Record<ProtoRoomType, RoomType> = {
  [ProtoRoomType.UNSPECIFIED]: 'meeting_room',
  [ProtoRoomType.MEETING_ROOM]: 'meeting_room',
  [ProtoRoomType.CONFERENCE_ROOM]: 'conference_room',
  [ProtoRoomType.OFFICE]: 'office',
  [ProtoRoomType.OTHER]: 'other',
};

const ROOM_TYPE_TO_PROTO: Record<RoomType, ProtoRoomType> = {
  'meeting_room': ProtoRoomType.MEETING_ROOM,
  'conference_room': ProtoRoomType.CONFERENCE_ROOM,
  'office': ProtoRoomType.OFFICE,
  'other': ProtoRoomType.OTHER,
};

const ROOM_STATUS_FROM_PROTO: Record<ProtoRoomStatus, RoomStatus> = {
  [ProtoRoomStatus.UNSPECIFIED]: 'active',
  [ProtoRoomStatus.ACTIVE]: 'active',
  [ProtoRoomStatus.MAINTENANCE]: 'maintenance',
  [ProtoRoomStatus.RETIRED]: 'retired',
};

const ROOM_STATUS_TO_PROTO: Record<RoomStatus, ProtoRoomStatus> = {
  'active': ProtoRoomStatus.ACTIVE,
  'maintenance': ProtoRoomStatus.MAINTENANCE,
  'retired': ProtoRoomStatus.RETIRED,
};

const BOOKING_STATUS_FROM_PROTO: Record<ProtoBookingStatus, BookingStatus> = {
  [ProtoBookingStatus.UNSPECIFIED]: 'confirmed',
  [ProtoBookingStatus.CONFIRMED]: 'confirmed',
  [ProtoBookingStatus.CANCELLED]: 'cancelled',
};

const BOOKING_STATUS_TO_PROTO: Record<BookingStatus, ProtoBookingStatus> = {
  'confirmed': ProtoBookingStatus.CONFIRMED,
  'cancelled': ProtoBookingStatus.CANCELLED,
};

const VISIBILITY_TO_PROTO: Record<string, ProtoVisibilityScope> = {
  'private': ProtoVisibilityScope.PRIVATE,
  'group': ProtoVisibilityScope.GROUP,
  'organization': ProtoVisibilityScope.ORGANIZATION,
  'public': ProtoVisibilityScope.PUBLIC,
};

const VISIBILITY_FROM_PROTO: Record<ProtoVisibilityScope, string> = {
  [ProtoVisibilityScope.UNSPECIFIED]: 'private',
  [ProtoVisibilityScope.PRIVATE]: 'private',
  [ProtoVisibilityScope.GROUP]: 'group',
  [ProtoVisibilityScope.ORGANIZATION]: 'organization',
  [ProtoVisibilityScope.PUBLIC]: 'organization',
};

// Proto to Domain Converters

/**
 * Convert proto room to domain room.
 */
const roomFromProto = (proto: ProtoRoom): Room => ({
  id: proto.id,
  organizationId: proto.organizationId,
  ownerId: proto.ownerId,
  name: proto.name,
  description: proto.description,
  roomType: ROOM_TYPE_FROM_PROTO[proto.roomType] || 'meeting_room',
  status: ROOM_STATUS_FROM_PROTO[proto.status] || 'active',
  capacity: proto.capacity,
  floor: proto.floor,
  building: proto.building,
  location: proto.location,
  amenities: [...proto.amenities],
  imageFileId: proto.imageFileId || null,
  visibility: (VISIBILITY_FROM_PROTO[proto.visibility] || 'private') as 'private' | 'organization',
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

/**
 * Convert proto booking to domain booking.
 */
const bookingFromProto = (proto: ProtoRoomBooking): RoomBooking => ({
  id: proto.id,
  roomId: proto.roomId,
  organizationId: proto.organizationId,
  userId: proto.userId,
  eventId: proto.eventId || null,
  title: proto.title,
  startTime: timestampToIso(proto.startTime),
  endTime: timestampToIso(proto.endTime),
  status: BOOKING_STATUS_FROM_PROTO[proto.status] || 'confirmed',
  notes: proto.notes,
  bookerName: proto.bookerName,
  roomName: proto.roomName,
  createdAt: timestampToIso(proto.createdAt),
  updatedAt: timestampToIso(proto.updatedAt),
});

/**
 * Convert proto time slot to domain time slot.
 */
const timeSlotFromProto = (proto: ProtoTimeSlot): TimeSlot => ({
  startTime: timestampToIso(proto.startTime),
  endTime: timestampToIso(proto.endTime),
  isAvailable: proto.isAvailable,
  bookingId: proto.bookingId || null,
  eventTitle: proto.eventTitle,
  bookerName: proto.bookerName,
});

// Room Thunks

/**
 * Fetch rooms with optional filters.
 */
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
>('rooms/fetchRooms', async (params, { rejectWithValue }) => {
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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch rooms');
  }
});

/**
 * Initialize all rooms by loading every page upfront.
 *
 * Fetches the first page, then fires remaining pages in parallel and merges
 * everything into a single result. This ensures the user always sees all
 * rooms regardless of total count.
 */
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
>('rooms/initializeRoomsData', async (params, { rejectWithValue }) => {
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
      const remainingPages = Array.from(
        { length: firstResponse.totalPages - 1 },
        (_, i) => i + 2,
      );
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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to load rooms');
  }
});

/**
 * Fetch a single room by ID.
 */
export const fetchRoom = createAsyncThunk<
  Room,
  { roomId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>('rooms/fetchRoom', async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.getRoom({
      roomId: params.roomId,
      organizationId: params.organizationId,
    });
    if (!response.room) {
      return rejectWithValue('Room not found');
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch room');
  }
});

/**
 * Create a new room.
 */
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
>('rooms/createRoom', async (params, { rejectWithValue }) => {
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
      visibility: params.visibility
        ? VISIBILITY_TO_PROTO[params.visibility]
        : undefined,
      groupIds: params.groupIds || [],
    });
    if (!response.room) {
      return rejectWithValue('Failed to create room');
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create room');
  }
});

/**
 * Update an existing room.
 */
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
>('rooms/updateRoom', async (params, { rejectWithValue }) => {
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
      visibility: params.visibility
        ? VISIBILITY_TO_PROTO[params.visibility]
        : undefined,
    });
    if (!response.room) {
      return rejectWithValue('Failed to update room');
    }
    return roomFromProto(response.room);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to update room');
  }
});

/**
 * Delete a room.
 */
export const deleteRoom = createAsyncThunk<
  { roomId: string },
  { roomId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>('rooms/deleteRoom', async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.deleteRoom({
      roomId: params.roomId,
      organizationId: params.organizationId,
    });
    if (!response.success) {
      return rejectWithValue('Failed to delete room');
    }
    return { roomId: params.roomId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete room');
  }
});

// Booking Thunks

/**
 * Create a new booking.
 */
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
>('rooms/createBooking', async (params, { rejectWithValue }) => {
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
      return rejectWithValue('Failed to create booking');
    }
    return bookingFromProto(response.booking);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create booking');
  }
});

/**
 * Cancel a booking.
 */
export const cancelBooking = createAsyncThunk<
  RoomBooking,
  { bookingId: string; organizationId: string },
  { state: RootState; rejectValue: string }
>('rooms/cancelBooking', async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.cancelBooking({
      bookingId: params.bookingId,
      organizationId: params.organizationId,
    });
    if (!response.booking) {
      return rejectWithValue('Failed to cancel booking');
    }
    return bookingFromProto(response.booking);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to cancel booking');
  }
});

/**
 * Fetch bookings with optional filters.
 */
export const fetchBookings = createAsyncThunk<
  { bookings: RoomBooking[]; totalCount: number; page: number; pageSize: number; totalPages: number },
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
>('rooms/fetchBookings', async (params, { rejectWithValue }) => {
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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch bookings');
  }
});

// Availability Thunks

/**
 * Check availability for a specific room over a date range.
 */
export const checkAvailability = createAsyncThunk<
  { roomId: string; slots: TimeSlot[] },
  { organizationId: string; roomId: string; startDate: string; endDate: string },
  { state: RootState; rejectValue: string }
>('rooms/checkAvailability', async (params, { rejectWithValue }) => {
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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to check availability');
  }
});

/**
 * Find available rooms for a given time range.
 */
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
>('rooms/findAvailableRooms', async (params, { rejectWithValue }) => {
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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to find available rooms');
  }
});

/**
 * Fetch available room IDs for a time range (RoomPicker side-channel).
 * Returns only IDs without replacing the rooms map in state.
 */
export const fetchAvailableRoomIds = createAsyncThunk<
  string[],
  {
    organizationId: string;
    startTime: string;
    endTime: string;
  },
  { state: RootState; rejectValue: string }
>('rooms/fetchAvailableRoomIds', async (params, { rejectWithValue }) => {
  try {
    const response = await roomsApi.findAvailableRooms({
      organizationId: params.organizationId,
      startTime: isoToTimestamp(params.startTime),
      endTime: isoToTimestamp(params.endTime),
    });
    return response.rooms.map((r) => r.id);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to check room availability');
  }
});
