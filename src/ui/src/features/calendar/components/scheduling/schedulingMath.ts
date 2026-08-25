import { formatInTimeZone } from "date-fns-tz";
import { instantFromDisplayParts } from "@/features/calendar/utils/dateUtils";
import type { SchedulingBusyInterval, UserFreeBusy } from "@/features/calendar/types/scheduling";

export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

export type CellState = "free" | "busy" | "ooo" | "off";

export interface GridSlot {
  /** ISO instants bounding one 30-minute cell of the display day. */
  start: string;
  end: string;
}

/** The display day's 48 half-hour cells as instants on the viewer's clock. */
export function buildDaySlots(day: Date): GridSlot[] {
  const slots: GridSlot[] = [];
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    const hours = Math.floor((i * SLOT_MINUTES) / 60);
    const minutes = (i * SLOT_MINUTES) % 60;
    const start = instantFromDisplayParts(day, hours, minutes);
    slots.push({
      start: start.toISOString(),
      end: new Date(start.getTime() + SLOT_MINUTES * 60_000).toISOString(),
    });
  }
  return slots;
}

function overlapping(
  slot: GridSlot,
  intervals: SchedulingBusyInterval[],
): SchedulingBusyInterval | undefined {
  // Epoch comparison: ISO strings with mixed millisecond precision do not
  // order correctly as text.
  const slotStart = Date.parse(slot.start);
  const slotEnd = Date.parse(slot.end);
  return intervals.find((i) => Date.parse(i.start) < slotEnd && Date.parse(i.end) > slotStart);
}

/** Whether the slot sits inside the user's working hours, on THEIR clock. */
export function isWorkingSlot(slot: GridSlot, user: UserFreeBusy): boolean {
  if (!user.timezone || !user.workdayStart || !user.workdayEnd) return true;
  const start = new Date(slot.start);
  const dayName = formatInTimeZone(start, user.timezone, "EEEE").toLowerCase();
  if (user.workdays.length > 0 && !user.workdays.includes(dayName)) return false;
  const clock = formatInTimeZone(start, user.timezone, "HH:mm");
  return clock >= user.workdayStart && clock < user.workdayEnd;
}

export function cellState(slot: GridSlot, user: UserFreeBusy): CellState {
  const hit = overlapping(slot, user.intervals);
  if (hit) return hit.isOutOfOffice ? "ooo" : "busy";
  return isWorkingSlot(slot, user) ? "free" : "off";
}

/** The merged row: every listed user must be free and working. */
export function mergedCellState(slot: GridSlot, users: UserFreeBusy[]): CellState {
  if (users.some((u) => overlapping(slot, u.intervals))) return "busy";
  if (users.some((u) => !isWorkingSlot(slot, u))) return "off";
  return "free";
}

export function roomCellState(slot: GridSlot, roomBusy: SchedulingBusyInterval[]): CellState {
  return overlapping(slot, roomBusy) ? "busy" : "free";
}

/** Short human label for a zone ("America/New_York" -> "New York"). */
export function zoneLabel(timezone: string): string {
  const city = timezone.split("/").pop() ?? timezone;
  return city.replace(/_/g, " ");
}
