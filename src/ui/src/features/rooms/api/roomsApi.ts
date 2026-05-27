import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';
import { RoomsService, CancelBookingRequestSchema, CheckAvailabilityRequestSchema, CreateBookingRequestSchema, CreateRoomRequestSchema, DeleteRoomRequestSchema, FindAvailableRoomsRequestSchema, GetBookingRequestSchema, GetRoomRequestSchema, ListBookingsRequestSchema, ListRoomsRequestSchema, UpdateRoomRequestSchema } from '@uniffy/proto/rooms/v1/rooms_pb';

const roomsClient = createClient(RoomsService, unaryTransport);

export const roomsApi = {
  createRoom: async (request: MessageInitShape<typeof CreateRoomRequestSchema>) => {
    return roomsClient.createRoom(request);
  },

  getRoom: async (request: MessageInitShape<typeof GetRoomRequestSchema>) => {
    return roomsClient.getRoom(request);
  },

  updateRoom: async (request: MessageInitShape<typeof UpdateRoomRequestSchema>) => {
    return roomsClient.updateRoom(request);
  },

  deleteRoom: async (request: MessageInitShape<typeof DeleteRoomRequestSchema>) => {
    return roomsClient.deleteRoom(request);
  },

  listRooms: async (request: MessageInitShape<typeof ListRoomsRequestSchema>) => {
    return roomsClient.listRooms(request);
  },

  createBooking: async (request: MessageInitShape<typeof CreateBookingRequestSchema>) => {
    return roomsClient.createBooking(request);
  },

  getBooking: async (request: MessageInitShape<typeof GetBookingRequestSchema>) => {
    return roomsClient.getBooking(request);
  },

  cancelBooking: async (request: MessageInitShape<typeof CancelBookingRequestSchema>) => {
    return roomsClient.cancelBooking(request);
  },

  listBookings: async (request: MessageInitShape<typeof ListBookingsRequestSchema>) => {
    return roomsClient.listBookings(request);
  },

  checkAvailability: async (request: MessageInitShape<typeof CheckAvailabilityRequestSchema>) => {
    return roomsClient.checkAvailability(request);
  },

  findAvailableRooms: async (request: MessageInitShape<typeof FindAvailableRoomsRequestSchema>) => {
    return roomsClient.findAvailableRooms(request);
  },
};
