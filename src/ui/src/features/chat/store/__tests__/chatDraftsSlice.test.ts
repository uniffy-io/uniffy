import { describe, it, expect } from "vitest";
import {
  chatDraftsReducer,
  setDrafts,
  draftUpserted,
  draftRemoved,
  clearChatDrafts,
  draftKey,
  selectChannelsWithDrafts,
  selectDraftCount,
  selectDraftRows,
  selectActiveDraftKey,
} from "@/features/chat/store/chatDraftsSlice";
import type { PlainDraft } from "@/features/chat/api/chatConverters";
import type { RootState } from "@/app/store";

function buildDraft(overrides: Partial<PlainDraft> = {}): PlainDraft {
  return {
    channelId: "ch-1",
    rootMessageId: null,
    content: "hello",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function toRootState(byKey: Record<string, { content: string; updatedAt: string }>): RootState {
  return { chatDrafts: { byKey } } as unknown as RootState;
}

const emptyState = chatDraftsReducer(undefined, { type: "test/init" });

describe("draftKey", () => {
  it("uses the channel id alone for channel drafts", () => {
    expect(draftKey("ch-1")).toBe("ch-1");
    expect(draftKey("ch-1", undefined)).toBe("ch-1");
  });

  it("appends the root message id for thread drafts", () => {
    expect(draftKey("ch-1", "root-9")).toBe("ch-1:root-9");
  });
});

describe("chatDraftsSlice reducers", () => {
  it("setDrafts replaces the map, keying thread drafts by channel and root", () => {
    const seeded = chatDraftsReducer(
      emptyState,
      draftUpserted(buildDraft({ channelId: "stale", content: "old" })),
    );
    const state = chatDraftsReducer(
      seeded,
      setDrafts([
        buildDraft({ channelId: "ch-1", content: "channel text" }),
        buildDraft({ channelId: "ch-2", rootMessageId: "root-9", content: "thread text" }),
      ]),
    );
    expect(state.byKey).toEqual({
      "ch-1": { content: "channel text", updatedAt: "2026-07-16T00:00:00.000Z" },
      "ch-2:root-9": { content: "thread text", updatedAt: "2026-07-16T00:00:00.000Z" },
    });
  });

  it("draftUpserted adds a new entry and overwrites an existing one", () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    expect(state.byKey["ch-1"]).toEqual({
      content: "hello",
      updatedAt: "2026-07-16T00:00:00.000Z",
    });

    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ content: "hello again", updatedAt: "2026-07-16T01:00:00.000Z" })),
    );
    expect(state.byKey["ch-1"]).toEqual({
      content: "hello again",
      updatedAt: "2026-07-16T01:00:00.000Z",
    });
  });

  it("keeps channel and thread drafts of the same channel independent", () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ rootMessageId: "root-9", content: "thread reply" })),
    );
    expect(state.byKey["ch-1"].content).toBe("hello");
    expect(state.byKey["ch-1:root-9"].content).toBe("thread reply");
  });

  it("draftRemoved deletes only the given key", () => {
    let state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    state = chatDraftsReducer(
      state,
      draftUpserted(buildDraft({ rootMessageId: "root-9", content: "thread reply" })),
    );
    state = chatDraftsReducer(state, draftRemoved(draftKey("ch-1", "root-9")));
    expect(state.byKey["ch-1:root-9"]).toBeUndefined();
    expect(state.byKey["ch-1"].content).toBe("hello");
  });

  it("draftRemoved on a missing key leaves the map unchanged", () => {
    const state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    const next = chatDraftsReducer(state, draftRemoved("unknown"));
    expect(next.byKey).toEqual(state.byKey);
  });

  it("clearChatDrafts resets to the initial state", () => {
    const state = chatDraftsReducer(emptyState, draftUpserted(buildDraft()));
    expect(chatDraftsReducer(state, clearChatDrafts())).toEqual(emptyState);
  });
});

describe("selectChannelsWithDrafts", () => {
  it("counts thread drafts toward their channel", () => {
    const channels = selectChannelsWithDrafts(
      toRootState({
        "ch-1": { content: "a", updatedAt: "2026-07-16T00:00:00.000Z" },
        "ch-2:root-9": { content: "b", updatedAt: "2026-07-16T00:00:00.000Z" },
      }),
    );
    expect(channels).toEqual(new Set(["ch-1", "ch-2"]));
  });

  it("dedupes a channel that has both a channel and a thread draft", () => {
    const channels = selectChannelsWithDrafts(
      toRootState({
        "ch-1": { content: "a", updatedAt: "2026-07-16T00:00:00.000Z" },
        "ch-1:root-9": { content: "b", updatedAt: "2026-07-16T00:00:00.000Z" },
      }),
    );
    expect(channels).toEqual(new Set(["ch-1"]));
  });

  it("returns an empty set when there are no drafts", () => {
    expect(selectChannelsWithDrafts(toRootState({}))).toEqual(new Set());
  });
});

