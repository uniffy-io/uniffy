import { configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { timeApi } from "@/features/projects/api/timeApi";
import { initialTimeState, timeReducer } from "@/features/projects/store/timeSlice";
import {
  createWorklogRange,
  createWorklog,
  deleteWorklog,
  stopTimer,
  startTimer,
  updateWorklog,
  fetchReviewEligibility,
  fetchReviewTimesheets,
  fetchTaskWorklogs,
  fetchTimePolicy,
  saveTimePolicy,
} from "@/features/projects/store/timeThunks";
import type { TimePolicy, Timer, Worklog } from "@/features/projects/types/time";

vi.mock("@/features/projects/api/timeApi", () => ({
  timeApi: {
    createWorklog: vi.fn(),
    getTimePolicy: vi.fn(),
    updateTimePolicy: vi.fn(),
    listReviewTimesheets: vi.fn(),
    listTaskWorklogs: vi.fn(),
  },
}));
vi.mock("@/features/projects/store/projectsThunks", () => ({
  fetchActivities: () => ({ type: "test/activities" }),
  fetchTask: () => ({ type: "test/task" }),
}));

function fixture() {
  const store = configureStore({
    reducer: (
      state = {
        time: initialTimeState,
        auth: { currentOrganizationId: "org-a", user: { id: "person" } },
      } as RootState,
      action,
    ) => {
      if (resetOrganizationScope.match(action))
        return {
          ...state,
          time: initialTimeState,
          auth: { ...state.auth, currentOrganizationId: "org-b" },
        };
      return { ...state, time: timeReducer(state.time, action) };
    },
    middleware: (defaults) => defaults().prepend(sessionScopeMiddleware),
  });
  return { ...store, dispatch: store.dispatch as AppDispatch };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function entry(id: string, day = "2026-10-19"): Worklog {
  return {
    id,
    taskId: "task",
    projectId: "project",
    userId: "person",
    createdByUserId: "person",
    workDate: day,
    startedAt: null,
    durationMinutes: 60,
    description: "",
    source: "manual",
    createdAt: `${day}T12:00:00Z`,
    updatedAt: `${day}T12:00:00Z`,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("time requests", () => {
  it("refreshes offset pagination after deletion so the shifted boundary entry is not skipped", async () => {
    const store = fixture();
    let records = Array.from({ length: 51 }, (_, index) => entry(String(index)));
    vi.mocked(timeApi.listTaskWorklogs).mockImplementation(async (_taskId, _orgId, token = "") => ({
      worklogs: records.slice(Number(token || 0), Number(token || 0) + 50),
      nextPageToken: records.length > Number(token || 0) + 50 ? "50" : "",
    }));
    await store.dispatch(fetchTaskWorklogs("task"));
    records = records.slice(1);
    store.dispatch(
      deleteWorklog.fulfilled(
        { taskId: "task", worklogId: "0", taskTimeSpentMinutes: 3000 },
        "deleted",
        { taskId: "task", worklogId: "0" },
      ),
    );
    await store.dispatch(fetchTaskWorklogs({ taskId: "task", pageToken: "50" }));
    expect(timeApi.listTaskWorklogs).toHaveBeenLastCalledWith("task", "org-a", "");
    expect(store.getState().time.worklogsByTask.task).toHaveLength(50);
    expect(store.getState().time.worklogsByTask.task.some((row) => row.id === "50")).toBe(true);
  });

  it.each(["create", "update", "stop", "replace"] as const)(
    "invalidates a loaded cursor after %s",
    async (operation) => {
      const store = fixture();
      const worklog = entry("changed");
      vi.mocked(timeApi.listTaskWorklogs).mockResolvedValue({
        worklogs: [worklog],
        nextPageToken: "50",
      });
      await store.dispatch(fetchTaskWorklogs("task"));
      if (operation === "create")
        store.dispatch(
          createWorklog.fulfilled({ worklog, taskTimeSpentMinutes: 60 }, "write", {
            taskId: "task",
            workDate: worklog.workDate,
            durationMinutes: 60,
          }),
        );
      if (operation === "update")
        store.dispatch(
          updateWorklog.fulfilled({ worklog, taskTimeSpentMinutes: 60 }, "write", {
            id: worklog.id,
            taskId: "task",
            workDate: "2026-10-18",
          }),
        );
      if (operation === "stop")
        store.dispatch(
          stopTimer.fulfilled({ taskId: "task", worklog, taskTimeSpentMinutes: 60 }, "write", {}),
        );
      if (operation === "replace")
        store.dispatch(
          startTimer.fulfilled({ timer: {} as Timer, stoppedWorklog: worklog }, "write", {
            taskId: "next-task",
          }),
        );
      expect(store.getState().time.taskHistoryVersions.task).toBe(1);
      const result = await store
        .dispatch(fetchTaskWorklogs({ taskId: "task", pageToken: "50" }))
        .unwrap();
      expect(result.replace).toBe(true);
      expect(timeApi.listTaskWorklogs).toHaveBeenLastCalledWith("task", "org-a", "");
      expect(store.getState().time.taskLoadedVersions.task).toBe(1);
    },
  );

  it("discards a page fetched across a local mutation", async () => {
    const store = fixture();
    vi.mocked(timeApi.listTaskWorklogs).mockResolvedValueOnce({
      worklogs: [entry("first")],
      nextPageToken: "50",
    });
    await store.dispatch(fetchTaskWorklogs("task"));
    const pending = deferred<Awaited<ReturnType<typeof timeApi.listTaskWorklogs>>>();
    vi.mocked(timeApi.listTaskWorklogs).mockReturnValueOnce(pending.promise);
    const page = store.dispatch(fetchTaskWorklogs({ taskId: "task", pageToken: "50" }));
    store.dispatch(
      deleteWorklog.fulfilled(
        { taskId: "task", worklogId: "first", taskTimeSpentMinutes: 0 },
        "deleted",
        { taskId: "task", worklogId: "first" },
      ),
    );
    pending.resolve({ worklogs: [entry("stale")], nextPageToken: "100" });
    await page;
    expect(store.getState().time.worklogsByTask.task).toEqual([]);
    expect(store.getState().time.taskPageTokens.task).toBe("50");
    expect(store.getState().time.taskLoadedVersions.task).toBe(0);
    expect(store.getState().time.taskHistoryVersions.task).toBe(1);
  });

  it("keeps range busy until all daily writes have settled", async () => {
    const store = fixture();
    vi.mocked(timeApi.listTaskWorklogs).mockResolvedValueOnce({
      worklogs: [],
      nextPageToken: "50",
    });
    await store.dispatch(fetchTaskWorklogs("task"));
    const refreshableVersions: number[] = [];
    const unsubscribe = store.subscribe(() => {
      const state = store.getState().time;
      if (
        state.taskHistoryVersions.task > (state.taskLoadedVersions.task ?? 0) &&
        !state.saving &&
        !state.rangeSaving
      )
        refreshableVersions.push(state.taskHistoryVersions.task);
    });
    vi.mocked(timeApi.createWorklog).mockImplementation(async (input) => ({
      worklog: entry(input.workDate, input.workDate),
      taskTimeSpentMinutes: 60,
    }));
    await store.dispatch(
      createWorklogRange({
        taskId: "task",
        days: ["2026-10-19", "2026-10-20", "2026-10-21"],
        timeZone: "UTC",
        durationMinutes: 60,
      }),
    );
    unsubscribe();
    expect(refreshableVersions).toEqual([3]);
    expect(timeApi.listTaskWorklogs).toHaveBeenCalledTimes(1);
  });

  it.each(["load", "save"] as const)(
    "does not hydrate a late policy %s into another organization",
    async (operation) => {
      const store = fixture();
      const old = deferred<TimePolicy>();
      const policyA = { enabled: false } as TimePolicy;
      const policyB = { enabled: true } as TimePolicy;
      vi.mocked(timeApi.getTimePolicy).mockReturnValueOnce(old.promise);
      vi.mocked(timeApi.updateTimePolicy).mockReturnValueOnce(old.promise);
      const request = store.dispatch(
        operation === "save" ? saveTimePolicy(policyA) : fetchTimePolicy(),
      );
      store.dispatch(resetOrganizationScope());
      store.dispatch(fetchTimePolicy.fulfilled(policyB, "org-b"));
      old.resolve(policyA);
      const result = await request;
      expect(result.meta.requestStatus).toBe("rejected");
      expect(store.getState().time.policy).toEqual(policyB);
    },
  );

  it("retains reviewer eligibility after an empty filtered response", async () => {
    const store = fixture();
    vi.mocked(timeApi.listReviewTimesheets)
      .mockResolvedValueOnce({
        rows: [{ userId: "report" }],
        viewerIsTimekeepingAdmin: false,
      } as Awaited<ReturnType<typeof timeApi.listReviewTimesheets>>)
      .mockResolvedValueOnce({
        rows: [],
        viewerIsTimekeepingAdmin: false,
        nextPageToken: "",
        period: null,
      } as unknown as Awaited<ReturnType<typeof timeApi.listReviewTimesheets>>);
    await store.dispatch(fetchReviewEligibility("2026-10-19"));
    await store.dispatch(fetchReviewTimesheets({ periodStart: "2026-10-19", query: "Nobody" }));
    expect(store.getState().time.review.rows).toEqual([]);
    expect(store.getState().time.reviewEligibility.eligible).toBe(true);
    expect(timeApi.listReviewTimesheets).toHaveBeenNthCalledWith(
      1,
      { periodStart: "2026-10-19" },
      "org-a",
    );
  });

  it("loads history one page at a time and deduplicates overlapping pages", async () => {
    const store = fixture();
    vi.mocked(timeApi.listTaskWorklogs)
      .mockResolvedValueOnce({ worklogs: [entry("first")], nextPageToken: "50" })
      .mockResolvedValueOnce({
        worklogs: [entry("first"), entry("older", "2026-10-18")],
        nextPageToken: "100",
      });
    await store.dispatch(fetchTaskWorklogs("task"));
    expect(timeApi.listTaskWorklogs).toHaveBeenCalledTimes(1);
    expect(store.getState().time.taskPageTokens.task).toBe("50");
    await store.dispatch(fetchTaskWorklogs({ taskId: "task", pageToken: "50" }));
    expect(timeApi.listTaskWorklogs).toHaveBeenLastCalledWith("task", "org-a", "50");
    expect(store.getState().time.worklogsByTask.task.map((row) => row.id)).toEqual([
      "first",
      "older",
    ]);
    expect(store.getState().time.taskPageTokens.task).toBe("100");
  });

  it("ignores an obsolete history response after a refresh", async () => {
    const store = fixture();
    const old = deferred<Awaited<ReturnType<typeof timeApi.listTaskWorklogs>>>();
    vi.mocked(timeApi.listTaskWorklogs)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ worklogs: [entry("fresh")], nextPageToken: "" });
    const request = store.dispatch(fetchTaskWorklogs({ taskId: "task", pageToken: "50" }));
    await store.dispatch(fetchTaskWorklogs("task"));
    old.resolve({ worklogs: [entry("stale")], nextPageToken: "100" });
    await request;
    expect(store.getState().time.worklogsByTask.task.map((row) => row.id)).toEqual(["fresh"]);
    expect(store.getState().time.taskPageTokens.task).toBe("");
  });

  it("returns first unfinished day so a partial range resumes without duplicate writes", async () => {
    const store = fixture();
    const committed: string[] = [];
    let failure = true;
    vi.mocked(timeApi.createWorklog).mockImplementation(async (input) => {
      if (input.workDate === "2026-10-21" && failure) {
        failure = false;
        throw new Error("Temporarily unavailable");
      }
      committed.push(input.workDate);
      return {
        worklog: entry(`entry-${committed.length}`, input.workDate),
        taskTimeSpentMinutes: committed.length * 60,
      };
    });
    const days = ["2026-10-19", "2026-10-20", "2026-10-21"];
    const input = { taskId: "task", days, timeZone: "UTC", durationMinutes: 60 };
    const first = await store.dispatch(createWorklogRange(input)).unwrap();
    expect(first).toEqual({ created: 2, failed: "2026-10-21" });
    await store
      .dispatch(createWorklogRange({ ...input, days: days.filter((day) => day >= first.failed!) }))
      .unwrap();
    expect(committed).toEqual(days);
  });
});
