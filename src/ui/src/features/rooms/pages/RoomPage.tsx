import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Door, CalendarPlus, WarningCircle } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';
import {
  closeRoomViewer,
  selectRoomById,
  selectRoomViewer,
  selectRoomAvailability,
} from '@/features/rooms/store/roomsSlice';
import { openRoomViewer, cancelBooking } from '@/features/rooms/store/roomsThunks';
import { RoomOverview } from '@/features/rooms/components/detail/RoomOverview';
import { BookingModal } from '@/features/rooms/components/modals/BookingModal';
import type { RoomBooking } from '@/features/rooms/types';
import type { RootState } from '@/app/store';

/** Standalone room view so a `/rooms/:roomId` link resolves instead of hitting the 404 page. */
export function RoomPage() {
  const dispatch = useAppDispatch();
  const { roomId } = useParams<{ roomId: string }>();
  const viewer = useAppSelector(selectRoomViewer);
  const room = useAppSelector((state: RootState) => (roomId ? selectRoomById(state, roomId) : undefined));
  const availability = useAppSelector((state: RootState) => selectRoomAvailability(state, roomId ?? ''));
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const organizationRole = useAppSelector((state) => state.auth.currentOrganizationRole);

  const [bookingOpen, setBookingOpen] = useState(false);

  useDocumentTitle(room?.name ?? 'Room');

  useEffect(() => {
    if (!roomId) return;
    dispatch(openRoomViewer({ roomId, inline: true }));
    return () => {
      dispatch(closeRoomViewer());
    };
  }, [dispatch, roomId]);

  const canCancelBooking = useCallback(
    (booking: RoomBooking) =>
      booking.userId === userId || ['ADMIN', 'OWNER'].includes(organizationRole ?? ''),
    [userId, organizationRole],
  );

  const handleCancelBooking = useCallback(async (bookingId: string) => {
    if (!organizationId || !roomId) return;
    await dispatch(cancelBooking({ bookingId, organizationId }));
    dispatch(openRoomViewer({ roomId, inline: true }));
  }, [dispatch, organizationId, roomId]);

  const handleBooked = useCallback(() => {
    if (roomId) dispatch(openRoomViewer({ roomId, inline: true }));
  }, [dispatch, roomId]);

  if (viewer.error || !roomId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-2 text-center">
        <WarningCircle size={48} weight="duotone" className="text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">This room is not available</p>
        <p className="text-xs text-muted-foreground">
          It was removed, or it has not been shared with you.
        </p>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Loading room">
          <div className="h-6 w-1/2 rounded bg-muted" />
          <div className="h-4 w-1/4 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted/60" />
          <div className="h-8 w-full rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Door size={18} weight="duotone" />
        <span className="text-xs font-semibold uppercase tracking-wider">Room</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 md:p-5">
        <RoomOverview
          room={room}
          bookings={viewer.bookings}
          availability={availability}
          loadingBookings={viewer.loading}
          loadingAvailability={viewer.loading}
          onCancelBooking={handleCancelBooking}
          canCancelBooking={canCancelBooking}
        />

        {room.status === 'active' && (
          <div className="mt-5 pt-4 border-t border-border">
            <Button size="md" className="gap-1.5" onClick={() => setBookingOpen(true)}>
              <CalendarPlus size={16} />
              Book this Room
            </Button>
          </div>
        )}
      </div>

      <BookingModal
        isOpen={bookingOpen}
        onClose={() => setBookingOpen(false)}
        onBooked={handleBooked}
        roomId={room.id}
        roomName={room.name}
      />
    </div>
  );
}
