import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CalendarListSection,
  CalendarSchema,
  CalendarType,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { calendarReducer } from "@/features/calendar/store/calendarSlice";
import { fetchEventsInRange } from "@/features/calendar/store/calendarThunks";
import {
  calendarFromProto,
  deleteCalendar,
  fetchCalendars,
  setCalendarVisibility,
} from "@/features/calendar/store/calendarsThunks";
import type { CalendarEvent, CalendarInfo } from "@/features/calendar/types";

const proto = create(CalendarSchema, {
  id: "team",
  organizationId: "org",
  ownerId: "owner",
  ownerName: "Owner",
  name: "Support rota",
  color: "#14B8A6",
  calendarType: CalendarType.TEAM,
  accessMode: AccessMode.EXPLICIT_MEMBERS,
  userRole: ContentRole.EDITOR,
  isHidden: false,
  section: CalendarListSection.SHARED,
});

const stored: CalendarInfo = calendarFromProto(proto);

const withCalendars = (calendars: CalendarInfo[]) =>
  calendarReducer(undefined, fetchCalendars.fulfilled(calendars, "req", undefined));

describe("calendarFromProto", () => {
  it("maps the wire enums onto the view vocabulary", () => {
    expect(stored).toMatchObject({
      kind: "team",
      section: "shared",
      userRole: ContentRole.EDITOR,
      baselineRole: undefined,
    });
  });
});

describe("calendar list state", () => {
  it("keeps the server's order", () => {
    const second = { ...stored, id: "mine", name: "Mine" };
    const state = withCalendars([second, stored]);
    expect(state.calendarOrder).toEqual(["mine", "team"]);
  });

  it("hides at once and restores when the server refuses", () => {
    const hiding = { calendarId: "team", hidden: true };
    let state = withCalendars([stored]);
    state = calendarReducer(state, setCalendarVisibility.pending("req", hiding));
    expect(state.calendars.team.isHidden).toBe(true);
    state = calendarReducer(state, setCalendarVisibility.rejected(null, "req", hiding, "nope"));
    expect(state.calendars.team.isHidden).toBe(false);
  });

  it("drops a deleted calendar", () => {
    const state = calendarReducer(
      withCalendars([stored]),
      deleteCalendar.fulfilled({ calendarId: "team", eventsMoved: 3, eventsDeleted: 0 }, "req", {
        calendarId: "team",
        disposition: "move",
        targetCalendarId: "mine",
      }),
    );
    expect(state.calendars.team).toBeUndefined();
    expect(state.calendarOrder).toEqual([]);
  });
});

describe("racing requests", () => {
  it("lets the latest visibility click win over an older response", () => {
    const hide = { calendarId: "team", hidden: true };
    const show = { calendarId: "team", hidden: false };
    let state = withCalendars([stored]);
    state = calendarReducer(state, setCalendarVisibility.pending("first", hide));
    state = calendarReducer(state, setCalendarVisibility.pending("second", show));
    // The hide lands after the show was clicked; it must not flip the eye back.
    state = calendarReducer(
      state,
      setCalendarVisibility.fulfilled({ ...stored, isHidden: true }, "first", hide),
    );
    expect(state.calendars.team.isHidden).toBe(false);
    state = calendarReducer(state, setCalendarVisibility.fulfilled(stored, "second", show));
    expect(state.calendars.team.isHidden).toBe(false);
    expect(state.pendingVisibility).toEqual({});
  });

  it("keeps a pending toggle when the calendar list refreshes meanwhile", () => {
    let state = withCalendars([stored]);
    state = calendarReducer(
      state,
      setCalendarVisibility.pending("toggle", { calendarId: "team", hidden: true }),
    );
    state = calendarReducer(state, fetchCalendars.fulfilled([stored], "list", undefined));
    expect(state.calendars.team.isHidden).toBe(true);
  });

  it("ignores an older range response that lands last", () => {
    const range = { startDate: "2026-09-01", endDate: "2026-10-01" };
    const event = (id: string) => ({ id }) as CalendarEvent;
    let state = calendarReducer(undefined, fetchEventsInRange.pending("older", range));
    state = calendarReducer(state, fetchEventsInRange.pending("newer", range));
    state = calendarReducer(state, fetchEventsInRange.fulfilled([event("fresh")], "newer", range));
    state = calendarReducer(state, fetchEventsInRange.fulfilled([event("stale")], "older", range));
    expect(state.visibleEventIds).toEqual(["fresh"]);
  });
});
