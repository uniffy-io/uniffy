/**
 * RoomDetailPanel - Detail panel showing room info, availability, and bookings.
 *
 * Used inside a Drawer on the admin rooms page.
 */

import { useEffect, useMemo } from 'react';
import {
  X,
  Door,
  Users,
  MapPin,
  Buildings,
  Stairs,
  CalendarPlus,
  Clock,
  Trash,
} from '@phosphor-icons/react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { selectRoomById, selectRoomBookings, selectRoomAvailability, selectRoomsLoading } from '@/features/rooms/store/roomsSlice';
import { fetchBookings, checkAvailability, cancelBooking } from '@/features/rooms/store/roomsThunks';
import { ROOM_TYPE_LABELS, ROOM_STATUS_LABELS } from '@/features/rooms/types';
import type { RoomBooking } from '@/features/rooms/types';
import { AMENITY_ICONS, ROOM_STATUS_STYLES } from '@/features/rooms/constants';
import { AvailabilityGrid } from '@/features/rooms/components/shared/AvailabilityGrid';
import { formatDateShort } from '@/shared/utils/dateFormatting';
import type { RootState } from '@/app/store';

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

  // Fetch bookings and availability for this room
  useEffect(() => {
    if (!organizationId || !roomId) return;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

    dispatch(fetchBookings({
      organizationId,
      roomId,
      startDate: startOfDay.toISOString(),
      endDate: endOfWeek.toISOString(),
    }));
    dispatch(checkAvailability({
      organizationId,
      roomId,
      startDate: startOfDay.toISOString(),
      endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString(),
    }));
  }, [dispatch, organizationId, roomId]);

  // Filter bookings for this room only
  const roomBookings = useMemo(
    () => allBookings
      .filter((b) => b.roomId === roomId && b.status === 'confirmed')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    [allBookings, roomId],
  );

  const handleCancelBooking = async (bookingId: string) => {
    if (!organizationId) return;
    await dispatch(cancelBooking({ bookingId, organizationId }));
    // Re-fetch bookings and availability
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    dispatch(fetchBookings({
      organizationId,
      roomId,
      startDate: startOfDay.toISOString(),
      endDate: endOfWeek.toISOString(),
    }));
    dispatch(checkAvailability({
      organizationId,
      roomId,
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
    }));
  };

  if (!room) {
    return (
      <div className={cn('flex flex-col h-full bg-card', className)}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Room Details</span>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
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

  const statusInfo = ROOM_STATUS_STYLES[room.status];

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-foreground">Room Details</span>
        <button type="button" onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <X size={16} weight="bold" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-5">
          {/* Name and badges */}
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-foreground">{room.name}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {ROOM_TYPE_LABELS[room.roomType]}
              </Badge>
              <div className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', statusInfo.dot)} />
                <span className="text-xs text-muted-foreground">
                  {ROOM_STATUS_LABELS[room.status]}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          {room.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {room.description}
            </p>
          )}

          {/* Metadata */}
          <div className="flex flex-col gap-2.5">
            {room.capacity > 0 && (
              <div className="flex items-center gap-2.5 text-sm">
                <Users size={16} className="text-muted-foreground shrink-0" />
                <span className="text-foreground">
                  {room.capacity} {room.capacity === 1 ? 'person' : 'people'}
                </span>
              </div>
            )}
            {room.location && (
              <div className="flex items-center gap-2.5 text-sm">
                <MapPin size={16} className="text-muted-foreground shrink-0" />
                <span className="text-foreground">{room.location}</span>
              </div>
            )}
            {room.building && (
              <div className="flex items-center gap-2.5 text-sm">
                <Buildings size={16} className="text-muted-foreground shrink-0" />
                <span className="text-foreground">{room.building}</span>
              </div>
            )}
            {room.floor && (
              <div className="flex items-center gap-2.5 text-sm">
                <Stairs size={16} className="text-muted-foreground shrink-0" />
                <span className="text-foreground">Floor {room.floor}</span>
              </div>
            )}
          </div>

          {/* Amenities */}
          {room.amenities.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Amenities
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {room.amenities.map((amenity) => {
                  const IconComponent = AMENITY_ICONS[amenity];
                  return (
                    <span key={amenity} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                      {IconComponent && <IconComponent size={12} />}
                      {amenity}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Today's Availability */}
          {room.status === 'active' && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Today's Availability
              </h4>
              {loading.availability ? (
                <div className="h-8 rounded bg-muted animate-pulse" />
              ) : (
                <AvailabilityGrid slots={availability} />
              )}
            </div>
          )}

          {/* Upcoming Bookings */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Upcoming Bookings ({roomBookings.length})
            </h4>
            {loading.bookings ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : roomBookings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No upcoming bookings</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {roomBookings.map((booking) => (
                  <BookingRow
                    key={booking.id}
                    booking={booking}
                    onCancel={() => handleCancelBooking(booking.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Book button */}
      {onBook && room.status === 'active' && (
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

function BookingRow({ booking, onCancel }: { booking: RoomBooking; onCancel: () => void }) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="group flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
      <Clock size={14} className="text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">
          {booking.title || 'Booking'}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {formatDateShort(booking.startTime)} {timeStr}
          {booking.bookerName && ` - ${booking.bookerName}`}
        </p>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
        title="Cancel booking"
      >
        <Trash size={12} />
      </button>
    </div>
  );
}
