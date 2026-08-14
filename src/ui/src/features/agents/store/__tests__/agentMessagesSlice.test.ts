import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTIVE_RUN_ID_STORAGE_KEY = "uniffy.agentRuntime.activeRunId";

interface MockStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
}

function createMockStorage(): MockStorage {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

function installMockWindow(storage: MockStorage): void {
  // The slice guards on `typeof window` and `typeof window.sessionStorage`,
  // so a minimal stub is enough for the persistence helpers to engage.
  (globalThis as unknown as { window: { sessionStorage: MockStorage } }).window = {
    sessionStorage: storage,
  };
}

function uninstallMockWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

async function freshSlice() {
  vi.resetModules();
  return await import("@/features/agents/store/agentMessagesSlice");
}

describe("agentMessagesSlice activeRunId persistence", () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = createMockStorage();
    installMockWindow(storage);
  });

  afterEach(() => {
    uninstallMockWindow();
    vi.resetModules();
  });

  it("initial state activeRunId reads from sessionStorage when set", async () => {
    storage.setItem(ACTIVE_RUN_ID_STORAGE_KEY, "run-123");
    const slice = await freshSlice();
    const state = slice.agentMessagesReducer(undefined, { type: "@@INIT" });
    expect(state.activeRunId).toBe("run-123");
  });

  it("initial state activeRunId is null when sessionStorage is empty", async () => {
    const slice = await freshSlice();
    const state = slice.agentMessagesReducer(undefined, { type: "@@INIT" });
    expect(state.activeRunId).toBeNull();
  });

  it("runIdReceived persists run id to sessionStorage", async () => {
    const slice = await freshSlice();
    const state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-abc"));
    expect(state.activeRunId).toBe("run-abc");
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBe("run-abc");
  });

  it("streamCompleted clears activeRunId in state and sessionStorage", async () => {
    storage.setItem(ACTIVE_RUN_ID_STORAGE_KEY, "run-xyz");
    const slice = await freshSlice();
    let state = slice.agentMessagesReducer(undefined, { type: "@@INIT" });
    expect(state.activeRunId).toBe("run-xyz");
    state = slice.agentMessagesReducer(state, slice.streamCompleted({ sessionId: "session-1" }));
    expect(state.activeRunId).toBeNull();
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it("streamError clears activeRunId in state and sessionStorage", async () => {
    const slice = await freshSlice();
    let state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-1"));
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBe("run-1");
    state = slice.agentMessagesReducer(state, slice.streamError("boom"));
    expect(state.activeRunId).toBeNull();
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it("streamStarted clears stale activeRunId before a fresh stream", async () => {
    const slice = await freshSlice();
    let state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-old"));
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBe("run-old");
    state = slice.agentMessagesReducer(state, slice.streamStarted());
    expect(state.activeRunId).toBeNull();
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it("clearActiveRunId drops the persisted id without touching messages", async () => {
    const slice = await freshSlice();
    let state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-clear"));
    state = slice.agentMessagesReducer(state, slice.clearActiveRunId());
    expect(state.activeRunId).toBeNull();
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBeNull();
  });

  it("clearAgentMessages wipes persisted run id (logout path)", async () => {
    const slice = await freshSlice();
    let state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-logout"));
    state = slice.agentMessagesReducer(state, slice.clearAgentMessages());
    expect(state.activeRunId).toBeNull();
    expect(storage.getItem(ACTIVE_RUN_ID_STORAGE_KEY)).toBeNull();
  });
});

describe("agentMessagesSlice persistence guards", () => {
  afterEach(() => {
    uninstallMockWindow();
    vi.resetModules();
  });

  it("does not crash when window is undefined (SSR / non-browser)", async () => {
    uninstallMockWindow();
    const slice = await freshSlice();
    // initial state read should not throw
    const state = slice.agentMessagesReducer(undefined, { type: "@@INIT" });
    expect(state.activeRunId).toBeNull();
    // mutating reducers must not throw either
    const next = slice.agentMessagesReducer(state, slice.runIdReceived("run-ssr"));
    expect(next.activeRunId).toBe("run-ssr");
  });

  it("swallows sessionStorage errors (quota / privacy mode)", async () => {
    const throwing: MockStorage = {
      ...createMockStorage(),
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    installMockWindow(throwing);
    const slice = await freshSlice();
    // setItem throws inside writePersistedRunId - in-memory state still advances.
    const state = slice.agentMessagesReducer(undefined, slice.runIdReceived("run-q"));
    expect(state.activeRunId).toBe("run-q");
  });
});
