import { describe, expect, it } from "vitest";
import type { Timer } from "@/features/projects/types/time";
import {
  formatClock,
  roundTimerMinutes,
  timerElapsedSeconds,
} from "@/features/projects/utils/timerElapsed";

function timer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: "t",
    taskId: "task",
    projectId: "project",
    description: "",
    startedAt: "2026-10-22T10:00:00.000Z",
    accumulatedSeconds: 30,
    pausedAt: null,
    pauseReason: null,
    taskTitle: "Home feed",
    taskNumber: 169,
    projectSlug: "mob",
    ...overrides,
  };
}

describe("timerElapsedSeconds", () => {
  it("adds the running segment to the finished ones", () => {
    expect(timerElapsedSeconds(timer(), Date.parse("2026-10-22T10:01:30.000Z"))).toBe(120);
  });

  it("holds still while paused and never counts backwards", () => {
    expect(timerElapsedSeconds(timer({ startedAt: null }), Date.now())).toBe(30);
    expect(timerElapsedSeconds(timer(), Date.parse("2026-10-22T09:59:00.000Z"))).toBe(30);
  });
});

describe("roundTimerMinutes", () => {
  it.each([
    [5620, 5, 95],
    [5620, 1, 94],
    [5620, 6, 96],
    [5620, 10, 90],
    [5620, 15, 90],
    [20, 5, 5],
    [0, 15, 15],
    [150, 5, 5],
    [90, 1, 2],
    [3600, 15, 60],
  ])("rounds %i seconds at %i minutes to %i", (seconds, increment, expected) => {
    expect(roundTimerMinutes(seconds, increment)).toBe(expected);
  });
});

describe("formatClock", () => {
  it("switches to hours past sixty minutes", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3661)).toBe("1:01:01");
  });
});
