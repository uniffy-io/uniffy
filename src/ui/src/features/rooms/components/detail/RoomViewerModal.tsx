import { useCallback, useState } from "react";
import { CalendarPlus, WarningCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  closeRoomViewer,
  selectRoomById,
  selectRoomViewer,
  selectRoomAvailability,
} from "@/features/rooms/store/roomsSlice";
import { openRoomViewer, cancelBooking } from "@/features/rooms/store/roomsThunks";
import { RoomOverview } from "@/features/rooms/components/detail/RoomOverview";
import { BookingModal } from "@/features/rooms/components/modals/BookingModal";
import type { RoomBooking } from "@/features/rooms/types";
import type { RootState } from "@/app/store";

/**
 * Read-only room card, opened in place from a room mention chip or a search hit.
 * Mounted once at the app root so it works on every route without navigating away.
 */
export function RoomViewerModal() {
  const dispatch = useAppDispatch();
  const viewer = useAppSelector(selectRoomViewer);
  const roomId = viewer.roomId;
  const room = useAppSelector((state: RootState) =>
    roomId ? selectRoomById(state, roomId) : undefined,
  );
  const availability = useAppSelector((state: RootState) =>
    selectRoomAvailability(state, roomId ?? ""),
  );
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const organizationRole = useAppSelector((state) => state.auth.currentOrganizationRole);

  const [bookingOpen, setBookingOpen] = useState(false);

  const handleClose = useCallback(() => {
    dispatch(closeRoomViewer());
  }, [dispatch]);

  const canCancelBooking = useCallback(
    (booking: RoomBooking) =>
      booking.userId === userId || ["ADMIN", "OWNER"].includes(organizationRole ?? ""),
    [userId, organizationRole],
  );

  const handleCancelBooking = useCallback(
    async (bookingId: string) => {
      if (!organizationId || !roomId) return;
      await dispatch(cancelBooking({ bookingId, organizationId }));
      dispatch(openRoomViewer({ roomId }));
    },
    [dispatch, organizationId, roomId],
  );

  const handleBooked = useCallback(() => {
    if (roomId) dispatch(openRoomViewer({ roomId }));
  }, [dispatch, roomId]);

  if (!roomId || viewer.inline) return null;

  return (
    <>
      <Modal onClose={handleClose} maxWidth="max-w-md" closeDisabled={bookingOpen}>
        <ModalHeader title={room?.name ?? "Room"} />

        <ModalBody>
          {viewer.error ? (
            <div className="flex flex-col items-center text-center py-8 gap-2">
              <WarningCircle size={32} weight="duotone" className="text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">This room is not available</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                It was removed, or it has not been shared with you.
              </p>
            </div>
          ) : !room ? (
            <RoomOverviewSkeleton />
          ) : (
            <RoomOverview
              room={room}
              bookings={viewer.bookings}
              availability={availability}
              loadingBookings={viewer.loading}
              loadingAvailability={viewer.loading}
              onCancelBooking={handleCancelBooking}
              canCancelBooking={canCancelBooking}
            />
          )}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>
            Close
          </Button>
          {room && room.status === "active" && (
            <Button type="button" onClick={() => setBookingOpen(true)}>
              <CalendarPlus size={16} />
              Book this room
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {room && (
        <BookingModal
          isOpen={bookingOpen}
          onClose={() => setBookingOpen(false)}
          onBooked={handleBooked}
          roomId={room.id}
          roomName={room.name}
        />
      )}
    </>
  );
}

function RoomOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Loading room">
      <div className="h-5 w-2/3 rounded bg-muted" />
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted/60" />
      <div className="h-3 w-5/6 rounded bg-muted/60" />
      <div className="h-8 w-full rounded bg-muted" />
    </div>
  );
}
