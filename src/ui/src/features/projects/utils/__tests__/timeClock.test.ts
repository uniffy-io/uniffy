import { describe, expect, it } from "vitest";
import type { Worklog } from "@/features/projects/types/time";
import {
  daysInRange,
  endOf,
  endSlots,
  instantOf,
  layoutColumns,
  minutesOfDay,
  periodDays,
  snapMinutes,
  startSlots,
  timelineFor,
  wallOf,
  wallTimeOf,
} from "@/features/projects/utils/timeClock";

function entry(id: string, overrides: Partial<Worklog> = {}): Worklog {
  return {
    id,
    taskId: "task-1",
    projectId: "project-1",
    userId: "me",
    createdByUserId: "me",
    workDate: "2026-10-22",
    startedAt: null,
    durationMinutes: 60,
    description: "",
    source: "manual",
    createdAt: `2026-10-22T10:00:00.000Z`,
    updatedAt: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("wall clock arithmetic", () => {
  it("converts between minutes and labels and snaps to the grid", () => {
    expect(minutesOfDay("09:30")).toBe(570);
    expect(wallOf(570)).toBe("09:30");
    expect(wallOf(1500)).toBe("24:00");
    expect(endOf("23:30", 60)).toBe("24:00");
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(38)).toBe(45);
    expect(startSlots()[0]).toBe("00:00");
    expect(startSlots().at(-1)).toBe("23:30");
    expect(endSlots()[0]).toBe("00:30");
    expect(endSlots().at(-1)).toBe("24:00");
  });

  it("maps a wall time to an instant and back through the zone", () => {
    const iso = instantOf("2026-10-22", "09:30", "Europe/Sofia");
    expect(iso).toBe("2026-10-22T06:30:00.000Z");
    expect(wallTimeOf(iso, "Europe/Sofia")).toEqual({ day: "2026-10-22", wall: "09:30" });
    expect(wallTimeOf("2026-10-22T22:30:00.000Z", "Europe/Sofia")).toEqual({
      day: "2026-10-23",
      wall: "01:30",
    });
  });
});

describe("periods", () => {
  const rule = {
    requiredMinutesPerDay: 480,
    workdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    holidays: ["2026-10-21"],
  };

  it("lists the days of a range and refuses a reversed or oversized one", () => {
    expect(daysInRange("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(daysInRange("2026-10-22", "2026-10-21")).toEqual([]);
    expect(daysInRange("2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("keeps the days that expect hours unless days off are wanted", () => {
    expect(periodDays("2026-10-19", "2026-10-25", false, rule)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(periodDays("2026-10-19", "2026-10-25", true, rule)).toHaveLength(7);
  });
});

describe("timeline", () => {
  it("places entries with a start on the day and leaves the rest aside", () => {
    const timeline = timelineFor(
      [
        entry("late", { startedAt: "2026-10-22T20:30:00.000Z", durationMinutes: 120 }),
        entry("none"),
        entry("other-day", { startedAt: "2026-10-22T22:30:00.000Z" }),
        entry("early", { startedAt: "2026-10-22T06:00:00.000Z", durationMinutes: 30 }),
      ],
      "2026-10-22",
      "Europe/Sofia",
    );
    expect(timeline.blocks.map((b) => [b.entry.id, b.start, b.length])).toEqual([
      ["early", 540, 30],
      ["late", 1410, 30],
    ]);
    expect(timeline.unplaced.map((e) => e.id)).toEqual(["none", "other-day"]);
  });

  it("gives overlapping blocks their own columns and leaves the rest full width", () => {
    const blocks = [
      { entry: entry("a"), start: 540, length: 60 },
      { entry: entry("b"), start: 570, length: 60 },
      { entry: entry("c"), start: 600, length: 30 },
      { entry: entry("d"), start: 720, length: 60 },
    ];
    expect(layoutColumns(blocks)).toEqual([
      { column: 0, columns: 2 },
      { column: 1, columns: 2 },
      { column: 0, columns: 2 },
      { column: 0, columns: 1 },
    ]);
  });
});
