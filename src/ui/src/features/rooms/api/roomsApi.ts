/**
 * Rooms API Service
 *
 * Centralized ConnectRPC client for room and booking operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';
import { RoomsService, CancelBookingRequestSchema, CheckAvailabilityRequestSchema, CreateBookingRequestSchema, CreateRoomRequestSchema, DeleteRoomRequestSchema, FindAvailableRoomsRequestSchema, GetBookingRequestSchema, GetRoomRequestSchema, ListBookingsRequestSchema, ListRoomsRequestSchema, UpdateRoomRequestSchema } from '@uniffy/proto/rooms/v1/rooms_pb';

/**
 * Create a rooms service client with the shared transport.
 */
const roomsClient = createClient(RoomsService, unaryTransport);

/**
 * Rooms API service with typed methods.
 */
export const roomsApi = {
  // Room Operations

  /**
   * Create a new room.
   */
  createRoom: async (request: MessageInitShape<typeof CreateRoomRequestSchema>) => {
    return roomsClient.createRoom(request);
  },

  /**
   * Get a room by ID.
   */
  getRoom: async (request: MessageInitShape<typeof GetRoomRequestSchema>) => {
    return roomsClient.getRoom(request);
  },

  /**
   * Update an existing room.
   */
  updateRoom: async (request: MessageInitShape<typeof UpdateRoomRequestSchema>) => {
    return roomsClient.updateRoom(request);
  },

  /**
   * Delete a room.
   */
  deleteRoom: async (request: MessageInitShape<typeof DeleteRoomRequestSchema>) => {
    return roomsClient.deleteRoom(request);
  },

  /**
   * List rooms with filters and pagination.
   */
  listRooms: async (request: MessageInitShape<typeof ListRoomsRequestSchema>) => {
    return roomsClient.listRooms(request);
  },

  // Booking Operations

  /**
   * Create a new booking.
   */
  createBooking: async (request: MessageInitShape<typeof CreateBookingRequestSchema>) => {
    return roomsClient.createBooking(request);
  },

  /**
   * Get a booking by ID.
   */
  getBooking: async (request: MessageInitShape<typeof GetBookingRequestSchema>) => {
    return roomsClient.getBooking(request);
  },

  /**
   * Cancel a booking.
   */
  cancelBooking: async (request: MessageInitShape<typeof CancelBookingRequestSchema>) => {
    return roomsClient.cancelBooking(request);
  },

  /**
   * List bookings with filters.
   */
  listBookings: async (request: MessageInitShape<typeof ListBookingsRequestSchema>) => {
    return roomsClient.listBookings(request);
  },

  // Availability Operations

  /**
   * Check availability for a specific room and time range.
   */
  checkAvailability: async (request: MessageInitShape<typeof CheckAvailabilityRequestSchema>) => {
    return roomsClient.checkAvailability(request);
  },

  /**
   * Find available rooms for a given time range and criteria.
   */
  findAvailableRooms: async (request: MessageInitShape<typeof FindAvailableRoomsRequestSchema>) => {
    return roomsClient.findAvailableRooms(request);
  },
};
