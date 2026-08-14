import { describe, expect, it } from "vitest";
import { appendAgentThinking, chatMessagesSlice } from "@/features/chat/store/chatMessagesSlice";

const reducer = chatMessagesSlice.reducer;

function initial() {
  return reducer(undefined, { type: "@@init" });
}

function delta(overrides: Partial<Parameters<typeof appendAgentThinking>[0]> = {}) {
  return appendAgentThinking({
    messageId: "m1",
    blockId: "t1",
    delta: "",
    sequence: 0,
    final: false,
    elapsedMs: 0,
    ...overrides,
  });
}

describe("appendAgentThinking", () => {
  it("accumulates deltas per message block", () => {
    let state = initial();
    state = reducer(state, delta({ delta: "thinking ", sequence: 1 }));
    state = reducer(state, delta({ delta: "hard", sequence: 2 }));
    expect(state.agentThinkingByMessage["m1"][0]).toMatchObject({
      content: "thinking hard",
      done: false,
    });
  });

  it("drops late deltas after a reorder", () => {
    let state = initial();
    state = reducer(state, delta({ delta: "a", sequence: 5 }));
    state = reducer(state, delta({ delta: "stale", sequence: 3 }));
    expect(state.agentThinkingByMessage["m1"][0].content).toBe("a");
  });

  it("final marker closes the block with the duration", () => {
    let state = initial();
    state = reducer(state, delta({ delta: "a", sequence: 1 }));
    state = reducer(state, delta({ sequence: 2, final: true, elapsedMs: 2500 }));
    expect(state.agentThinkingByMessage["m1"][0]).toMatchObject({
      done: true,
      elapsedMs: 2500,
      content: "a",
    });
  });

  it("keeps blocks separate per message", () => {
    let state = initial();
    state = reducer(state, delta({ delta: "x", sequence: 1 }));
    state = reducer(state, delta({ messageId: "m2", delta: "y", sequence: 1 }));
    expect(state.agentThinkingByMessage["m1"][0].content).toBe("x");
    expect(state.agentThinkingByMessage["m2"][0].content).toBe("y");
  });
});
