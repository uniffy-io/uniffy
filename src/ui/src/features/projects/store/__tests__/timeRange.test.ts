import { describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";

const createWorklog = vi.fn();
vi.mock("@/features/projects/api/timeApi", () => ({
  timeApi: { createWorklog: (...args: unknown[]) => createWorklog(...args) },
}));
vi.mock("@/features/projects/store/projectsThunks", () => ({
  fetchActivities: (taskId: string) => ({ type: "test/fetchActivities", payload: taskId }),
  fetchTask: (taskId: string) => ({ type: "test/fetchTask", payload: taskId }),
}));

const { createWorklogRange } = await import("@/features/projects/store/timeThunks");

const state = {
  auth: { currentOrganizationId: "org" },
  time: { policy: null },
} as unknown as RootState;

async function run(arg: Parameters<typeof createWorklogRange>[0]) {
  const dispatch = (action: unknown): unknown =>
    typeof action === "function" ? action(dispatch, () => state, undefined) : action;
  return (await dispatch(createWorklogRange(arg))) as { payload: unknown };
}

describe("logging a period", () => {
  it("starts each day's entry at the chosen time on that day", async () => {
    createWorklog.mockReset();
    createWorklog.mockResolvedValue({ worklog: {}, taskTimeSpentMinutes: 60 });

    const result = await run({
      taskId: "t1",
      days: ["2026-10-19", "2026-10-20", "2026-10-21"],
      durationMinutes: 60,
      description: "",
      startTime: "13:00",
      timeZone: "Europe/Sofia",
    });

    expect(result.payload).toEqual({ created: 3, failed: null });
    const sent = createWorklog.mock.calls.map(([input]) => [input.workDate, input.startedAt]);
    expect(sent).toEqual([
      ["2026-10-19", "2026-10-19T10:00:00.000Z"],
      ["2026-10-20", "2026-10-20T10:00:00.000Z"],
      ["2026-10-21", "2026-10-21T10:00:00.000Z"],
    ]);
  });

  it("sends no start when the period has no clock time", async () => {
    createWorklog.mockReset();
    createWorklog.mockResolvedValue({ worklog: {}, taskTimeSpentMinutes: 60 });

    await run({
      taskId: "t1",
      days: ["2026-10-19", "2026-10-20"],
      durationMinutes: 60,
      description: "",
      timeZone: "UTC",
    });

    expect(createWorklog.mock.calls.every(([input]) => input.startedAt === undefined)).toBe(true);
  });
});
