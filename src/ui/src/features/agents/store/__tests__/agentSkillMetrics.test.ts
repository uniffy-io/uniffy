import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import type { SkillMetric } from "@uniffy/proto/agents/v1/skills_pb";
import { skillsApi } from "@/features/agents/api/skillsApi";
import {
  agentSkillMetricsReducer as reduce,
  selectSkillMetricsEntry,
} from "@/features/agents/store/agentSkillMetricsSlice";
import {
  SKILL_METRICS_PAGE_SIZE,
  fetchSkillMetrics,
  skillMetricRowKey,
  skillMetricToPlain,
  type SerializedSkillMetric,
  type SkillMetricsRequest,
} from "@/features/agents/store/agentSkillMetricsThunks";
import {
  formatAverageDuration,
  formatRunLogCoverage,
  formatShare,
  invocationOutcomes,
  runLogCoverage,
  sortBySkillThenVersionDesc,
  sortByVersionDesc,
} from "@/features/agents/utils/skillMetricsFormat";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";

vi.mock("@/features/agents/api/skillsApi", () => ({
  skillsApi: { getSkillMetrics: vi.fn() },
}));

const protoMetric = (overrides: Partial<SkillMetric> = {}): SkillMetric =>
  ({
    skillId: "skill-1",
    displayName: "Reporter",
    skillVersionId: "version-1",
    skillVersionNumber: 3,
    invocationCount: 12n,
    startedCount: 1n,
    completedCount: 8n,
    failedCount: 2n,
    rejectedCount: 0n,
    cancelledCount: 1n,
    ratedResponseCount: 4n,
    positiveFeedbackCount: 3n,
    negativeFeedbackCount: 1n,
    ratingCount: 4n,
    positiveFeedbackRate: 0.75,
    negativeFeedbackRate: 0.25,
    toolErrorRunCount: 3n,
    toolErrorRate: 0.25,
    uniqueUsers: 5n,
    runLogCount: 9n,
    durationMs: 90_000n,
    inputTokens: 123_456n,
    outputTokens: 7_890n,
    costs: [
      { currency: "USD", amount: "1.2345", runCount: 6n },
      { currency: "EUR", amount: "0.50", runCount: 3n },
    ],
    ...overrides,
  }) as unknown as SkillMetric;

const row = (overrides: Partial<SerializedSkillMetric> = {}): SerializedSkillMetric => ({
  ...skillMetricToPlain(protoMetric()),
  ...overrides,
});

describe("skillMetricToPlain", () => {
  it("turns every int64 into a plain number and keeps money as a decimal string", () => {
    const plain = skillMetricToPlain(protoMetric());
    expect(plain).toEqual({
      skillId: "skill-1",
      displayName: "Reporter",
      skillVersionId: "version-1",
      skillVersionNumber: 3,
      invocationCount: 12,
      startedCount: 1,
      completedCount: 8,
      failedCount: 2,
      rejectedCount: 0,
      cancelledCount: 1,
      toolErrorRunCount: 3,
      toolErrorRate: 0.25,
      uniqueUsers: 5,
      runLogCount: 9,
      durationMs: 90_000,
      inputTokens: 123_456,
      outputTokens: 7_890,
      costs: [
        { currency: "USD", amount: "1.2345", runCount: 6 },
        { currency: "EUR", amount: "0.50", runCount: 3 },
      ],
    });
    for (const value of Object.values(plain)) expect(typeof value).not.toBe("bigint");
    for (const cost of plain.costs) expect(typeof cost.runCount).toBe("number");
  });

  it("carries no rating fields", () => {
    const plain = skillMetricToPlain(protoMetric());
    for (const key of Object.keys(plain)) {
      expect(key).not.toMatch(/rating|feedback|rated/i);
    }
  });

  it("keys rows by the exact version, not the skill", () => {
    const v1 = row({ skillVersionId: "version-1" });
    const v2 = row({ skillVersionId: "version-2" });
    expect(skillMetricRowKey(v1)).not.toBe(skillMetricRowKey(v2));
    expect(skillMetricRowKey(v1)).toBe(skillMetricRowKey(row({ displayName: "Renamed" })));
  });
});

