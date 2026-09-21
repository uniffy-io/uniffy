import { useMemo } from "react";
import { Users, MapPin, Buildings, Stairs, Clock, Trash } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { ROOM_TYPE_LABELS, ROOM_STATUS_LABELS } from "@/features/rooms/types";
import type { Room, RoomBooking, TimeSlot } from "@/features/rooms/types";
import { AMENITY_ICONS, ROOM_STATUS_STYLES } from "@/features/rooms/constants";
import { AvailabilityGrid } from "@/features/rooms/components/shared/AvailabilityGrid";
import { formatDateShort } from "@/shared/utils/dateFormatting";

interface RoomOverviewProps {
  room: Room;
  bookings: RoomBooking[];
  availability: readonly TimeSlot[];
  loadingBookings?: boolean;
  loadingAvailability?: boolean;
  onCancelBooking?: (bookingId: string) => void;
  /** Cancelling is the booker's or an org admin's call; the backend is the gate, this only hides the affordance. */
  canCancelBooking?: (booking: RoomBooking) => boolean;
  className?: string;
}

/** Room context: what it is, where it is, what it has, and when it is free. */
export function RoomOverview({
  room,
  bookings,
  availability,
  loadingBookings = false,
  loadingAvailability = false,
  onCancelBooking,
  canCancelBooking,
  className,
}: RoomOverviewProps) {
  const upcoming = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((b) => b.roomId === room.id && b.status === "confirmed" && new Date(b.endTime) > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [bookings, room.id]);

  const statusInfo = ROOM_STATUS_STYLES[room.status];

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-foreground">{room.name}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {ROOM_TYPE_LABELS[room.roomType]}
          </Badge>
          <div className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full", statusInfo.dot)} />
            <span className="text-xs text-muted-foreground">{ROOM_STATUS_LABELS[room.status]}</span>
          </div>
        </div>
      </div>

      {room.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{room.description}</p>
      )}

      <div className="flex flex-col gap-2.5">
        {room.capacity > 0 && (
          <div className="flex items-center gap-2.5 text-sm">
            <Users size={16} className="text-muted-foreground shrink-0" />
            <span className="text-foreground">
              {room.capacity} {room.capacity === 1 ? "person" : "people"}
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

      {room.amenities.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Amenities
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {room.amenities.map((amenity) => {
              const IconComponent = AMENITY_ICONS[amenity];
              return (
                <span
                  key={amenity}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {IconComponent && <IconComponent size={12} />}
                  {amenity}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {room.status === "active" && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Today's Availability
          </h4>
          {loadingAvailability ? (
            <div className="h-8 rounded bg-muted animate-pulse" />
          ) : (
            <AvailabilityGrid slots={availability} />
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Upcoming Bookings ({upcoming.length})
        </h4>
        {loadingBookings ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-12 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground">No upcoming bookings</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {upcoming.map((booking) => (
              <BookingRow
                key={booking.id}
                booking={booking}
                onCancel={
                  onCancelBooking && (canCancelBooking?.(booking) ?? true)
                    ? () => onCancelBooking(booking.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BookingRow({ booking, onCancel }: { booking: RoomBooking; onCancel?: () => void }) {
  const start = new Date(booking.startTime);
  const end = new Date(booking.endTime);
  const timeStr = `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="group flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
      <Clock size={14} className="text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{booking.title || "Booking"}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatDateShort(booking.startTime)} {timeStr}
          {booking.bookerName && ` - ${booking.bookerName}`}
        </p>
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="md:opacity-0 md:group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
          title="Cancel booking"
        >
          <Trash size={12} />
        </button>
      )}
    </div>
  );
}
