import { describe, it, expect, beforeEach } from "vitest";
import { setPreferredTimeZone } from "@/shared/utils/timezone";
import {
  buildDaySlots,
  cellState,
  mergedCellState,
  roomCellState,
  zoneLabel,
} from "@/features/calendar/components/scheduling/schedulingMath";
import type { UserFreeBusy } from "@/features/calendar/types/scheduling";

const user = (overrides: Partial<UserFreeBusy> = {}): UserFreeBusy => ({
  userId: "u1",
  intervals: [],
  timezone: "UTC",
  workdayStart: "09:00",
  workdayEnd: "18:00",
  workdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  ...overrides,
});

// 2026-08-03 is a Monday.
const MONDAY = new Date("2026-08-03T12:00:00Z");

describe("schedulingMath", () => {
  beforeEach(() => {
    setPreferredTimeZone("UTC");
  });

  it("builds 48 half-hour cells on the viewer's clock", () => {
    const slots = buildDaySlots(MONDAY);
    expect(slots).toHaveLength(48);
    expect(slots[0].start).toBe("2026-08-03T00:00:00.000Z");
    expect(slots[18].start).toBe("2026-08-03T09:00:00.000Z");
  });

  it("marks busy and out-of-office cells from intervals", () => {
    const slots = buildDaySlots(MONDAY);
    const u = user({
      intervals: [
        { start: "2026-08-03T09:00:00Z", end: "2026-08-03T10:00:00Z", isOutOfOffice: false },
        { start: "2026-08-03T13:00:00Z", end: "2026-08-03T14:00:00Z", isOutOfOffice: true },
      ],
    });
    expect(cellState(slots[18], u)).toBe("busy");
    expect(cellState(slots[26], u)).toBe("ooo");
    expect(cellState(slots[21], u)).toBe("free");
  });

  it("dims non-working time in the user's own timezone", () => {
    const slots = buildDaySlots(MONDAY);
    // Sofia is UTC+3 in August: 18:00 local = 15:00 UTC, so 15:30 UTC is off.
    const sofia = user({ timezone: "Europe/Sofia" });
    expect(cellState(slots[12], sofia)).toBe("free"); // 06:00 UTC = 09:00 Sofia
    expect(cellState(slots[31], sofia)).toBe("off"); // 15:30 UTC = 18:30 Sofia
    expect(cellState(slots[8], sofia)).toBe("off"); // 04:00 UTC = 07:00 Sofia
  });

  it("respects the workday mask", () => {
    const saturday = new Date("2026-08-08T12:00:00Z");
    const slots = buildDaySlots(saturday);
    expect(cellState(slots[20], user())).toBe("off");
    expect(cellState(slots[20], user({ workdays: ["saturday"] }))).toBe("free");
  });

  it("merges rows so any busy or off attendee blocks the slot", () => {
    const slots = buildDaySlots(MONDAY);
    const busyUser = user({
      intervals: [
        { start: "2026-08-03T10:00:00Z", end: "2026-08-03T11:00:00Z", isOutOfOffice: false },
      ],
    });
    const sofia = user({ userId: "u2", timezone: "Europe/Sofia" });
    expect(mergedCellState(slots[20], [busyUser, sofia])).toBe("busy"); // 10:00
    expect(mergedCellState(slots[32], [busyUser, sofia])).toBe("off"); // 16:00 UTC = 19:00 Sofia
    expect(mergedCellState(slots[24], [busyUser, sofia])).toBe("free"); // 12:00
  });

  it("room cells only know booked or free", () => {
    const slots = buildDaySlots(MONDAY);
    const roomBusy = [
      { start: "2026-08-03T09:00:00Z", end: "2026-08-03T09:30:00Z", isOutOfOffice: false },
    ];
    expect(roomCellState(slots[18], roomBusy)).toBe("busy");
    expect(roomCellState(slots[19], roomBusy)).toBe("free");
  });

  it("labels zones by city", () => {
    expect(zoneLabel("America/New_York")).toBe("New York");
    expect(zoneLabel("UTC")).toBe("UTC");
  });
});
