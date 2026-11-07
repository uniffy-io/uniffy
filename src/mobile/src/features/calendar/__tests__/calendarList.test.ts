import { describe, expect, it } from "vitest";
import { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import {
  CALENDAR_SECTIONS,
  calendarHint,
  calendarLabel,
  connectionHint,
  defaultCalendarFor,
  memberCommitments,
  providerEditNote,
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
    isReadOnly: false,
    countsAsBusy: false,
    feedBroken: false,
    needsReconnect: false,
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

describe("calendar sections", () => {
  it("follow the web sidebar order", () => {
    expect(CALENDAR_SECTIONS.map((entry) => entry.section)).toEqual([
      "mine",
      "subscribed",
      "connected",
      "shared",
      "organization",
    ]);
  });
});

describe("subscribed calendars", () => {
  const FEED = calendar({ id: "holidays", section: "subscribed", isReadOnly: true });

  it("are never a place to file an event, though the member owns them", () => {
    expect(writableCalendars([FEED, calendar({ id: "work" })]).map((c) => c.id)).toEqual(["work"]);
  });

  it("read as subscribed in a picker hint", () => {
    expect(calendarHint(FEED)).toBe("Subscribed");
  });
});

describe("connected calendars", () => {
  const WORK = calendar({
    id: "work-google",
    section: "connected",
    connection: { provider: "google", accountEmail: "ada@example.com" },
  });
  const MIRROR = calendar({
    id: "outlook-mirror",
    section: "connected",
    isReadOnly: true,
    connection: { provider: "microsoft", accountEmail: "ada@corp.example" },
  });

  it("take events when two-way, never when the provider owns them", () => {
    expect(writableCalendars([WORK, MIRROR]).map((c) => c.id)).toEqual(["work-google"]);
  });

  it("name the provider account they mirror", () => {
    expect(connectionHint(WORK)).toBe("Google Calendar · ada@example.com");
    expect(calendarHint(MIRROR)).toBe("Outlook · ada@corp.example");
    expect(connectionHint(calendar({ id: "side" }))).toBeUndefined();
  });

  it("fall back to a plain label when a shared viewer cannot see the account", () => {
    expect(calendarHint(calendar({ id: "theirs", section: "connected" }))).toBe("Connected");
  });

  it("point a read-only event at the provider it must be edited in", () => {
    const single = { isRecurring: false, isMirroredOccurrence: false };
    expect(providerEditNote({ ...single, providerEditHint: "google" })).toBe(
      "Edit this event in Google Calendar.",
    );
    expect(providerEditNote({ ...single, providerEditHint: "microsoft" })).toBe(
      "Edit this event in Outlook.",
    );
    expect(providerEditNote(single)).toBeUndefined();
  });

  it("name the series for a recurring or mirrored occurrence", () => {
    const hint = { providerEditHint: "google" as const };
    const expected = "Edit this series in Google Calendar.";
    expect(providerEditNote({ ...hint, isRecurring: true, isMirroredOccurrence: false })).toBe(
      expected,
    );
    expect(providerEditNote({ ...hint, isRecurring: false, isMirroredOccurrence: true })).toBe(
      expected,
    );
    expect(
      providerEditNote({
        ...hint,
        isRecurring: false,
        isMirroredOccurrence: false,
        recurrenceId: "series",
      }),
    ).toBe(expected);
  });

  it("explain a read-only calendar when the event carries no provider hint", () => {
    const single = { isRecurring: false, isMirroredOccurrence: false };
    expect(providerEditNote(single, { isReadOnly: true, section: "connected" })).toBe(
      "From a read-only connected calendar. Changes come from its source.",
    );
    expect(providerEditNote(single, { isReadOnly: true, section: "subscribed" })).toBe(
      "From a subscribed calendar. Changes come from its source.",
    );
    expect(providerEditNote(single, { isReadOnly: false, section: "connected" })).toBeUndefined();
  });
});
