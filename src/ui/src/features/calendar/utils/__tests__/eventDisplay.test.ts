import { describe, it, expect } from "vitest";
import { eventDisplayState } from "@/features/calendar/utils/eventDisplay";
import type { EventStatus, EventTransparency, EventVisibility } from "@/features/calendar/types";

function input(overrides: {
  title?: string;
  status?: EventStatus;
  visibility?: EventVisibility;
  transparency?: EventTransparency;
  isOutOfOffice?: boolean;
  detailsHidden?: boolean;
}) {
  return {
    title: "Design sync",
    status: "confirmed" as EventStatus,
    visibility: "standard" as EventVisibility,
    transparency: "opaque" as EventTransparency,
    isOutOfOffice: false,
    detailsHidden: false,
    ...overrides,
  };
}

describe("eventDisplayState", () => {
  it("passes a plain confirmed event through untouched", () => {
    const display = eventDisplayState(input({}));
    expect(display).toEqual({
      title: "Design sync",
      cancelled: false,
      tentative: false,
      outOfOffice: false,
      free: false,
      detailsHidden: false,
    });
  });

  it("marks cancelled and tentative from the status", () => {
    expect(eventDisplayState(input({ status: "cancelled" })).cancelled).toBe(true);
    expect(eventDisplayState(input({ status: "tentative" })).tentative).toBe(true);
  });

  it("replaces the title with Busy when the server redacted the event", () => {
    const display = eventDisplayState(input({ detailsHidden: true }));
    expect(display.title).toBe("Busy");
    expect(display.detailsHidden).toBe(true);
  });

  it("labels a redacted out-of-office period distinctly", () => {
    const display = eventDisplayState(input({ detailsHidden: true, isOutOfOffice: true }));
    expect(display.title).toBe("Out of office");
    expect(display.outOfOffice).toBe(true);
  });

  it("keeps the real title for a private event the viewer may see", () => {
    const display = eventDisplayState(input({ visibility: "private" }));
    expect(display.title).toBe("Design sync");
  });

  it("flags transparent events as free", () => {
    expect(eventDisplayState(input({ transparency: "transparent" })).free).toBe(true);
  });
});
