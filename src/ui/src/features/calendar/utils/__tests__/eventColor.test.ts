import { describe, expect, it } from "vitest";
import { ACCENT_EVENT_COLOR } from "@/features/calendar/constants/categoryColors";
import { resolveEventColor } from "@/features/calendar/utils/eventColor";
import type { CalendarInfo, Category } from "@/features/calendar/types";

function calendar(overrides: Partial<CalendarInfo>): CalendarInfo {
  return {
    id: "cal",
    organizationId: "org",
    ownerId: "me",
    ownerName: "Me",
    name: "Team",
    description: "",
    color: "#EC4899",
    kind: "team",
    isDefault: false,
    accessMode: 0,
    userRole: 0,
    isHidden: false,
    section: "mine",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const categories: Record<string, Category> = {
  meetings: {
    id: "meetings",
    name: "Meetings",
    color: "#3B82F6",
    isDefault: true,
    organizationId: "org",
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
};

describe("resolveEventColor", () => {
  it("paints an event with its calendar's colour ahead of its category", () => {
    const calendars = { cal: calendar({}) };
    expect(
      resolveEventColor({ categoryId: "meetings", calendarId: "cal" }, categories, calendars),
    ).toBe("#EC4899");
  });

  it("paints the member's own default calendar with its colour too", () => {
    const calendars = { cal: calendar({ isDefault: true, section: "mine", color: "#10B981" }) };
    expect(resolveEventColor({ calendarId: "cal" }, categories, calendars)).toBe("#10B981");
  });

  it("falls back to the category for a calendar not in the list", () => {
    expect(resolveEventColor({ categoryId: "meetings", calendarId: "gone" }, categories, {})).toBe(
      "#3B82F6",
    );
  });

  it("falls back to the accent with neither calendar nor category", () => {
    expect(resolveEventColor({ calendarId: "gone" }, categories, {})).toBe(ACCENT_EVENT_COLOR);
  });
});
