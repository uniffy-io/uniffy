import { describe, expect, it } from "vitest";
import { calendarUiReducer, selectEvent } from "@/features/calendar/store/calendarUiSlice";
import { updateEvent } from "@/features/calendar/store/calendarThunks";
import type { CalendarEvent } from "@/features/calendar/types";

describe("recurring event selection", () => {
  const saved = { id: "override" } as CalendarEvent;
  const action = updateEvent.fulfilled(saved, "request", {
    eventId: "series_2026-10-19",
    recurrenceEditScope: "this_event",
  });

  it("follows the saved occurrence instead of its expanded ID", () => {
    const state = calendarUiReducer(undefined, selectEvent("series_2026-10-19"));
    expect(calendarUiReducer(state, action).selectedEventId).toBe("override");
  });

  it.each([null, "different-event"])("preserves a selection changed during save: %s", (id) => {
    const state = calendarUiReducer(undefined, selectEvent(id));
    expect(calendarUiReducer(state, action).selectedEventId).toBe(id);
  });
});
