export { RoomsPage } from '@/features/rooms/pages/RoomsPage';
export { RoomPicker } from '@/features/rooms/components/shared/RoomPicker';
export { roomsReducer, roomsActions } from '@/features/rooms/store/roomsSlice';
export { initializeRoomsData } from '@/features/rooms/store/roomsThunks';
export type { Room, RoomType, RoomStatus, RoomBooking, BookingStatus, TimeSlot } from '@/features/rooms/types';
