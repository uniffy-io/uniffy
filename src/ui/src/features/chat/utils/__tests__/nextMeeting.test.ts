import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  pickNextMeeting,
  type MeetingCandidate,
} from "@/features/chat/utils/nextMeeting";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function meeting(overrides: Partial<MeetingCandidate> = {}): MeetingCandidate {
  return {
    id: "event-1",
    title: "Standup",
    startTime: "2026-08-26T13:00:00.000Z",
    endTime: "2026-08-26T13:30:00.000Z",
    cancelled: false,
    ...overrides,
  };
}

describe("pickNextMeeting", () => {
  it("returns nothing when there is no meeting", () => {
    expect(pickNextMeeting([], NOW)).toBeNull();
  });

  it("prefers a meeting running right now over a later one", () => {
    const running = meeting({
      id: "running",
      startTime: "2026-08-26T11:45:00.000Z",
      endTime: "2026-08-26T12:15:00.000Z",
    });
    const later = meeting({ id: "later" });

    expect(pickNextMeeting([later, running], NOW)?.id).toBe("running");
  });

  it("picks the soonest upcoming meeting", () => {
    const soon = meeting({ id: "soon", startTime: "2026-08-26T12:30:00.000Z" });
    const later = meeting({ id: "later", startTime: "2026-08-26T16:00:00.000Z" });

    expect(pickNextMeeting([later, soon], NOW)?.id).toBe("soon");
  });

  it("ignores cancelled meetings", () => {
    const cancelled = meeting({ id: "cancelled", cancelled: true });

    expect(pickNextMeeting([cancelled], NOW)).toBeNull();
  });

  it("ignores meetings that already ended", () => {
    const done = meeting({
      startTime: "2026-08-26T10:00:00.000Z",
      endTime: "2026-08-26T10:30:00.000Z",
    });

    expect(pickNextMeeting([done], NOW)).toBeNull();
  });

  it("orders by epoch, not by ISO string precision", () => {
    // The range RPC returns expanded occurrences whose precision varies; a
    // lexicographic sort would put the second-precision string first.
    const soonest = meeting({ id: "soonest", startTime: "2026-08-26T12:30:00Z" });
    const later = meeting({ id: "later", startTime: "2026-08-26T12:30:00.500Z" });

    expect(pickNextMeeting([later, soonest], NOW)?.id).toBe("soonest");
  });
});

describe("formatCountdown", () => {
  it("reads as now once the meeting has started", () => {
    expect(formatCountdown("2026-08-26T11:59:00.000Z", NOW)).toBe("now");
  });

  it("counts minutes under an hour", () => {
    expect(formatCountdown("2026-08-26T12:10:00.000Z", NOW)).toBe("in 10 min");
  });

  it("counts hours and minutes", () => {
    expect(formatCountdown("2026-08-26T14:20:00.000Z", NOW)).toBe("in 2 h 20 min");
  });

  it("drops the minutes on a whole hour", () => {
    expect(formatCountdown("2026-08-26T15:00:00.000Z", NOW)).toBe("in 3 h");
  });

  it("switches to days past a day out", () => {
    expect(formatCountdown("2026-08-27T18:00:00.000Z", NOW)).toBe("tomorrow");
  });
});
