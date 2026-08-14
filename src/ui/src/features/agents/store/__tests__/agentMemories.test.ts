import { describe, expect, it } from "vitest";
import type { MemoryInfo } from "@uniffy/proto/agents/v1/memories_pb";
import { MemoryCategory, MemoryScope, MemorySource } from "@uniffy/proto/agents/v1/memories_pb";
import {
  agentMemoriesReducer,
  selectMemoryScope,
} from "@/features/agents/store/agentMemoriesSlice";
import {
  memoryScopeKey,
  memoryToPlain,
  fetchMemories,
  createMemory,
  deleteMemory,
  setMemoryPinned,
  type SerializedMemory,
} from "@/features/agents/store/agentMemoriesThunks";
import type { RootState } from "@/app/store";

const memoryProto = (over: Partial<MemoryInfo> = {}): MemoryInfo =>
  ({
    id: "m1",
    agentId: undefined,
    key: "release_freeze",
    content: "Release freeze is every Friday.",
    category: MemoryCategory.FACTS,
    importance: 0.7,
    accessCount: 3,
    scope: MemoryScope.CHANNEL,
    description: "Weekly release freeze day",
    pinned: false,
    source: MemorySource.TOOL,
    createdByUserId: "user-1",
    createdByName: "Ada",
    createdByAgentId: "agent-1",
    createdByAgentName: "Atlas",
    channelId: "chan-1",
    sessionId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    ...over,
  }) as unknown as MemoryInfo;

const memory = (over: Partial<SerializedMemory> = {}): SerializedMemory => ({
  ...memoryToPlain(memoryProto()),
  ...over,
});

const USER_KEY = memoryScopeKey({ scope: MemoryScope.USER });
const CHANNEL_KEY = memoryScopeKey({ scope: MemoryScope.CHANNEL, subjectId: "chan-1" });

const ORG_AGENT_KEY = memoryScopeKey({ scope: MemoryScope.ORG, agentId: "agent-1" });

const fetchArg = { scope: MemoryScope.CHANNEL, subjectId: "chan-1" };

const seeded = () => {
  const withUser = agentMemoriesReducer(
    undefined,
    fetchMemories.fulfilled(
      {
        scopeKey: USER_KEY,
        memories: [memory({ id: "u1", scope: MemoryScope.USER })],
        totalCount: 1,
      },
      "req-1",
      { scope: MemoryScope.USER },
    ),
  );
  return agentMemoriesReducer(
    withUser,
    fetchMemories.fulfilled(
      {
        scopeKey: CHANNEL_KEY,
        memories: [memory({ id: "c1" }), memory({ id: "c2", pinned: true })],
        totalCount: 2,
      },
      "req-2",
      fetchArg,
    ),
  );
};

describe("memoryScopeKey", () => {
  it("keys subjectless scopes with the org sentinel and a shared binding", () => {
    expect(memoryScopeKey({ scope: MemoryScope.USER })).toBe(`${MemoryScope.USER}:org:all`);
    expect(memoryScopeKey({ scope: MemoryScope.ORG })).toBe(`${MemoryScope.ORG}:org:all`);
  });

  it("keys channel and session scopes by subject id", () => {
    expect(memoryScopeKey({ scope: MemoryScope.CHANNEL, subjectId: "chan-1" })).toBe(
      `${MemoryScope.CHANNEL}:chan-1:all`,
    );
    expect(memoryScopeKey({ scope: MemoryScope.SESSION, subjectId: "sess-1" })).toBe(
      `${MemoryScope.SESSION}:sess-1:all`,
    );
  });

  it("separates an agent-bound org bucket from the shared one", () => {
    expect(ORG_AGENT_KEY).toBe(`${MemoryScope.ORG}:org:agent-1`);
    expect(ORG_AGENT_KEY).not.toBe(memoryScopeKey({ scope: MemoryScope.ORG }));
  });
});

describe("memoryToPlain", () => {
  it("carries scope, provenance, and pin fields", () => {
    const plain = memoryToPlain(memoryProto({ pinned: true }));
    expect(plain.scope).toBe(MemoryScope.CHANNEL);
    expect(plain.description).toBe("Weekly release freeze day");
    expect(plain.pinned).toBe(true);
    expect(plain.source).toBe(MemorySource.TOOL);
    expect(plain.createdByUserId).toBe("user-1");
    expect(plain.createdByName).toBe("Ada");
    expect(plain.agentId).toBeUndefined();
    expect(plain.createdByAgentName).toBe("Atlas");
    expect(plain.channelId).toBe("chan-1");
    expect(plain.sessionId).toBeUndefined();
  });
});

describe("agentMemoriesSlice scope re-keying", () => {
  it("keeps buckets for different scopes side by side", () => {
    const state = seeded();
    expect(Object.keys(state.byScope[USER_KEY].memories)).toEqual(["u1"]);
    expect(Object.keys(state.byScope[CHANNEL_KEY].memories)).toEqual(["c1", "c2"]);
    expect(state.byScope[CHANNEL_KEY].totalCount).toBe(2);
    expect(state.byScope[CHANNEL_KEY].loaded).toBe(true);
  });

  it("marks only the fetched bucket as loading", () => {
    const state = agentMemoriesReducer(seeded(), fetchMemories.pending("req-3", fetchArg));
    expect(state.byScope[CHANNEL_KEY].loading).toBe(true);
    expect(state.byScope[USER_KEY].loading).toBe(false);
  });

  it("adds a created memory to its bucket and bumps the total", () => {
    const state = agentMemoriesReducer(
      seeded(),
      createMemory.fulfilled({ scopeKey: CHANNEL_KEY, memory: memory({ id: "c3" }) }, "req-4", {
        scope: MemoryScope.CHANNEL,
        subjectId: "chan-1",
        key: "k",
        description: "d",
        content: "c",
      }),
    );
    expect(state.byScope[CHANNEL_KEY].memories["c3"]).toBeDefined();
    expect(state.byScope[CHANNEL_KEY].totalCount).toBe(3);
    expect(state.byScope[USER_KEY].totalCount).toBe(1);
  });

  it("deletes only from the addressed bucket", () => {
    const state = agentMemoriesReducer(
      seeded(),
      deleteMemory.fulfilled({ scopeKey: CHANNEL_KEY, memoryId: "c1" }, "req-5", {
        scopeKey: CHANNEL_KEY,
        memoryId: "c1",
      }),
    );
    expect(state.byScope[CHANNEL_KEY].memories["c1"]).toBeUndefined();
    expect(state.byScope[CHANNEL_KEY].totalCount).toBe(1);
    expect(state.byScope[USER_KEY].memories["u1"]).toBeDefined();
  });

  it("replaces the entry when a pin toggle resolves", () => {
    const state = agentMemoriesReducer(
      seeded(),
      setMemoryPinned.fulfilled(
        { scopeKey: CHANNEL_KEY, memory: memory({ id: "c1", pinned: true }) },
        "req-6",
        { scopeKey: CHANNEL_KEY, memoryId: "c1", pinned: true },
      ),
    );
    expect(state.byScope[CHANNEL_KEY].memories["c1"].pinned).toBe(true);
    expect(state.byScope[USER_KEY].memories["u1"].pinned).toBe(false);
  });
});

describe("selectMemoryScope", () => {
  it("returns a stable empty bucket for unknown keys", () => {
    const root = { agentMemories: seeded() } as unknown as RootState;
    const first = selectMemoryScope("9:nope")(root);
    const second = selectMemoryScope("9:nope")(root);
    expect(first).toBe(second);
    expect(first.memories).toEqual({});
    expect(first.loaded).toBe(false);
  });
});
