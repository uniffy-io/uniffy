import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/features/calendar/types";
import { eventSupportsRealtime } from "@/features/calendar/utils/realtimeEligibility";

describe("eventSupportsRealtime", () => {
  const id = "01a0f27c-38de-7067-a94c-7420223b9952";
  it.each([
    [{ id }, true],
    [{ id, isRecurring: true }, false],
    [{ id, recurrence: { pattern: "weekly" } }, false],
    [{ id, isRecurring: true, recurrenceId: id }, true],
    [{ id: `${id}__occurrence__2026-09-30`, isRecurring: true }, false],
    [{ id: "invalid" }, false],
  ])("preserves scope flow for %j", (row, eligible) => {
    expect(eventSupportsRealtime(row as CalendarEvent)).toBe(eligible);
  });
});
