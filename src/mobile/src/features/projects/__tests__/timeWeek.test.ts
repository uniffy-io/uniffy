import { describe, expect, it } from "vitest";
import type { SerializedWorklog } from "@features/projects/timeSerializer";
import {
  addDays,
  dayOfMonth,
  dayStatus,
  dayTotals,
  entriesByDay,
  formatDayLong,
  formatDayRange,
  normalizeWeekStart,
  offLabel,
  requirementsFor,
  weekDays,
  weekdayShort,
  weekStartOf,
} from "@features/projects/timeWeek";

function entry(id: string, overrides: Partial<SerializedWorklog> = {}): SerializedWorklog {
  return {
    id,
    taskId: "task-1",
    projectId: "project-1",
    userId: "me",
    createdByUserId: "me",
    workDate: "2026-10-22",
    durationMinutes: 60,
    description: "",
    source: "manual",
    createdAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("week arithmetic", () => {
  it("finds the week around a day for every week start", () => {
    expect(weekStartOf("2026-10-22", "monday")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-22", "sunday")).toBe("2026-10-18");
    expect(weekStartOf("2026-10-22", "saturday")).toBe("2026-10-17");
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(normalizeWeekStart("tuesday")).toBe("monday");
    expect(normalizeWeekStart("sunday")).toBe("sunday");
  });

  it("labels days without a zone in the way", () => {
    expect(weekdayShort("2026-10-22")).toBe("Thu");
    expect(dayOfMonth("2026-10-01")).toBe(1);
    expect(formatDayLong("2026-10-22")).toBe("Thursday, Oct 22");
    expect(formatDayRange("2026-10-19", "2026-10-25")).toBe("Oct 19 to 25");
    expect(formatDayRange("2026-10-26", "2026-11-01")).toBe("Oct 26 to Nov 1");
  });
});

describe("week totals", () => {
  const days = weekDays("2026-10-19");
  const worklogs = [
    entry("b", { createdAt: "2026-10-22T11:00:00.000Z", durationMinutes: 30 }),
    entry("a"),
    entry("c", { workDate: "2026-10-20", durationMinutes: 480 }),
    entry("outside", { workDate: "2026-10-12", durationMinutes: 999 }),
  ];

  it("groups entries by day, oldest first, and sums the week", () => {
    const byDay = entriesByDay(worklogs);
    expect(byDay["2026-10-22"].map((e) => e.id)).toEqual(["a", "b"]);
    expect(dayTotals(worklogs, days)).toEqual({
      "2026-10-19": 0,
      "2026-10-20": 480,
      "2026-10-21": 0,
      "2026-10-22": 90,
      "2026-10-23": 0,
      "2026-10-24": 0,
      "2026-10-25": 0,
    });
  });

  it("reads the requirement the server served and asks nothing elsewhere", () => {
    const requirements = requirementsFor(days, [
      { day: "2026-10-19", minutes: 0, requiredMinutes: 480, off: false },
      { day: "2026-10-20", minutes: 0, requiredMinutes: 240, off: true },
      { day: "2026-10-21", minutes: 0, requiredMinutes: 0, off: true },
    ]);
    expect(requirements["2026-10-19"]).toEqual({ required: 480, off: false });
    expect(requirements["2026-10-20"]).toEqual({ required: 240, off: true });
    expect(requirements["2026-10-25"]).toEqual({ required: 0, off: false });
    expect(offLabel(240, true)).toBe("half day");
    expect(offLabel(0, true)).toBe("off");
    expect(offLabel(480, false)).toBeNull();
  });

  it("grades a day against its requirement", () => {
    expect(dayStatus(0, 480)).toBe("none");
    expect(dayStatus(120, 480)).toBe("under");
    expect(dayStatus(480, 480)).toBe("met");
    expect(dayStatus(600, 480)).toBe("over");
    expect(dayStatus(60, 0)).toBe("logged");
    expect(dayStatus(0, 0)).toBe("none");
  });
});
