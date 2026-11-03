import { describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import {
  MAX_UNMOUNTED_METRICS,
  dashboardReducer,
  metricMounted,
  metricUnmounted,
  metricsInvalidated,
} from "@/features/dashboard/store/dashboardSlice";
import {
  type FetchMetricArgs,
  fetchTaskMetric,
  refreshTaskMetrics,
  restorePreviousDashboard,
} from "@/features/dashboard/store/dashboardThunks";
import type { TaskMetrics, WidgetFilters } from "@/features/dashboard/types";

const { getTaskMetrics, restorePrevious, getDashboard } = vi.hoisted(() => ({
  getTaskMetrics: vi.fn(),
  restorePrevious: vi.fn(),
  getDashboard: vi.fn(),
}));
vi.mock("@/features/dashboard/api/dashboardApi", () => ({
  dashboardApi: { getTaskMetrics, restorePrevious, getDashboard },
}));

const filters: WidgetFilters = {
  projects: "all",
  projectIds: [],
  people: "everyone",
  sprint: "any",
};
const args = (key: string): FetchMetricArgs => ({ key, metric: "overdue", filters });
const metrics = (title: string): TaskMetrics =>
  ({
    total: 1,
    items: [{ title }],
    workload: [],
    statusByProject: [],
    bugTrend: [],
    sprints: [],
  }) as unknown as TaskMetrics;

type State = ReturnType<typeof dashboardReducer>;
const empty = (): State => dashboardReducer(undefined, { type: "init" });

function loaded(state: State, key: string, title: string, generation = state.metricsGeneration) {
  const pending = dashboardReducer(state, fetchTaskMetric.pending("r", args(key)));
  return dashboardReducer(
    pending,
    fetchTaskMetric.fulfilled({ metrics: metrics(title), generation }, "r", args(key)),
  );
}

describe("dashboard metric cache", () => {
  it("clears cached results on an access change and drops answers already in flight", () => {
    let state = dashboardReducer(empty(), metricMounted("a"));
    state = loaded(state, "a", "Private task");
    const started = state.metricsGeneration;
    state = dashboardReducer(state, fetchTaskMetric.pending("r2", args("a")));

    state = dashboardReducer(state, metricsInvalidated());
    expect(state.metrics.a.data).toBeUndefined();
    expect(state.metrics.a.args?.key).toBe("a");

    state = dashboardReducer(
      state,
      fetchTaskMetric.fulfilled(
        { metrics: metrics("Private task"), generation: started },
        "r2",
        args("a"),
      ),
    );
    expect(state.metrics.a.data).toBeUndefined();

    state = dashboardReducer(state, fetchTaskMetric.rejected(new Error("denied"), "r3", args("a")));
    expect(state.metrics.a.data).toBeUndefined();
  });

  it("refreshes only the requests a widget on screen still shows", async () => {
    let state = dashboardReducer(empty(), metricMounted("everyone"));
    state = loaded(state, "everyone", "x");
    state = dashboardReducer(state, metricMounted("me"));
    state = loaded(state, "me", "y");
    state = dashboardReducer(state, metricUnmounted("everyone"));

    getTaskMetrics.mockResolvedValue(metrics("z"));
    const dispatched: FetchMetricArgs[] = [];
    const root = {
      auth: { currentOrganizationId: "org" },
      dashboard: state,
    } as unknown as RootState;
    const dispatch = vi.fn((action: unknown) => {
      if (typeof action === "function") return action(dispatch, () => root, undefined);
      const typed = action as { type: string; meta?: { arg: FetchMetricArgs } };
      if (typed.type === fetchTaskMetric.pending.type && typed.meta) {
        dispatched.push(typed.meta.arg);
      }
      return action;
    });
    await refreshTaskMetrics()(dispatch, () => root, undefined);

    expect(dispatched.map((arg) => arg.key)).toEqual(["me"]);
  });

  it("keeps only a bounded number of results no widget shows", () => {
    let state = empty();
    const total = MAX_UNMOUNTED_METRICS + 3;
    for (let index = 0; index < total; index += 1) {
      state = dashboardReducer(state, metricMounted(`k${index}`));
      state = loaded(state, `k${index}`, "t");
      state = dashboardReducer(state, metricUnmounted(`k${index}`));
    }
    const keys = Object.keys(state.metrics);
    expect(keys).toHaveLength(MAX_UNMOUNTED_METRICS);
    expect(keys).not.toContain("k0");
    expect(keys).toContain(`k${total - 1}`);
  });

  it("revives a released result when its widget returns", () => {
    let state = dashboardReducer(empty(), metricMounted("a"));
    state = loaded(state, "a", "kept");
    state = dashboardReducer(state, metricUnmounted("a"));
    state = dashboardReducer(state, metricMounted("a"));
    expect(state.metrics.a.mounted).toBe(1);
    expect(state.metrics.a.data).toBeDefined();
  });
});

describe("restoring the previous dashboard", () => {
  it("names the revision a proposal wrote, so a later save makes the server refuse", async () => {
    let state = empty();
    state = { ...state, saved: { definition: null, revision: 5, hasPrevious: true } };
    const root = {
      auth: { currentOrganizationId: "org" },
      dashboard: state,
    } as unknown as RootState;
    restorePrevious.mockRejectedValue(new Error("changed"));
    getDashboard.mockResolvedValue(state.saved);
    const dispatch = vi.fn((action: unknown) =>
      typeof action === "function" ? action(dispatch, () => root, undefined) : action,
    );

    const result = await restorePreviousDashboard({ expectedRevision: 3, organizationId: "org" })(
      dispatch,
      () => root,
      undefined,
    );

    expect(restorePrevious).toHaveBeenCalledWith("org", 3);
    expect(result.type).toBe(restorePreviousDashboard.rejected.type);
  });

  it("refuses to restore a version pinned in another organization", async () => {
    const root = {
      auth: { currentOrganizationId: "org-b" },
      dashboard: { ...empty(), saved: { definition: null, revision: 3, hasPrevious: true } },
    } as unknown as RootState;
    restorePrevious.mockClear();
    const dispatch = vi.fn((action: unknown) => action);

    const result = await restorePreviousDashboard({ expectedRevision: 3, organizationId: "org-a" })(
      dispatch,
      () => root,
      undefined,
    );

    expect(restorePrevious).not.toHaveBeenCalled();
    expect(result.type).toBe(restorePreviousDashboard.rejected.type);
  });
});
