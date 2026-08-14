import { describe, expect, it } from "vitest";
import {
  agentMessagesSlice,
  appendStreamingThinking,
  endStreamingThinking,
  recordModelCallEnd,
  streamCompleted,
  streamError,
} from "@/features/agents/store/agentMessagesSlice";
import type { SerializedMessage } from "@/features/agents/store/agentMessagesSerde";

const reducer = agentMessagesSlice.reducer;

function initial() {
  return reducer(undefined, { type: "@@init" });
}

const ASSISTANT: SerializedMessage = {
  id: "msg-1",
  sessionId: "s1",
  role: 2,
  content: "answer",
} as unknown as SerializedMessage;

describe("streaming thinking state", () => {
  it("opens a block implicitly on the first delta", () => {
    let state = initial();
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "a" }));
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "b" }));
    expect(state.streamingThinking).toEqual([
      { blockId: "t1", content: "ab", elapsedMs: 0, done: false },
    ]);
  });

  it("keeps separate blocks separate", () => {
    let state = initial();
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "one" }));
    state = reducer(state, appendStreamingThinking({ blockId: "t2", delta: "two" }));
    expect(state.streamingThinking.map((b) => b.content)).toEqual(["one", "two"]);
  });

  it("marks the block done with the runtime duration", () => {
    let state = initial();
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "x" }));
    state = reducer(state, endStreamingThinking({ blockId: "t1", elapsedMs: 4100 }));
    expect(state.streamingThinking[0]).toMatchObject({ done: true, elapsedMs: 4100 });
  });

  it("re-anchors thinking to the stored assistant message on completion", () => {
    let state = initial();
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "why" }));
    state = reducer(state, endStreamingThinking({ blockId: "t1", elapsedMs: 900 }));
    state = reducer(state, streamCompleted({ sessionId: "s1", assistantMessage: ASSISTANT }));
    expect(state.streamingThinking).toEqual([]);
    expect(state.thinkingByMessage["msg-1"]).toEqual([
      { blockId: "t1", content: "why", elapsedMs: 900, done: true },
    ]);
  });

  it("drops streaming thinking on error", () => {
    let state = initial();
    state = reducer(state, appendStreamingThinking({ blockId: "t1", delta: "x" }));
    state = reducer(state, streamError("boom"));
    expect(state.streamingThinking).toEqual([]);
    expect(state.thinkingByMessage).toEqual({});
  });

  it("accumulates model call usage across tool-loop segments", () => {
    let state = initial();
    state = reducer(
      state,
      recordModelCallEnd({
        model: "m1",
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 4,
        cacheReadInputTokens: 2,
      }),
    );
    state = reducer(
      state,
      recordModelCallEnd({
        model: "m1",
        inputTokens: 7,
        outputTokens: 3,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
      }),
    );
    expect(state.streamingUsage).toEqual({
      model: "m1",
      inputTokens: 17,
      outputTokens: 8,
      cacheCreationInputTokens: 6,
      cacheReadInputTokens: 3,
    });
  });
});
