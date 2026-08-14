import { useEffect } from "react";
import { X, Door, CalendarPlus } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  selectRoomById,
  selectRoomBookings,
  selectRoomAvailability,
  selectRoomsLoading,
} from "@/features/rooms/store/roomsSlice";
import {
  fetchBookings,
  checkAvailability,
  cancelBooking,
} from "@/features/rooms/store/roomsThunks";
import { RoomOverview } from "@/features/rooms/components/detail/RoomOverview";
import type { RootState } from "@/app/store";

interface RoomDetailPanelProps {
  roomId: string;
  onClose: () => void;
  onBook?: () => void;
  className?: string;
}

export function RoomDetailPanel({ roomId, onClose, onBook, className }: RoomDetailPanelProps) {
  const dispatch = useAppDispatch();
  const room = useAppSelector((state: RootState) => selectRoomById(state, roomId));
  const allBookings = useAppSelector(selectRoomBookings);
  const availability = useAppSelector((state: RootState) => selectRoomAvailability(state, roomId));
  const loading = useAppSelector(selectRoomsLoading);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (!organizationId || !roomId) return;
    const now = new Date();
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

    dispatch(
      fetchBookings({
        organizationId,
        roomId,
        startDate: now.toISOString(),
        endDate: endOfWeek.toISOString(),
      }),
    );
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    dispatch(
      checkAvailability({
        organizationId,
        roomId,
        startDate: startOfDay.toISOString(),
        endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
      }),
    );
  }, [dispatch, organizationId, roomId]);

  const handleCancelBooking = async (bookingId: string) => {
    if (!organizationId) return;
    await dispatch(cancelBooking({ bookingId, organizationId }));
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    dispatch(
      fetchBookings({
        organizationId,
        roomId,
        startDate: startOfDay.toISOString(),
        endDate: endOfWeek.toISOString(),
      }),
    );
    dispatch(
      checkAvailability({
        organizationId,
        roomId,
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      }),
    );
  };

  if (!room) {
    return (
      <div className={cn("flex flex-col h-full bg-card", className)}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Room Details</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Door size={32} weight="duotone" className="text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Room not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-card", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-foreground">Room Details</span>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <RoomOverview
          className="p-4"
          room={room}
          bookings={allBookings}
          availability={availability}
          loadingBookings={loading.bookings}
          loadingAvailability={loading.availability}
          onCancelBooking={handleCancelBooking}
        />
      </ScrollArea>

      {onBook && room.status === "active" && (
        <div className="p-4 border-t border-border shrink-0">
          <Button onClick={onBook} size="md" className="w-full gap-1.5">
            <CalendarPlus size={16} />
            Book this Room
          </Button>
        </div>
      )}
    </div>
  );
}