describe("skill metrics formatting", () => {
  it("shows the count's share of invocations and never divides by zero", () => {
    expect(formatShare(3, 12)).toBe("25%");
    expect(formatShare(0, 12)).toBe("0%");
    expect(formatShare(1, 1000)).toBe("<1%");
    expect(formatShare(0, 0)).toBe("–");
  });

  it("distinguishes missing run logs from zero usage", () => {
    const none = row({ runLogCount: 0, durationMs: 0, inputTokens: 0, costs: [] });
    expect(runLogCoverage(none)).toBe("none");
    expect(formatRunLogCoverage(none)).toBe("No run logs");
    expect(formatAverageDuration(none)).toBe("–");

    const partial = row({ invocationCount: 12, runLogCount: 9, durationMs: 90_000 });
    expect(runLogCoverage(partial)).toBe("partial");
    expect(formatRunLogCoverage(partial)).toBe("9 of 12");
    expect(formatAverageDuration(partial)).toBe("10.0s");

    expect(runLogCoverage(row({ invocationCount: 9, runLogCount: 9 }))).toBe("full");
  });

  it("lists every outcome so the breakdown adds up to the invocation count", () => {
    const outcomes = invocationOutcomes(row());
    expect(outcomes.reduce((sum, outcome) => sum + outcome.count, 0)).toBe(12);
    expect(outcomes.map((outcome) => outcome.key)).toEqual([
      "completed",
      "failed",
      "rejected",
      "cancelled",
      "started",
    ]);
  });

  it("orders versions newest first, and org rows by skill name first", () => {
    const rows = [
      row({ skillId: "b", displayName: "Writer", skillVersionId: "b-1", skillVersionNumber: 1 }),
      row({ skillId: "a", displayName: "Reporter", skillVersionId: "a-1", skillVersionNumber: 1 }),
      row({ skillId: "a", displayName: "Reporter", skillVersionId: "a-2", skillVersionNumber: 2 }),
    ];
    expect(sortByVersionDesc(rows.slice(1)).map((r) => r.skillVersionNumber)).toEqual([2, 1]);
    expect(sortBySkillThenVersionDesc(rows).map((r) => r.skillVersionId)).toEqual([
      "a-2",
      "a-1",
      "b-1",
    ]);
  });
});

const request: SkillMetricsRequest = {
  organizationId: "org-1",
  skillId: "",
  windowDays: 30,
  cursor: "",
};
const window = {
  windowStart: { seconds: 1_000, nanos: 0 },
  windowEnd: { seconds: 2_000, nanos: 0 },
};
const credentials = (organizationId?: string) => ({
  organizationId,
  user: {} as Parameters<typeof setCredentials>[0]["user"],
  accessToken: "token",
  refreshToken: "refresh",
});
const initial = () => reduce(undefined, setCredentials(credentials("org-1")));
const root = (state: ReturnType<typeof reduce>, organizationId = "org-1") =>
  ({ agentSkillMetrics: state, auth: { currentOrganizationId: organizationId } }) as RootState;
const pending = (id = "req", arg = request) => fetchSkillMetrics.pending(id, arg);
const fulfilled = (
  id = "req",
  arg = request,
  metrics: SerializedSkillMetric[] = [row()],
  nextCursor = "",
) => fetchSkillMetrics.fulfilled({ ...arg, metrics, nextCursor, ...window }, id, arg);
const rejected = (id = "req", arg = request) => fetchSkillMetrics.rejected(null, id, arg, "Failed");
const select = (state: ReturnType<typeof reduce>, scope = request, organizationId = "org-1") =>
  selectSkillMetricsEntry(scope)(root(state, organizationId));