describe("selectDraftRows", () => {
  it("splits keys back into channel and thread ids", () => {
    const rows = selectDraftRows(
      toRootState({
        "ch-1": { content: "channel text", updatedAt: "2026-07-16T00:00:00.000Z" },
        "ch-2:root-9": { content: "thread text", updatedAt: "2026-07-15T00:00:00.000Z" },
      }),
    );
    expect(rows).toEqual([
      {
        key: "ch-1",
        channelId: "ch-1",
        rootMessageId: null,
        content: "channel text",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
      {
        key: "ch-2:root-9",
        channelId: "ch-2",
        rootMessageId: "root-9",
        content: "thread text",
        updatedAt: "2026-07-15T00:00:00.000Z",
      },
    ]);
  });

  it("orders by updatedAt descending, newest first", () => {
    const rows = selectDraftRows(
      toRootState({
        older: { content: "a", updatedAt: "2026-07-14T00:00:00.000Z" },
        newest: { content: "b", updatedAt: "2026-07-16T00:00:00.000Z" },
        middle: { content: "c", updatedAt: "2026-07-15T00:00:00.000Z" },
      }),
    );
    expect(rows.map((row) => row.key)).toEqual(["newest", "middle", "older"]);
  });

  it("keeps a channel draft and its thread draft as separate rows", () => {
    const rows = selectDraftRows(
      toRootState({
        "ch-1": { content: "a", updatedAt: "2026-07-16T00:00:00.000Z" },
        "ch-1:root-9": { content: "b", updatedAt: "2026-07-16T01:00:00.000Z" },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].rootMessageId).toBe("root-9");
    expect(rows[1].rootMessageId).toBeNull();
  });

  it("returns nothing when there are no drafts", () => {
    expect(selectDraftRows(toRootState({}))).toEqual([]);
  });
});

describe("selectDraftCount", () => {
  it("counts channel and thread drafts separately", () => {
    expect(
      selectDraftCount(
        toRootState({
          "ch-1": { content: "a", updatedAt: "2026-07-16T00:00:00.000Z" },
          "ch-1:root-9": { content: "b", updatedAt: "2026-07-16T00:00:00.000Z" },
          "ch-2": { content: "c", updatedAt: "2026-07-16T00:00:00.000Z" },
        }),
      ),
    ).toBe(3);
    expect(selectDraftCount(toRootState({}))).toBe(0);
  });
});

describe("draft indicators while composing", () => {
  function viewingState(): RootState {
    return {
      chatDrafts: emptyState,
      chatChannels: {
        activeChannelId: "ch-1",
        splitChannelId: "ch-2",
        byId: { "ch-1": { id: "ch-1" }, "ch-2": { id: "ch-2" } },
      },
      chatUi: { splitActive: false, focusedPane: "left", threadPanelOpen: false },
      chatThreads: { activeThreadId: "root-9" },
      chatMessages: { byId: { "root-9": { channelId: "ch-1" } } },
    } as unknown as RootState;
  }

  function count(state: RootState, path: string) {
    return selectDraftCount(state, selectActiveDraftKey(state, path));
  }

  it("keeps delayed autosaves out of indicators until the conversation is left", () => {
    const state = viewingState();
    state.chatDrafts = chatDraftsReducer(state.chatDrafts, draftUpserted(buildDraft()));
    expect(count(state, "/chat/ch-1")).toBe(0);
    expect(selectChannelsWithDrafts(state, selectActiveDraftKey(state, "/chat/ch-1"))).toEqual(
      new Set(),
    );
    state.chatDrafts = chatDraftsReducer(
      state.chatDrafts,
      setDrafts([buildDraft({ content: "still typing" })]),
    );
    expect(count(state, "/chat/ch-1")).toBe(0);
    expect(selectDraftRows(state)[0].content).toBe("still typing");
    expect(count(state, "/chat/ch-2")).toBe(1);
    expect(count(state, "/chat/ch-1")).toBe(0);
  });

  it.each(["/notes", "/chat/drafts", "/chat/threads", "/chat/unreads"])(
    "counts the saved draft on %s despite the retained active channel",
    (path) => {
      const state = viewingState();
      state.chatDrafts = chatDraftsReducer(state.chatDrafts, draftUpserted(buildDraft()));
      expect(count(state, path)).toBe(1);
    },
  );

  it("excludes only the open thread, retaining other drafts in its channel", () => {
    const state = viewingState();
    state.chatUi.threadPanelOpen = true;
    state.chatDrafts = chatDraftsReducer(
      state.chatDrafts,
      setDrafts([
        buildDraft(),
        buildDraft({ rootMessageId: "root-9" }),
        buildDraft({ rootMessageId: "root-10" }),
      ]),
    );
    const active = selectActiveDraftKey(state, "/chat/ch-1");
    expect(active).toBe("ch-1:root-9");
    expect(selectDraftCount(state, active)).toBe(2);
    expect(selectChannelsWithDrafts(state, active)).toEqual(new Set(["ch-1"]));
    state.chatUi.threadPanelOpen = false;
    expect(selectActiveDraftKey(state, "/chat/ch-1")).toBe("ch-1");
  });

  it("follows the selected split pane and releases its draft when leaving chat", () => {
    const state = viewingState();
    state.chatUi.splitActive = true;
    state.chatUi.focusedPane = "right";
    state.chatDrafts = chatDraftsReducer(
      state.chatDrafts,
      draftUpserted(buildDraft({ channelId: "ch-2" })),
    );
    expect(count(state, "/chat/ch-1")).toBe(0);
    state.chatUi.focusedPane = "left";
    expect(count(state, "/chat/ch-1")).toBe(1);
    state.chatUi.focusedPane = "right";
    expect(count(state, "/notes")).toBe(1);
  });

  it("does not hide drafts when the channel has no writable composer", () => {
    const state = viewingState();
    state.chatDrafts = chatDraftsReducer(state.chatDrafts, draftUpserted(buildDraft()));
    state.chatChannels.byId["ch-1"].isArchived = true;
    expect(count(state, "/chat/ch-1")).toBe(1);
  });
});
