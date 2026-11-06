import { afterEach, describe, expect, it } from "vitest";
import { eventWhen } from "@/features/search/utils/eventWhen";
import { setPreferredTimeZone } from "@/shared/utils/timezone";

const feedHoliday = {
  start_time: "2027-01-01T00:00:00+00:00",
  is_all_day: "true",
  timezone: "UTC",
};

describe("eventWhen", () => {
  afterEach(() => setPreferredTimeZone(null));

  it("keeps an all-day feed holiday on its own date west of UTC", () => {
    setPreferredTimeZone("America/New_York");

    expect(eventWhen(feedHoliday)).toBe("Jan 1, 2027");
  });

  it("tells the yearly hits of one holiday apart", () => {
    const next = { ...feedHoliday, start_time: "2028-01-01T00:00:00+00:00" };

    expect(eventWhen(feedHoliday)).not.toBe(eventWhen(next));
  });

  it("shows the time of a timed event in the display zone", () => {
    setPreferredTimeZone("Europe/Sofia");

    expect(
      eventWhen({ start_time: "2026-11-06T09:00:00+00:00", is_all_day: "false", timezone: "UTC" }),
    ).toBe("Nov 6, 2026, 11:00 AM");
  });

  it("says nothing without a start", () => {
    expect(eventWhen({})).toBe("");
  });
});
