import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  canReleaseSession,
  composeWhenSynced,
  resolveCloseDisposal,
} from "@/features/realtime/hooks/useDocSession";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import {
  attachDoc,
  connect,
  detachAll,
  installRealtimeGlobals,
  lastUpdateId,
  progress,
  receipt,
} from "@/features/realtime/hooks/__tests__/realtimeHarness";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("composeWhenSynced", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays pending after server sync until hydrate completes", async () => {
    let resolveServer!: () => void;
    let resolveHydrate!: () => void;
    const server = new Promise<void>((resolve) => (resolveServer = resolve));
    const hydrate = new Promise<void>((resolve) => (resolveHydrate = resolve));

    let settled = false;
    void composeWhenSynced(server, hydrate).then(() => (settled = true));

    resolveServer();
    await flush();
    expect(settled).toBe(false);

    resolveHydrate();
    await flush();
    expect(settled).toBe(true);
  });

  it("stays pending after hydrate until the server syncs", async () => {
    let resolveServer!: () => void;
    const server = new Promise<void>((resolve) => (resolveServer = resolve));

    let settled = false;
    void composeWhenSynced(server, Promise.resolve()).then(() => (settled = true));

    await flush();
    expect(settled).toBe(false);

    resolveServer();
    await flush();
    expect(settled).toBe(true);
  });

  it("resolves when hydrate rejects", async () => {
    const hydrate = Promise.reject(new Error("idb unavailable"));

    let settled = false;
    void composeWhenSynced(Promise.resolve(), hydrate).then(() => (settled = true));

    await flush();
    expect(settled).toBe(true);
  });
});

describe("resolveCloseDisposal", () => {
  const clean = {
    discardLocalOnCleanClose: true,
    serverSynced: true,
    hydrationComplete: true,
    transportStatus: "connected" as const,
    checkpointPending: false,
    readOnly: false,
    generationChanged: false,
    denied: false,
  };

  it("discards only an acknowledged close of an opt-in session", () => {
    expect(resolveCloseDisposal(clean)).toEqual({
      acknowledged: true,
      discard: true,
      drain: false,
    });
    expect(resolveCloseDisposal({ ...clean, discardLocalOnCleanClose: false })).toMatchObject({
      acknowledged: true,
      discard: false,
    });
  });

  it("never treats a generation change as a clean close", () => {
    expect(resolveCloseDisposal({ ...clean, generationChanged: true })).toEqual({
      acknowledged: false,
      discard: false,
      drain: false,
    });
  });

  it("keeps rows after a revoked or forbidden close", () => {
    expect(resolveCloseDisposal({ ...clean, transportStatus: "token_revoked" }).discard).toBe(
      false,
    );
    expect(resolveCloseDisposal({ ...clean, transportStatus: "permission_lost" }).discard).toBe(
      false,
    );
    expect(resolveCloseDisposal({ ...clean, transportStatus: "disconnected" }).discard).toBe(false);
  });

  it("records pending editable docs for the drain, not denied or replaced ones", () => {
    expect(resolveCloseDisposal({ ...clean, checkpointPending: true })).toEqual({
      acknowledged: false,
      discard: false,
      drain: true,
    });
    expect(resolveCloseDisposal({ ...clean, checkpointPending: true, readOnly: true }).drain).toBe(
      false,
    );
    expect(resolveCloseDisposal({ ...clean, checkpointPending: true, denied: true }).drain).toBe(
      false,
    );
    expect(
      resolveCloseDisposal({ ...clean, checkpointPending: true, generationChanged: true }).drain,
    ).toBe(false);
  });
});

describe("Done", () => {
  const stored = { storage: "available", unpersisted: false } as const;
  const idle = { transportPending: false, checkpointPending: false };
  const closing = {
    discardLocalOnCleanClose: true,
    serverSynced: true,
    hydrationComplete: true,
    transportStatus: "connected" as const,
    readOnly: false,
    generationChanged: false,
    denied: false,
  };

  beforeAll(installRealtimeGlobals);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    detachAll();
    vi.useRealTimers();
  });

  it("holds the session until the server accepts every edit", () => {
    const doc = attachDoc("unaccepted");
    const ws = connect(doc);
    doc.ydoc.getText("markdown").insert(0, "typed");
    const release = () =>
      canReleaseSession("connected", realtimeMultiplexer.getDocState(doc.docName), stored);
    expect(release()).toBe(false);
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    expect(release()).toBe(true);
  });

  it("holds accepted edits the device has not stored until a checkpoint covers them", () => {
    const doc = attachDoc("accepted-unstored");
    const ws = connect(doc);
    doc.ydoc.getText("markdown").insert(0, "typed");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    const release = (device: { storage: "unavailable" | "failed"; unpersisted: boolean }) =>
      canReleaseSession("connected", realtimeMultiplexer.getDocState(doc.docName), device);
    expect(release({ storage: "failed", unpersisted: true })).toBe(false);
    expect(release({ storage: "unavailable", unpersisted: true })).toBe(false);
    ws.receive(doc.docName, progress(1));
    expect(release({ storage: "failed", unpersisted: true })).toBe(true);
  });

  it("with accepted-only edits closes without waiting and leaves the rows to the drain", () => {
    const doc = attachDoc("accepted-only");
    const ws = connect(doc);
    doc.ydoc.getText("markdown").insert(0, "typed");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    const { checkpointPending } = realtimeMultiplexer.getDocState(doc.docName);
    expect(resolveCloseDisposal({ ...closing, checkpointPending })).toEqual({
      acknowledged: false,
      discard: false,
      drain: true,
    });
  });

  it("after checkpoint progress closes clean and drops the cache", () => {
    const doc = attachDoc("checkpointed");
    const ws = connect(doc);
    doc.ydoc.getText("markdown").insert(0, "typed");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    ws.receive(doc.docName, progress(1));
    const { checkpointPending } = realtimeMultiplexer.getDocState(doc.docName);
    expect(resolveCloseDisposal({ ...closing, checkpointPending })).toEqual({
      acknowledged: true,
      discard: true,
      drain: false,
    });
  });

  it("keeps the session while offline and releases a denied one at once", () => {
    const unsent = { transportPending: true, checkpointPending: true };
    const failed = { storage: "failed", unpersisted: true } as const;
    expect(canReleaseSession("offline", idle, stored)).toBe(false);
    expect(canReleaseSession("disconnected", idle, stored)).toBe(false);
    expect(canReleaseSession("access_lost", unsent, failed)).toBe(true);
    expect(canReleaseSession("permission_lost", unsent, failed)).toBe(true);
    expect(canReleaseSession("update_rejected", unsent, failed)).toBe(true);
  });
});
