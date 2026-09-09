import { describe, expect, it } from "vitest";
import type { RootState } from "@/app/store";
import {
  agentRunnableSkillsReducer as reduce,
  selectRunnableSkillsForAgent,
  selectRunnableSkillsStatus,
  selectSkillCompatibility,
  selectSkillCompatibilityStatus,
} from "@/features/agents/store/agentRunnableSkillsSlice";
import {
  fetchRunnableSkills,
  fetchSkillCompatibility,
  type RunnableSkillsRequest,
} from "@/features/agents/store/agentRunnableSkillsThunks";
import {
  logout,
  rehydrateComplete,
  rehydrateFailed,
  setCredentials,
} from "@/features/auth/store/authSlice";

const request: RunnableSkillsRequest = {
  organizationId: "org-1",
  agentId: "agent-1",
  surface: "chat",
};
const skills = [
  { id: "s1", name: "report", displayName: "Report", description: "Prepare a report" },
];
const credentials = (organizationId?: string) => ({
  organizationId,
  user: { id: "user-1" } as Parameters<typeof setCredentials>[0]["user"],
  accessToken: "token",
  refreshToken: "refresh",
});

describe("skill compatibility diagnostics", () => {
  const params = { organizationId: "org-1", agentId: "agent-1" };
  const diagnostics = [
    {
      skillId: "s1",
      versionId: "v2",
      versionNumber: 2,
      missingTools: ["notes.read_note"],
      unsupportedSurfaces: ["chat"],
      unavailable: false,
      displayName: "Report",
      retired: false,
    },
  ];
  const start = (id: string) => fetchSkillCompatibility.pending(id, params);
  const finish = (id: string) =>
    fetchSkillCompatibility.fulfilled({ ...params, skills: diagnostics }, id, params);

  it("stores exact-version diagnostics without advertising unavailable skills", () => {
    const state = reduce(reduce(initial(), start("one")), finish("one"));
    expect(selectSkillCompatibility("agent-1")(root(state))).toEqual(diagnostics);
    expect(selectRunnableSkillsForAgent("agent-1", "chat")(root(state))).toEqual([]);
    expect(selectSkillCompatibility("agent-2")(root(state))).toEqual([]);
    expect(selectSkillCompatibility("agent-1")(root(state, "org-2"))).toEqual([]);
  });

  it("clears stale diagnostics during refresh and ignores an older response", () => {
    let state = reduce(reduce(initial(), start("one")), finish("one"));
    state = reduce(state, start("two"));
    expect(selectSkillCompatibility("agent-1")(root(state))).toEqual([]);
    expect(reduce(state, finish("one"))).toEqual(state);
    state = reduce(state, fetchSkillCompatibility.rejected(null, "two", params, "Failed"));
    expect(selectSkillCompatibilityStatus("agent-1")(root(state))).toBe("failed");
  });

  it("drops pending diagnostics across account switches within one organization", () => {
    let state = reduce(initial(), start("one"));
    const next = credentials("org-1");
    next.user.id = "user-2";
    state = reduce(state, setCredentials(next));
    expect(reduce(state, finish("one"))).toEqual(state);
    expect(state.compatibility).toEqual({});
  });

  it.each([logout(), rehydrateFailed(), setCredentials(credentials("org-2"))])(
    "drops pending diagnostics after $type",
    (action) => {
      const state = reduce(reduce(initial(), start("one")), action);
      expect(reduce(state, finish("one"))).toEqual(state);
    },
  );
});
const initial = () => reduce(undefined, setCredentials(credentials("org-1")));
const root = (state: ReturnType<typeof reduce>, organizationId = "org-1") =>
  ({ agentRunnableSkills: state, auth: { currentOrganizationId: organizationId } }) as RootState;
const pending = (id = "req", arg = request) => fetchRunnableSkills.pending(id, arg);
const fulfilled = (id = "req", arg = request) =>
  fetchRunnableSkills.fulfilled({ ...arg, skills }, id, arg);

describe("runnable skill menu isolation", () => {
  it("stores compatible skills by organization, agent and surface", () => {
    const state = reduce(reduce(initial(), pending()), fulfilled());
    expect(selectRunnableSkillsForAgent("agent-1", "chat")(root(state))).toEqual(skills);
    expect(selectRunnableSkillsForAgent("agent-1", "session")(root(state))).toEqual([]);
    expect(selectRunnableSkillsForAgent("other", "chat")(root(state))).toEqual([]);
    expect(selectRunnableSkillsForAgent(undefined, "chat")(root(state))).toEqual([]);
    expect(selectRunnableSkillsForAgent("agent-1", "chat")(root(state, "org-2"))).toEqual([]);
  });

  it("tracks concurrent agents and surfaces independently", () => {
    const other = { ...request, agentId: "agent-2", surface: "session" as const };
    let state = reduce(reduce(initial(), pending()), pending("other", other));
    state = reduce(state, fulfilled());
    expect(selectRunnableSkillsStatus("agent-1", "chat")(root(state))).toBe("ready");
    expect(selectRunnableSkillsStatus("agent-2", "session")(root(state))).toBe("loading");
    state = reduce(state, fulfilled("other", other));
    expect(selectRunnableSkillsForAgent("agent-2", "session")(root(state))).toEqual(skills);
  });

  it("ignores stale success and failure while a newer request is pending", () => {
    const state = reduce(reduce(initial(), pending("old")), pending("latest"));
    expect(reduce(state, fulfilled("old"))).toEqual(state);
    expect(reduce(state, fetchRunnableSkills.rejected(null, "old", request, "Failed"))).toEqual(
      state,
    );
    expect(
      selectRunnableSkillsStatus("agent-1", "chat")(root(reduce(state, fulfilled("latest")))),
    ).toBe("ready");
  });

  it("clears cached choices when their refresh fails", () => {
    let state = reduce(reduce(initial(), pending()), fulfilled());
    state = reduce(state, pending("refresh"));
    state = reduce(state, fetchRunnableSkills.rejected(null, "refresh", request, "Failed"));
    expect(selectRunnableSkillsForAgent("agent-1", "chat")(root(state))).toEqual([]);
    expect(selectRunnableSkillsStatus("agent-1", "chat")(root(state))).toBe("failed");
  });

  it.each([
    logout(),
    rehydrateFailed(),
    setCredentials(credentials("org-2")),
    setCredentials(credentials()),
  ])("discards pending responses after $type", (action) => {
    const state = reduce(reduce(initial(), pending()), action);
    expect(reduce(state, fulfilled())).toEqual(state);
    expect(reduce(state, fetchRunnableSkills.rejected(null, "req", request, "Failed"))).toEqual(
      state,
    );
    expect(state.byAgent).toEqual({});
  });

  it("does not revive an old request when switching away and back", () => {
    let state = reduce(initial(), pending());
    state = reduce(state, setCredentials(credentials("org-2")));
    state = reduce(state, setCredentials(credentials("org-1")));
    expect(reduce(state, fulfilled())).toEqual(state);
  });

  it("initializes restored authentication and ignores requests for another org", () => {
    const state = reduce(undefined, rehydrateComplete(credentials("org-1")));
    expect(reduce(state, pending("wrong", { ...request, organizationId: "org-2" }))).toEqual(state);
    expect(reduce(reduce(state, pending()), fulfilled()).byAgent).not.toEqual({});
  });
});
