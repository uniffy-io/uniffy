import { describe, expect, it } from "vitest";
import { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import {
  calendarHint,
  calendarLabel,
  defaultCalendarFor,
  memberCommitments,
  resolveEventColor,
  writableCalendars,
} from "@features/calendar/calendarList";
import type { SerializedCalendar, SerializedCategory } from "@features/calendar/calendarSerializer";

const ME = "user-me";

function calendar(overrides: Partial<SerializedCalendar> & { id: string }): SerializedCalendar {
  return {
    ownerId: ME,
    ownerName: "Me",
    name: overrides.id,
    label: overrides.id,
    color: "#111111",
    isDefault: false,
    userRole: ContentRole.OWNER,
    isHidden: false,
    section: "mine",
    ...overrides,
  };
}

const TEAM = calendar({ id: "team", color: "#00aa00", ownerId: "user-lead", section: "shared" });
const CATEGORY: SerializedCategory = { id: "cat", name: "Deep work", color: "#aa0000" };

describe("event colour", () => {
  const calendars = new Map([[TEAM.id, TEAM]]);
  const categories = new Map([[CATEGORY.id, CATEGORY]]);

  it("paints an event in its calendar's colour, even when it has a category", () => {
    expect(
      resolveEventColor({ calendarId: "team", categoryId: "cat" }, calendars, categories, "#fff"),
    ).toBe("#00aa00");
  });

  it("falls back to the category while the calendar is unknown", () => {
    expect(
      resolveEventColor({ calendarId: "other", categoryId: "cat" }, calendars, categories, "#fff"),
    ).toBe("#aa0000");
  });

  it("falls back to the accent when neither is known", () => {
    expect(
      resolveEventColor({ calendarId: "other", categoryId: "" }, calendars, categories, "#fff"),
    ).toBe("#fff");
  });
});

describe("calendars an event can be filed on", () => {
  it("keeps only calendars the member can edit, with their own default first", () => {
    const colleagueDefault = calendar({
      id: "colleague-default",
      ownerId: "user-lead",
      isDefault: true,
      section: "shared",
      userRole: ContentRole.EDITOR,
    });
    const readOnly = calendar({
      id: "holidays",
      section: "organization",
      userRole: ContentRole.VIEWER,
    });
    const blocked = calendar({ id: "blocked", section: "shared", userRole: ContentRole.BLOCKED });
    const side = calendar({ id: "side" });
    const mine = calendar({ id: "mine", isDefault: true });

    const ids = writableCalendars([colleagueDefault, readOnly, blocked, side, mine]).map(
      (c) => c.id,
    );

    expect(ids).toEqual(["mine", "colleague-default", "side"]);
  });

  it("finds the member's own default, not a colleague's shared one", () => {
    const colleagueDefault = calendar({ id: "theirs", ownerId: "user-lead", isDefault: true });
    const mine = calendar({ id: "mine", isDefault: true });

    expect(defaultCalendarFor([colleagueDefault, mine], ME)?.id).toBe("mine");
    expect(defaultCalendarFor([colleagueDefault, mine], undefined)).toBeUndefined();
  });

  it("labels a row by whose calendar it is", () => {
    expect(calendarHint(calendar({ id: "mine", isDefault: true }))).toBe("Default");
    expect(calendarHint(calendar({ id: "side" }))).toBeUndefined();
    expect(calendarHint(TEAM)).toBe("Shared with you");
    expect(calendarHint(calendar({ id: "org", section: "organization" }))).toBe(
      "Open to the organization",
    );
  });
});

describe("what can double-book the member", () => {
  const mine = memberCommitments(ME, new Set(["my-calendar"]));
  const base = { calendarId: "team", organizerId: "user-lead", attendees: [] };
  const attendee = (status: string) => ({
    id: ME,
    name: "Me",
    email: "me@example.com",
    initials: "ME",
    status,
    role: "required" as const,
  });

  it("counts events the member organizes, attends or files on their own calendar", () => {
    expect(mine({ ...base, organizerId: ME })).toBe(true);
    expect(mine({ ...base, attendees: [attendee("accepted")] })).toBe(true);
    expect(mine({ ...base, attendees: [attendee("pending")] })).toBe(true);
    expect(mine({ ...base, calendarId: "my-calendar" })).toBe(true);
  });

  it("ignores colleagues' meetings on a shared calendar and declined invitations", () => {
    expect(mine(base)).toBe(false);
    expect(mine({ ...base, attendees: [attendee("declined")] })).toBe(false);
  });
});

describe("calendar labels", () => {
  const theirs = calendar({
    id: "theirs",
    ownerId: "user-lead",
    ownerName: "Diana Prince",
    isDefault: true,
  });

  it("names a colleague's default calendar after its owner", () => {
    expect(calendarLabel(theirs, ME)).toBe("Diana Prince");
  });

  it("keeps the stored name for the owner and for other calendars", () => {
    expect(calendarLabel(theirs, "user-lead")).toBe(theirs.name);
    expect(calendarLabel({ ...theirs, isDefault: false }, ME)).toBe(theirs.name);
  });
});
