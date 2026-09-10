import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { RuleInfoSchema, RuleSource } from "@uniffy/proto/agents/v1/rules_pb";
import { agentRulesReducer } from "@/features/agents/store/agentRulesSlice";
import {
  fetchRules,
  fetchEnabledRules,
  setEnabledRules,
  ruleToPlain,
} from "@/features/agents/store/agentRulesThunks";
import { logout } from "@/features/auth/store/authSlice";
import { rulesApi } from "@/features/agents/api/rulesApi";
import type { RootState } from "@/app/store";

vi.mock("@/features/agents/api/rulesApi", () => ({ rulesApi: { setEnabledRules: vi.fn() } }));
const rule = ruleToPlain(
  create(RuleInfoSchema, {
    id: "rule",
    name: "clear",
    source: RuleSource.BUNDLED,
    content: "Body",
    activeVersionId: "version-1",
    latestVersionNumber: 3,
    activeVersionPinned: true,
  }),
);

describe("rules state", () => {
  it("keeps the active snapshot separate from the latest number", () => {
    expect(rule.activeVersionId).toBe("version-1");
    expect(rule.latestVersionNumber).toBe(3);
    expect(rule.activeVersionPinned).toBe(true);
  });
  it("does not enable fetched rules", () => {
    const state = agentRulesReducer(
      agentRulesReducer(undefined, fetchRules.pending("req", undefined)),
      fetchRules.fulfilled(
        { rules: [rule], nextPageToken: "cursor", append: false },
        "req",
        undefined,
      ),
    );
    expect(state.rules.rule).toEqual(rule);
    expect(state.selections).toEqual({});
    expect(state.nextPageToken).toBe("cursor");
  });
  it("keeps different agents’ selections independent and clears on logout", () => {
    let state = agentRulesReducer(
      agentRulesReducer(undefined, fetchEnabledRules.pending("req", "first-agent")),
      fetchEnabledRules.fulfilled(
        { target: "first-agent", ruleIds: ["rule"] },
        "req",
        "first-agent",
      ),
    );
    state = agentRulesReducer(
      agentRulesReducer(state, fetchEnabledRules.pending("req", "agent")),
      fetchEnabledRules.fulfilled({ target: "agent", ruleIds: [] }, "req", "agent"),
    );
    expect(state.selections).toEqual({ "first-agent": ["rule"], agent: [] });
    expect(agentRulesReducer(state, logout()).selections).toEqual({});
  });
  it("retains selections after a failed mutation", () => {
    const params = { agentId: "agent", ruleIds: [] };
    let state = agentRulesReducer(
      agentRulesReducer(undefined, fetchEnabledRules.pending("req", "agent")),
      fetchEnabledRules.fulfilled({ target: "agent", ruleIds: ["rule"] }, "req", "agent"),
    );
    state = agentRulesReducer(state, setEnabledRules.pending("write", params));
    state = agentRulesReducer(
      state,
      setEnabledRules.rejected(new Error("denied"), "write", params),
    );
    expect(state.selections.agent).toEqual(["rule"]);
    expect(state.selecting.agent).toBe(false);
  });
  it("sends tenant and target with explicit selections", async () => {
    vi.mocked(rulesApi.setEnabledRules).mockResolvedValue({ ruleIds: ["rule"] } as never);
    await setEnabledRules({ agentId: "agent", ruleIds: ["rule"] })(
      vi.fn(),
      () => ({ auth: { currentOrganizationId: "org" } }) as RootState,
      undefined,
    );
    expect(rulesApi.setEnabledRules).toHaveBeenCalledWith({
      organizationId: "org",
      agentId: "agent",
      ruleIds: ["rule"],
    });
  });
  it("ignores a response arriving after logout", () => {
    let state = agentRulesReducer(undefined, fetchRules.pending("stale", undefined));
    state = agentRulesReducer(state, logout());
    state = agentRulesReducer(
      state,
      fetchRules.fulfilled({ rules: [rule], nextPageToken: "", append: false }, "stale", undefined),
    );
    expect(state.rules).toEqual({});
  });
});