describe("skill metrics store", () => {
  it("loads the first page with its window bounds", () => {
    let state = reduce(initial(), pending());
    expect(select(state)?.status).toBe("loading");
    state = reduce(state, fulfilled("req", request, [row()], "cursor-2"));
    const entry = select(state);
    expect(entry?.status).toBe("ready");
    expect(entry?.rows).toHaveLength(1);
    expect(entry?.nextCursor).toBe("cursor-2");
    expect(entry?.windowStart).toEqual(window.windowStart);
    expect(entry?.windowEnd).toEqual(window.windowEnd);
  });

  it("appends later pages without duplicating a version already shown", () => {
    let state = reduce(reduce(initial(), pending()), fulfilled("req", request, [row()], "c2"));
    const more = { ...request, cursor: "c2" };
    state = reduce(state, pending("more", more));
    expect(select(state)?.status).toBe("loading-more");
    expect(select(state)?.rows).toHaveLength(1);
    state = reduce(
      state,
      fulfilled("more", more, [row(), row({ skillVersionId: "version-2" })], ""),
    );
    const entry = select(state);
    expect(entry?.status).toBe("ready");
    expect(entry?.rows.map((r) => r.skillVersionId)).toEqual(["version-1", "version-2"]);
    expect(entry?.nextCursor).toBe("");
  });

  it("keeps loaded rows when a later page fails and exposes a retry state", () => {
    let state = reduce(reduce(initial(), pending()), fulfilled("req", request, [row()], "c2"));
    const more = { ...request, cursor: "c2" };
    state = reduce(reduce(state, pending("more", more)), rejected("more", more));
    const entry = select(state);
    expect(entry?.status).toBe("failed");
    expect(entry?.error).toBe("Failed");
    expect(entry?.rows).toHaveLength(1);
  });

  it("ignores stale success and failure once a newer request is pending", () => {
    const state = reduce(reduce(initial(), pending("old")), pending("latest"));
    expect(reduce(state, fulfilled("old"))).toEqual(state);
    expect(reduce(state, rejected("old"))).toEqual(state);
    expect(select(reduce(state, fulfilled("latest")))?.status).toBe("ready");
  });

  it("keeps each window and skill scope apart", () => {
    const ninety = { ...request, windowDays: 90 };
    const skill = { ...request, skillId: "skill-1" };
    let state = reduce(reduce(initial(), pending("a")), fulfilled("a"));
    state = reduce(state, pending("b", ninety));
    state = reduce(state, pending("c", skill));
    expect(select(state)?.status).toBe("ready");
    expect(select(state, ninety)?.status).toBe("loading");
    expect(select(state, skill)?.status).toBe("loading");
    state = reduce(state, fulfilled("c", skill, [row({ skillVersionId: "v9" })]));
    expect(select(state, skill)?.rows[0].skillVersionId).toBe("v9");
    expect(select(state)?.rows[0].skillVersionId).toBe("version-1");
  });

  it.each([
    logout(),
    rehydrateFailed(),
    setCredentials(credentials("org-2")),
    setCredentials(credentials()),
  ])("discards pending responses after $type", (action) => {
    const state = reduce(reduce(initial(), pending()), action);
    expect(reduce(state, fulfilled())).toEqual(state);
    expect(reduce(state, rejected())).toEqual(state);
    expect(state.entries).toEqual({});
  });

  it("does not revive an old request when switching away and back", () => {
    let state = reduce(initial(), pending());
    state = reduce(state, setCredentials(credentials("org-2")));
    state = reduce(state, setCredentials(credentials("org-1")));
    expect(reduce(state, fulfilled())).toEqual(state);
  });

  it("never serves one organization's observations to another", () => {
    const state = reduce(reduce(initial(), pending()), fulfilled());
    expect(select(state)).toBeDefined();
    expect(select(state, request, "org-2")).toBeUndefined();
    expect(reduce(state, pending("wrong", { ...request, organizationId: "org-2" }))).toEqual(state);
  });

  it("initializes restored authentication", () => {
    const state = reduce(undefined, rehydrateComplete(credentials("org-1")));
    expect(select(reduce(reduce(state, pending()), fulfilled()))?.rows).toHaveLength(1);
  });
});

describe("fetchSkillMetrics", () => {
  const getState = (organizationId = "org-1") =>
    ({ auth: { currentOrganizationId: organizationId } }) as RootState;

  beforeEach(() => {
    vi.mocked(skillsApi.getSkillMetrics).mockReset();
    vi.mocked(skillsApi.getSkillMetrics).mockResolvedValue({
      metrics: [protoMetric()],
      nextCursor: "c2",
      windowStart: { seconds: 1_000n, nanos: 0 },
      windowEnd: { seconds: 2_000n, nanos: 0 },
    } as never);
  });

  it("sends the scope, the page size and the cursor, and serializes the page", async () => {
    const arg = { ...request, skillId: "skill-1", windowDays: 7, cursor: "c1" };
    const action = await fetchSkillMetrics(arg)(vi.fn(), getState, undefined);
    expect(skillsApi.getSkillMetrics).toHaveBeenCalledWith({
      organizationId: "org-1",
      skillId: "skill-1",
      windowDays: 7,
      pageSize: SKILL_METRICS_PAGE_SIZE,
      cursor: "c1",
    });
    expect(fetchSkillMetrics.fulfilled.match(action)).toBe(true);
    if (!fetchSkillMetrics.fulfilled.match(action)) return;
    expect(action.payload.cursor).toBe("c1");
    expect(action.payload.nextCursor).toBe("c2");
    expect(action.payload.windowStart).toEqual({ seconds: 1_000, nanos: 0 });
    expect(action.payload.metrics[0].invocationCount).toBe(12);
  });

  it("refuses to fetch for an organization that is no longer current", async () => {
    const action = await fetchSkillMetrics(request)(vi.fn(), () => getState("org-2"), undefined);
    expect(fetchSkillMetrics.rejected.match(action)).toBe(true);
    expect(skillsApi.getSkillMetrics).not.toHaveBeenCalled();
  });
});
