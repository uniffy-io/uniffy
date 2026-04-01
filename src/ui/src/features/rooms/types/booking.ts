export type BookingStatus = 'confirmed' | 'cancelled';

export interface RoomBooking {
  id: string;
  roomId: string;
  organizationId: string;
  userId: string;
  eventId: string | null;
  title: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  notes: string;
  bookerName: string;
  roomName: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  bookingId: string | null;
  eventTitle: string;
  bookerName: string;
}
