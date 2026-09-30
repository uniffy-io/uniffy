import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/features/calendar/types";
import { applyLiveDescription, calendarReducer } from "@/features/calendar/store/calendarSlice";
import { fetchEvent, updateEvent } from "@/features/calendar/store/calendarThunks";

function makeEvent(description: string): CalendarEvent {
  return { id: "ev-1", title: "Sync", description, attendees: [] } as unknown as CalendarEvent;
}

function stateWith(event: CalendarEvent) {
  const initial = calendarReducer(undefined, { type: "@@init" });
  return { ...initial, events: { [event.id]: event }, visibleEventIds: [event.id] };
}

describe("live event descriptions", () => {
  it("keeps the live text through an unrelated server update", () => {
    const live = calendarReducer(
      stateWith(makeEvent("old")),
      applyLiveDescription({ id: "ev-1", description: "new" }),
    );
    const settled = calendarReducer(
      live,
      updateEvent.fulfilled(makeEvent("old"), "req", { eventId: "ev-1", title: "Renamed" }),
    );
    expect(settled.events["ev-1"].description).toBe("new");
  });

  it("accepts the server text when the request carried a description", () => {
    const live = calendarReducer(
      stateWith(makeEvent("old")),
      applyLiveDescription({ id: "ev-1", description: "new" }),
    );
    const settled = calendarReducer(
      live,
      updateEvent.fulfilled(makeEvent("typed"), "req", { eventId: "ev-1", description: "typed" }),
    );
    expect(settled.events["ev-1"].description).toBe("typed");
    expect(settled.liveDescriptionIds["ev-1"]).toBeUndefined();
  });

  it("forgets live ownership when the event is refetched", () => {
    const live = calendarReducer(
      stateWith(makeEvent("old")),
      applyLiveDescription({ id: "ev-1", description: "new" }),
    );
    const refetched = calendarReducer(
      live,
      fetchEvent.fulfilled(makeEvent("rendered"), "req", "ev-1"),
    );
    expect(refetched.events["ev-1"].description).toBe("rendered");
    expect(refetched.liveDescriptionIds["ev-1"]).toBeUndefined();
  });
});
