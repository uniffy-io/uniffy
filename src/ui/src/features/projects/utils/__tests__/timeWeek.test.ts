import { describe, expect, it } from "vitest";
import type { Worklog } from "@/features/projects/types/time";
import {
  addDays,
  buildWeekRows,
  dayStatus,
  dayTotals,
  normalizeWeekStart,
  requiredMinutesOn,
  rowMinutes,
  rowsMissingFrom,
  weekDays,
  weekStartOf,
  weekdayOf,
} from "@/features/projects/utils/timeWeek";

function entry(id: string, overrides: Partial<Worklog> = {}): Worklog {
  return {
    id,
    taskId: "task-1",
    projectId: "project-1",
    userId: "me",
    createdByUserId: "me",
    workDate: "2026-10-22",
    startedAt: null,
    durationMinutes: 30,
    description: "",
    source: "manual",
    createdAt: `2026-10-22T10:00:00.${id.padStart(3, "0")}Z`,
    updatedAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("week arithmetic", () => {
  it("steps days across month and year ends without a clock", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(weekdayOf("2026-10-22")).toBe("thursday");
  });

  it("finds the week start for every supported first day", () => {
    expect(weekStartOf("2026-10-22", "monday")).toBe("2026-10-19");
    expect(weekStartOf("2026-10-22", "sunday")).toBe("2026-10-18");
    expect(weekStartOf("2026-10-22", "saturday")).toBe("2026-10-17");
    expect(weekStartOf("2026-10-19", "monday")).toBe("2026-10-19");
    expect(weekDays("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(normalizeWeekStart("tuesday")).toBe("monday");
    expect(normalizeWeekStart("sunday")).toBe("sunday");
  });
});

describe("requiredMinutesOn", () => {
  const rule = {
    requiredMinutesPerDay: 480,
    workdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    holidays: ["2026-10-23"],
  };

  it("requires time on workdays only and never on a holiday", () => {
    expect(requiredMinutesOn("2026-10-22", rule)).toBe(480);
    expect(requiredMinutesOn("2026-10-24", rule)).toBe(0);
    expect(requiredMinutesOn("2026-10-23", rule)).toBe(0);
  });
});

describe("buildWeekRows", () => {
  const days = weekDays("2026-10-19");

  it("buckets entries by task and day in order of first appearance and keeps extra rows", () => {
    const rows = buildWeekRows(
      [
        entry("3", { taskId: "task-2", workDate: "2026-10-21" }),
        entry("1", { workDate: "2026-10-20" }),
        entry("2", { workDate: "2026-10-20", durationMinutes: 15 }),
        entry("9", { workDate: "2026-10-30" }),
      ],
      days,
      [
        { taskId: "task-3", projectId: "project-2" },
        { taskId: "task-1", projectId: "project-1" },
      ],
    );
    expect(rows.map((row) => row.taskId)).toEqual(["task-1", "task-2", "task-3"]);
    expect(rows[0].cells["2026-10-20"].map((e) => e.id)).toEqual(["1", "2"]);
    expect(rowMinutes(rows[0], days)).toBe(45);
    expect(rowMinutes(rows[2], days)).toBe(0);
    expect(dayTotals(rows, days)["2026-10-20"]).toBe(45);
    expect(dayTotals(rows, days)["2026-10-21"]).toBe(30);
  });
});

describe("rowsMissingFrom", () => {
  it("adds only tasks without a row, once each, in first-logged order", () => {
    const current = buildWeekRows([entry("1")], weekDays("2026-10-19"));
    const previous = [
      entry("a", { taskId: "task-5", workDate: "2026-10-14" }),
      entry("b", { taskId: "task-1", workDate: "2026-10-13" }),
      entry("c", { taskId: "task-4", projectId: "project-2", workDate: "2026-10-12" }),
      entry("d", { taskId: "task-5", workDate: "2026-10-15" }),
    ];
    expect(rowsMissingFrom(current, previous)).toEqual([
      { taskId: "task-4", projectId: "project-2" },
      { taskId: "task-5", projectId: "project-1" },
    ]);
  });
});

describe("dayStatus", () => {
  it("compares the total with the requirement", () => {
    expect(dayStatus(0, 480)).toBe("none");
    expect(dayStatus(120, 480)).toBe("under");
    expect(dayStatus(480, 480)).toBe("met");
    expect(dayStatus(500, 480)).toBe("over");
    expect(dayStatus(60, 0)).toBe("logged");
    expect(dayStatus(0, 0)).toBe("none");
  });
});
