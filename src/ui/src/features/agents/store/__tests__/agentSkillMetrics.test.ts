import { describe, expect, it } from "vitest";
import type { SkillMetric } from "@uniffy/proto/agents/v1/skills_pb";
import {
  agentSkillMetricsReducer,
  selectSkillMetricsState,
} from "@/features/agents/store/agentSkillMetricsSlice";
import {
  fetchSkillMetrics,
  skillMetricToPlain,
} from "@/features/agents/store/agentSkillMetricsThunks";

describe("skillMetricToPlain", () => {
  it("maps proto metric fields", () => {
    const proto = {
      skillId: "s1",
      displayName: "Reporter",
      origin: "agent_evolved",
      injectedCount: 12,
      viewedCount: 5,
      invokedCount: 2,
    } as unknown as SkillMetric;
    const plain = skillMetricToPlain(proto);
    expect(plain.skillId).toBe("s1");
    expect(plain.origin).toBe("agent_evolved");
    expect(plain.injectedCount).toBe(12);
    expect(plain.viewedCount).toBe(5);
    expect(plain.invokedCount).toBe(2);
  });
});

describe("agentSkillMetrics slice", () => {
  it("fetch fulfilled populates metrics and tallies", () => {
    const state = agentSkillMetricsReducer(
      undefined,
      fetchSkillMetrics.fulfilled(
        {
          metrics: [
            {
              skillId: "s1",
              displayName: "Reporter",
              origin: "user",
              injectedCount: 4,
              viewedCount: 1,
              invokedCount: 0,
            },
          ],
          positiveFeedback: 7,
          negativeFeedback: 3,
          pendingAgentDrafts: 2,
        },
        "req",
        undefined,
      ),
    );
    const root = { agentSkillMetrics: state } as never;
    const sel = selectSkillMetricsState(root);
    expect(sel.loaded).toBe(true);
    expect(sel.metrics).toHaveLength(1);
    expect(sel.positiveFeedback).toBe(7);
    expect(sel.negativeFeedback).toBe(3);
    expect(sel.pendingAgentDrafts).toBe(2);
  });

  it("rejected clears loading without marking loaded", () => {
    let state = agentSkillMetricsReducer(undefined, fetchSkillMetrics.pending("req", undefined));
    expect(state.loading).toBe(true);
    state = agentSkillMetricsReducer(
      state,
      fetchSkillMetrics.rejected(new Error("x"), "req", undefined, "failed"),
    );
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(false);
  });
});
