import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { composeWhenSynced, resolveCloseDisposal } from "@/features/realtime/hooks/useDocSession";

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

  it("resolves and warns when hydrate rejects", async () => {
    const hydrate = Promise.reject(new Error("idb unavailable"));

    let settled = false;
    void composeWhenSynced(Promise.resolve(), hydrate).then(() => (settled = true));

    await flush();
    expect(settled).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      "[realtime] persistence hydrate failed",
      expect.any(Error),
    );
  });
});

describe("resolveCloseDisposal", () => {
  const clean = {
    discardLocalOnCleanClose: true,
    serverSynced: true,
    hydrationComplete: true,
    transportStatus: "connected" as const,
    outboundPending: false,
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
    expect(resolveCloseDisposal({ ...clean, outboundPending: true })).toEqual({
      acknowledged: false,
      discard: false,
      drain: true,
    });
    expect(resolveCloseDisposal({ ...clean, outboundPending: true, readOnly: true }).drain).toBe(
      false,
    );
    expect(resolveCloseDisposal({ ...clean, outboundPending: true, denied: true }).drain).toBe(
      false,
    );
    expect(
      resolveCloseDisposal({ ...clean, outboundPending: true, generationChanged: true }).drain,
    ).toBe(false);
  });
});
