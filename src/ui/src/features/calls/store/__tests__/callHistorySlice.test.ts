import { describe, expect, it } from "vitest";
import { callHistoryReducer, fetchCallHistory } from "@/features/calls/store/callHistorySlice";
import { removeChannel } from "@/features/chat/store/chatChannelsSlice";

describe("call history scope", () => {
  it.each([
    { organizationId: "org" },
    { organizationId: "org", channelId: "private" },
    { organizationId: "org", callId: "call" },
    { organizationId: "org", cursor: "next" },
  ])("ignores pending history after channel removal for %j", (scope) => {
    let state = callHistoryReducer(undefined, fetchCallHistory.pending("pending", scope));
    state = callHistoryReducer(state, removeChannel("private"));
    expect(state.revision).toBe(1);
    state = callHistoryReducer(
      state,
      fetchCallHistory.fulfilled(
        { records: [{ id: "call", channelId: "private" } as never], people: [], cursor: "next" },
        "pending",
        scope,
      ),
    );
    expect(state.records).toEqual([]);
    expect(state.people).toEqual([]);
    expect(state.loading).toBe(false);
    state = callHistoryReducer(state, fetchCallHistory.pending("fresh", scope));
    state = callHistoryReducer(
      state,
      fetchCallHistory.fulfilled({ records: [], people: [], cursor: "" }, "fresh", scope),
    );
    expect(state.error).toBe(false);
    expect(state.loading).toBe(false);
  });

  it("ignores a late response after switching organizations", () => {
    const first = { organizationId: "org-a" };
    const second = { organizationId: "org-b" };
    let state = callHistoryReducer(undefined, fetchCallHistory.pending("first", first));
    state = callHistoryReducer(state, fetchCallHistory.pending("second", second));
    state = callHistoryReducer(
      state,
      fetchCallHistory.fulfilled(
        { records: [{ id: "secret" } as never], people: [], cursor: "" },
        "first",
        first,
      ),
    );
    expect(state.records).toEqual([]);
    expect(state.loading).toBe(true);
  });
  it("clears visible records when revalidation is denied", () => {
    const scope = { organizationId: "org", callId: "call" };
    let state = callHistoryReducer(undefined, fetchCallHistory.pending("one", scope));
    state = callHistoryReducer(
      state,
      fetchCallHistory.fulfilled(
        { records: [{ id: "call" } as never], people: [], cursor: "next" },
        "one",
        scope,
      ),
    );
    state = callHistoryReducer(
      state,
      fetchCallHistory.pending("two", { ...scope, cursor: "next" }),
    );
    state = callHistoryReducer(state, fetchCallHistory.rejected(new Error("Denied"), "two", scope));
    expect(state.records).toEqual([]);
    expect(state.people).toEqual([]);
    expect(state.error).toBe(true);
  });
});
