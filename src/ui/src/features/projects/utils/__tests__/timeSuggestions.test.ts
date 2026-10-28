import { describe, expect, it } from "vitest";
import type { Task } from "@/features/projects/types";
import type { WeekEvent, Worklog } from "@/features/projects/types/time";
import {
  completedSuggestions,
  eventSuggestions,
  meetingsTaskOf,
} from "@/features/projects/utils/timeSuggestions";
import { makeTask } from "./taskFixtures";

const ME = "user-me";
const DAYS = [
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
];
const utcDay = (iso: string) => iso.slice(0, 10);

function event(id: string, overrides: Partial<WeekEvent> = {}): WeekEvent {
  return {
    id,
    title: `Event ${id}`,
    startTime: "2026-10-20T09:00:00.000Z",
    endTime: "2026-10-20T10:00:00.000Z",
    allDay: false,
    outOfOffice: false,
    focusTime: false,
    cancelled: false,
    transparent: false,
    participantIds: [ME, "user-2"],
    ...overrides,
  };
}

function entry(overrides: Partial<Worklog>): Worklog {
  return {
    id: "w",
    taskId: "task-meetings",
    projectId: "p-int",
    userId: ME,
    createdByUserId: ME,
    workDate: "2026-10-20",
    startedAt: null,
    durationMinutes: 60,
    description: "",
    source: "manual",
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("eventSuggestions", () => {
  it("keeps timed meetings the person attends inside the week, in start order", () => {
    const out = eventSuggestions(
      [
        event("late", {
          startTime: "2026-10-22T14:00:00.000Z",
          endTime: "2026-10-22T14:45:00.000Z",
        }),
        event("early"),
      ],
      DAYS,
      ME,
      utcDay,
      [],
      "task-meetings",
    );
    expect(out.map((s) => [s.eventId, s.day, s.minutes])).toEqual([
      ["early", "2026-10-20", 60],
      ["late", "2026-10-22", 45],
    ]);
  });

  it("drops what is not a meeting of the person's", () => {
    const out = eventSuggestions(
      [
        event("declined", { participantIds: ["user-2"] }),
        event("all-day", { allDay: true }),
        event("away", { outOfOffice: true }),
        event("focus", { focusTime: true }),
        event("cancelled", { cancelled: true }),
        event("free", { transparent: true }),
        event("outside", {
          startTime: "2026-10-26T09:00:00.000Z",
          endTime: "2026-10-26T10:00:00.000Z",
        }),
        event("instant", { endTime: "2026-10-20T09:00:00.000Z" }),
        event("two-days", { endTime: "2026-10-22T09:00:00.000Z" }),
      ],
      DAYS,
      ME,
      utcDay,
      [],
      "task-meetings",
    );
    expect(out).toEqual([]);
  });

  it("hides a meeting already logged on the target task that day", () => {
    const logged = [entry({ description: "Event a", workDate: "2026-10-20" })];
    const out = eventSuggestions(
      [event("a"), event("b")],
      DAYS,
      ME,
      utcDay,
      logged,
      "task-meetings",
    );
    expect(out.map((s) => s.eventId)).toEqual(["b"]);
  });

  it("ignores entries on other tasks when deciding what is logged", () => {
    const logged = [entry({ taskId: "task-other", description: "Event a" })];
    const out = eventSuggestions([event("a")], DAYS, ME, utcDay, logged, "task-meetings");
    expect(out.map((s) => s.eventId)).toEqual(["a"]);
  });

  it("places an evening meeting on the day the caller's zone says", () => {
    const sofia = (iso: string) =>
      iso.startsWith("2026-10-20T22") ? "2026-10-21" : iso.slice(0, 10);
    const out = eventSuggestions(
      [
        event("late", {
          startTime: "2026-10-20T22:30:00.000Z",
          endTime: "2026-10-20T23:00:00.000Z",
        }),
      ],
      DAYS,
      ME,
      sofia,
      [],
      null,
    );
    expect(out[0].day).toBe("2026-10-21");
  });
});

describe("completedSuggestions", () => {
  const mine = (id: string, completedAt: string | null, extra: Partial<Task> = {}) =>
    makeTask({ id, assigneeIds: [ME], completedAt, ...extra });

  it("lists the person's tasks completed in the week, newest first, without rows", () => {
    const out = completedSuggestions(
      [
        mine("old", "2026-10-20T08:00:00.000Z"),
        mine("new", "2026-10-22T08:00:00.000Z"),
        mine("open", null),
        mine("theirs", "2026-10-21T08:00:00.000Z", { assigneeIds: ["user-2"] }),
        mine("last-week", "2026-10-15T08:00:00.000Z"),
        mine("has-row", "2026-10-21T08:00:00.000Z"),
      ],
      DAYS,
      ME,
      new Set(["has-row"]),
      utcDay,
    );
    expect(out.map((s) => [s.taskId, s.day])).toEqual([
      ["new", "2026-10-22"],
      ["old", "2026-10-20"],
    ]);
  });
});

describe("meetingsTaskOf", () => {
  const internal = (id: string, number: number, title: string, completedAt: string | null = null) =>
    makeTask({ id, projectId: "p-int", number, title, completedAt });

  it("prefers the Meetings task, whatever its number", () => {
    const task = meetingsTaskOf(
      [internal("admin", 1, "Admin"), internal("meet", 4, " meetings "), makeTask({ id: "x" })],
      "p-int",
    );
    expect(task?.id).toBe("meet");
  });

  it("falls back to the lowest numbered open task and to nothing", () => {
    const tasks = [
      internal("done", 1, "Meetings", "2026-10-01T00:00:00.000Z"),
      internal("b", 3, "Training"),
      internal("a", 2, "Vacation"),
    ];
    expect(meetingsTaskOf(tasks, "p-int")?.id).toBe("a");
    expect(meetingsTaskOf(tasks, null)).toBeNull();
    expect(meetingsTaskOf([], "p-int")).toBeNull();
  });
});
