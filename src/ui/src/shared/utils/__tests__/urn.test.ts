import { describe, expect, it } from "vitest";
import { parseUrn, urnToPath, UrnType } from "@/shared/utils/urn";

const ID = "0190f0e0-0000-7000-8000-000000000001";

describe("calendar URNs", () => {
  it("parse as calendars, not events", () => {
    expect(parseUrn(`urn:uniffy:content:CALENDAR:${ID}`).type).toBe(UrnType.CALENDAR);
    expect(parseUrn(`urn:uniffy:content:CALENDAR_EVENT:${ID}`).type).toBe(UrnType.CALENDAR_EVENT);
  });

  it("open the calendar page with the calendar named", () => {
    expect(urnToPath(`urn:uniffy:content:CALENDAR:${ID}`)).toBe(`/calendar?calendar=${ID}`);
  });

  it("leave event links on the event route", () => {
    expect(urnToPath(`urn:uniffy:content:CALENDAR_EVENT:${ID}`)).toBe(`/calendar/${ID}`);
  });
});
