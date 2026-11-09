import { describe, expect, it } from "vitest";
import type { CalendarInfo, CalendarPolicyInfo } from "@/features/calendar/types";
import { sidebarSections } from "@/features/calendar/utils/sidebarSections";

const calendar = (id: string, section: CalendarInfo["section"]) =>
  ({ id, section }) as CalendarInfo;

const policy = (overrides: Partial<CalendarPolicyInfo>) =>
  ({
    canSubscribeExternalCalendars: false,
    canConnectProviders: false,
    ...overrides,
  }) as CalendarPolicyInfo;

describe("sidebarSections", () => {
  it("hides the connected section when there is nothing to show or add", () => {
    const ids = sidebarSections([calendar("a", "mine")], policy({})).map((entry) => entry.id);
    expect(ids).toEqual(["calendars"]);
  });

  it("shows an empty connected section when the member may connect an account", () => {
    const sections = sidebarSections([], policy({ canConnectProviders: true }));
    expect(sections.map((entry) => entry.id)).toEqual(["calendars", "connected_calendars"]);
    expect(sections[1]).toMatchObject({ title: "Connected", rows: [] });
  });

  it("keeps connected calendars listed after the policy turns sync off", () => {
    const sections = sidebarSections(
      [calendar("a", "mine"), calendar("b", "connected"), calendar("c", "subscribed")],
      policy({}),
    );
    expect(sections.map((entry) => entry.id)).toEqual([
      "calendars",
      "subscribed_calendars",
      "connected_calendars",
    ]);
    expect(sections[2].rows.map((row) => row.id)).toEqual(["b"]);
  });
});
