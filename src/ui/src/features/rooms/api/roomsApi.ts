/**
 * Rooms API Service
 *
 * Centralized ConnectRPC client for room and booking operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import { transport } from '@/config/api';
import { RoomsService } from '@uniffy/proto/rooms/v1/rooms_connect';
import type {
  CreateRoomRequest,
  GetRoomRequest,
  UpdateRoomRequest,
  DeleteRoomRequest,
  ListRoomsRequest,
  CreateBookingRequest,
  GetBookingRequest,
  CancelBookingRequest,
  ListBookingsRequest,
  CheckAvailabilityRequest,
  FindAvailableRoomsRequest,
} from '@uniffy/proto/rooms/v1/rooms_pb';

/**
 * Create a rooms service client with the shared transport.
 */
const roomsClient = createClient(RoomsService, transport);

/**
 * Rooms API service with typed methods.
 */
export const roomsApi = {
  // Room Operations

  /**
   * Create a new room.
   */
  createRoom: async (request: PartialMessage<CreateRoomRequest>) => {
    return roomsClient.createRoom(request);
  },

  /**
   * Get a room by ID.
   */
  getRoom: async (request: PartialMessage<GetRoomRequest>) => {
    return roomsClient.getRoom(request);
  },

  /**
   * Update an existing room.
   */
  updateRoom: async (request: PartialMessage<UpdateRoomRequest>) => {
    return roomsClient.updateRoom(request);
  },

  /**
   * Delete a room.
   */
  deleteRoom: async (request: PartialMessage<DeleteRoomRequest>) => {
    return roomsClient.deleteRoom(request);
  },

  /**
   * List rooms with filters and pagination.
   */
  listRooms: async (request: PartialMessage<ListRoomsRequest>) => {
    return roomsClient.listRooms(request);
  },

  // Booking Operations

  /**
   * Create a new booking.
   */
  createBooking: async (request: PartialMessage<CreateBookingRequest>) => {
    return roomsClient.createBooking(request);
  },

  /**
   * Get a booking by ID.
   */
  getBooking: async (request: PartialMessage<GetBookingRequest>) => {
    return roomsClient.getBooking(request);
  },

  /**
   * Cancel a booking.
   */
  cancelBooking: async (request: PartialMessage<CancelBookingRequest>) => {
    return roomsClient.cancelBooking(request);
  },

  /**
   * List bookings with filters.
   */
  listBookings: async (request: PartialMessage<ListBookingsRequest>) => {
    return roomsClient.listBookings(request);
  },

  // Availability Operations

  /**
   * Check availability for a specific room and time range.
   */
  checkAvailability: async (request: PartialMessage<CheckAvailabilityRequest>) => {
    return roomsClient.checkAvailability(request);
  },

  /**
   * Find available rooms for a given time range and criteria.
   */
  findAvailableRooms: async (request: PartialMessage<FindAvailableRoomsRequest>) => {
    return roomsClient.findAvailableRooms(request);
  },
};
