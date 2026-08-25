import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import { formatTimeInZone } from "@/shared/utils/dateFormatting";
import { formatTime } from "@/features/calendar/utils/dateUtils";
import type { SchedulingBusyInterval, UserFreeBusy } from "@/features/calendar/types/scheduling";
import {
  cellState,
  mergedCellState,
  roomCellState,
  zoneLabel,
  type CellState,
  type GridSlot,
} from "@/features/calendar/components/scheduling/schedulingMath";

const CELL_WIDTH = 18;

interface AttendeeAvailabilityGridProps {
  slots: GridSlot[];
  users: UserFreeBusy[];
  names: Record<string, string>;
  requiredIds: Set<string>;
  roomBusy: SchedulingBusyInterval[] | null;
  roomName?: string;
  /** The event's own span, highlighted on every row. */
  selectedStart?: string | null;
  selectedEnd?: string | null;
  onToggleRequired?: (userId: string) => void;
}

const OOO_HATCH = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 3px, currentColor 3px, currentColor 4px)",
};

function Cell({ state, selected }: { state: CellState; selected: boolean }) {
  return (
    <td
      className={cn(
        "h-7 border-r border-b border-border/50 p-0",
        state === "busy" && "bg-primary/50",
        state === "ooo" && "bg-primary/20 text-primary",
        state === "off" && "bg-muted/70",
        selected && "outline outline-2 -outline-offset-1 outline-primary",
      )}
      style={{ minWidth: CELL_WIDTH, ...(state === "ooo" ? OOO_HATCH : {}) }}
    />
  );
}

export function AttendeeAvailabilityGrid({
  slots,
  users,
  names,
  requiredIds,
  roomBusy,
  roomName,
  selectedStart,
  selectedEnd,
  onToggleRequired,
}: AttendeeAvailabilityGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Land the viewport on the morning instead of midnight.
    if (scrollRef.current) scrollRef.current.scrollLeft = 16 * CELL_WIDTH;
  }, []);

  const isSelected = (slot: GridSlot) =>
    !!selectedStart &&
    !!selectedEnd &&
    Date.parse(slot.start) < Date.parse(selectedEnd) &&
    Date.parse(slot.end) > Date.parse(selectedStart);

  const requiredUsers = users.filter((u) => requiredIds.has(u.userId));

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-md border border-border">
      <table className="border-collapse" style={{ minWidth: 176 + slots.length * CELL_WIDTH }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-44 min-w-44 border-r border-b border-border bg-card" />
            {slots.map((slot, i) => (
              <th
                key={slot.start}
                className="h-6 border-b border-border/50 p-0 text-left align-bottom"
                style={{ minWidth: CELL_WIDTH }}
              >
                {i % 4 === 0 && (
                  <span className="block origin-bottom-left whitespace-nowrap pl-0.5 text-[10px] font-normal text-muted-foreground">
                    {formatTime(slot.start)}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.userId}>
              <td className="sticky left-0 z-10 w-44 min-w-44 max-w-44 border-r border-b border-border bg-card px-2 py-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium text-foreground">
                    {names[user.userId] ?? "Member"}
                  </span>
                  {onToggleRequired && (
                    <button
                      type="button"
                      onClick={() => onToggleRequired(user.userId)}
                      className={cn(
                        "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium transition-colors",
                        requiredIds.has(user.userId)
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                      title="Toggle required / optional"
                    >
                      {requiredIds.has(user.userId) ? "Required" : "Optional"}
                    </button>
                  )}
                </div>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {zoneLabel(user.timezone)}
                  {" · now "}
                  {formatTimeInZone(new Date(), user.timezone)}
                </span>
              </td>
              {slots.map((slot) => (
                <Cell key={slot.start} state={cellState(slot, user)} selected={isSelected(slot)} />
              ))}
            </tr>
          ))}
          {users.length > 1 && (
            <tr>
              <td className="sticky left-0 z-10 border-r border-b border-border bg-card px-2 py-1 text-xs font-semibold text-foreground">
                Everyone required
              </td>
              {slots.map((slot) => (
                <Cell
                  key={slot.start}
                  state={mergedCellState(slot, requiredUsers)}
                  selected={isSelected(slot)}
                />
              ))}
            </tr>
          )}
          {roomBusy !== null && (
            <tr>
              <td className="sticky left-0 z-10 border-r border-b border-border bg-card px-2 py-1 text-xs font-medium text-foreground">
                <span className="truncate">{roomName ?? "Room"}</span>
              </td>
              {slots.map((slot) => (
                <Cell
                  key={slot.start}
                  state={roomCellState(slot, roomBusy)}
                  selected={isSelected(slot)}
                />
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
