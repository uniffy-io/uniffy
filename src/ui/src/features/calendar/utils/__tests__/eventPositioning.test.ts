import { describe, expect, it } from "vitest";
import {
  findConflicts,
  getPositionedEventsForDay,
  memberCommitments,
} from "@/features/calendar/utils/eventPositioning";
import type { Attendee, CalendarEvent } from "@/features/calendar/types";

function attendee(id: string, status: Attendee["status"]): Attendee {
  return { id, name: id, email: `${id}@example.com`, initials: "X", status, role: "required" };
}

function event(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: id,
    startTime: "2026-09-30T09:00:00",
    endTime: "2026-09-30T10:00:00",
    calendarId: "team",
    organizerId: "colleague",
    attendees: [],
    status: "confirmed",
    transparency: "opaque",
    ...overrides,
  } as CalendarEvent;
}

const mine = memberCommitments("me", new Set(["my-calendar"]));

describe("conflicts on a grid that shows shared calendars", () => {
  const organized = event("organized", { organizerId: "me" });
  const invited = event("invited", { attendees: [attendee("me", "accepted")] });
  const declined = event("declined", { attendees: [attendee("me", "declined")] });
  const onMyCalendar = event("on-my-calendar", { calendarId: "my-calendar" });
  const colleagues = event("colleagues");
  const otherColleagues = event("other-colleagues");

  it("counts what the member organizes, attends or files on their own calendar", () => {
    expect([organized, invited, onMyCalendar].every(mine)).toBe(true);
  });

  it("ignores declined invitations and colleagues' meetings on shared calendars", () => {
    expect([declined, colleagues].some(mine)).toBe(false);
  });

  it("flags only the member's own clashes on the day grid", () => {
    const day = [organized, invited, colleagues, otherColleagues];
    const flagged = getPositionedEventsForDay(day, "2026-09-30", 0, 60, 100, mine)
      .filter((e) => e.hasConflict)
      .map((e) => e.id);

    expect(flagged.sort()).toEqual(["invited", "organized"]);
  });

  it("leaves two overlapping shared meetings unflagged", () => {
    expect(findConflicts(colleagues, [colleagues, otherColleagues], mine)).toEqual([]);
  });

  it("keeps the unscoped behaviour for callers without a member", () => {
    expect(findConflicts(colleagues, [colleagues, otherColleagues])).toEqual([otherColleagues]);
  });
});
