import { afterEach, describe, expect, it } from "vitest";
import { allDayDayKeys, eventDayKey } from "@/features/calendar/utils/dateUtils";
import { positionAllDayEvents } from "@/features/calendar/utils/eventPositioning";
import type { CalendarEvent } from "@/features/calendar/types";
import { setPreferredTimeZone } from "@/shared/utils/timezone";

function allDay(
  id: string,
  startTime: string,
  endTime: string,
  timezone: string,
  isAllDay = true,
): CalendarEvent {
  return { id, title: id, startTime, endTime, timezone, isAllDay } as CalendarEvent;
}

const feedChristmasEve = allDay(
  "christmas-eve",
  "2026-12-24T00:00:00Z",
  "2026-12-25T00:00:00Z",
  "UTC",
);
const sofiaOutOfOffice = allDay(
  "ooo",
  "2026-10-28T22:00:00Z",
  "2026-10-29T22:00:00Z",
  "Europe/Sofia",
);

function week(first: string): Date[] {
  const [year, month, day] = first.split("-").map(Number);
  return Array.from({ length: 7 }, (_, index) => new Date(year, month - 1, day + index));
}

afterEach(() => setPreferredTimeZone(null));

describe("the days an all-day event covers", () => {
  it.each(["Europe/Sofia", "America/New_York", "Asia/Tokyo"])(
    "keeps a feed holiday on its own date for a viewer in %s",
    (zone) => {
      setPreferredTimeZone(zone);

      expect(allDayDayKeys(feedChristmasEve)).toEqual({
        startKey: "2026-12-24",
        endKey: "2026-12-24",
      });
      expect(eventDayKey(feedChristmasEve)).toBe("2026-12-24");
    },
  );

  it("reads a midnight end in the event's zone as exclusive", () => {
    setPreferredTimeZone("America/New_York");

    expect(allDayDayKeys(sofiaOutOfOffice)).toEqual({
      startKey: "2026-10-29",
      endKey: "2026-10-29",
    });
  });

  it("keeps an inclusive end on the last day", () => {
    const offsite = allDay(
      "offsite",
      "2026-10-06T21:00:00Z",
      "2026-10-07T20:59:00Z",
      "Europe/Sofia",
    );

    expect(allDayDayKeys(offsite)).toEqual({ startKey: "2026-10-07", endKey: "2026-10-07" });
  });

  it("falls back to the display zone when the stored zone is unknown", () => {
    setPreferredTimeZone("UTC");
    const odd = allDay("odd", "2026-12-24T00:00:00Z", "2026-12-25T00:00:00Z", "Not/AZone");

    expect(allDayDayKeys(odd)).toEqual({ startKey: "2026-12-24", endKey: "2026-12-24" });
  });

  it("lists a timed event under the display-zone day", () => {
    setPreferredTimeZone("America/New_York");
    const late = allDay("late", "2026-12-24T03:00:00Z", "2026-12-24T04:00:00Z", "UTC", false);

    expect(eventDayKey(late)).toBe("2026-12-23");
  });
});

describe("the all-day lane of a week", () => {
  it("leaves out events from other weeks", () => {
    setPreferredTimeZone("Europe/Sofia");

    const positions = positionAllDayEvents(
      [feedChristmasEve, sofiaOutOfOffice],
      week("2026-11-02"),
    );

    expect(positions).toEqual([]);
  });

  it("puts a feed holiday in its single column", () => {
    setPreferredTimeZone("America/New_York");

    const [position] = positionAllDayEvents([feedChristmasEve], week("2026-12-21"));

    expect(position).toMatchObject({ startColumn: 3, spanColumns: 1, row: 0 });
  });

  it("clamps a span that starts before the week", () => {
    const long = allDay("long", "2026-12-18T00:00:00Z", "2026-12-24T00:00:00Z", "UTC");

    const [position] = positionAllDayEvents([long], week("2026-12-21"));

    expect(position).toMatchObject({ startColumn: 0, spanColumns: 3 });
  });

  it("ignores timed events", () => {
    const timed = allDay("timed", "2026-12-22T09:00:00Z", "2026-12-22T10:00:00Z", "UTC", false);

    expect(positionAllDayEvents([timed], week("2026-12-21"))).toEqual([]);
  });
});
