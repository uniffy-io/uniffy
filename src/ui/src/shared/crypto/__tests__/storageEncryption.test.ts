import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearLocalEncryptedStorage,
  registerEncryptedDatabase,
} from "@/shared/crypto/storageEncryption";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("localStorage", { removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it("waits for the registered database close before deletion", async () => {
  let release!: () => void;
  let closed = false;
  registerEncryptedDatabase("uniffy-realtime-yjs", async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    closed = true;
  });
  const deletion = vi.fn(() => {
    expect(closed).toBe(true);
    const request = { onsuccess: null as null | (() => void) };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });
  vi.stubGlobal("indexedDB", { deleteDatabase: deletion });
  const clearing = clearLocalEncryptedStorage();
  expect(deletion).not.toHaveBeenCalled();
  release();
  await clearing;
  expect(deletion).toHaveBeenCalledOnce();
});

it("reports blocked deletion as a failure", async () => {
  registerEncryptedDatabase("uniffy-realtime-yjs", async () => {});
  vi.stubGlobal("indexedDB", {
    deleteDatabase: () => {
      const request = { onblocked: null as null | (() => void) };
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  });
  await expect(clearLocalEncryptedStorage()).rejects.toThrow("Close other tabs");
});
