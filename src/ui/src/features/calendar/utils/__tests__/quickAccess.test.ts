import { describe, it, expect } from "vitest";
import { matchesQuickAccess } from "@/features/calendar/utils/quickAccess";
import type { CalendarEvent } from "@/features/calendar/types";

function event(startTime: string, endTime: string): CalendarEvent {
  return { startTime, endTime } as CalendarEvent;
}

// A Wednesday. The surrounding Sunday (2026-08-16) belongs to this week when
// the week starts on Sunday and to the previous week when it starts on Monday.
const now = new Date("2026-08-19T12:00:00");
const sundayEvent = event("2026-08-16T10:00:00", "2026-08-16T11:00:00");

describe("matchesQuickAccess this_week", () => {
  it("keeps Sunday in the week when the week starts on Sunday", () => {
    expect(matchesQuickAccess(sundayEvent, "this_week", now, 0)).toBe(true);
  });

  it("drops the previous Sunday when the week starts on Monday", () => {
    expect(matchesQuickAccess(sundayEvent, "this_week", now, 1)).toBe(false);
  });

  it("keeps the following Friday regardless of week start", () => {
    const friday = event("2026-08-21T10:00:00", "2026-08-21T11:00:00");
    expect(matchesQuickAccess(friday, "this_week", now, 0)).toBe(true);
    expect(matchesQuickAccess(friday, "this_week", now, 1)).toBe(true);
  });

  it("counts an event overlapping the window without starting in it", () => {
    const spanning = event("2026-08-15T10:00:00", "2026-08-18T11:00:00");
    expect(matchesQuickAccess(spanning, "this_week", now, 1)).toBe(true);
  });
});
