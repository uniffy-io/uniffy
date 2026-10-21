import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearLocalEncryptedStorage,
  decryptBytesFromStorage,
  encryptBytesForStorage,
  initStorageEncryption,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
  teardownStorageEncryption,
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

/** A signed-in device: browser storage, a deletable database and an unlocked key. */
async function unlockedDevice(): Promise<void> {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  registerEncryptedDatabase("uniffy-realtime-yjs", async () => {});
  vi.stubGlobal("indexedDB", { deleteDatabase: () => settledRequest("onsuccess") });
  await initStorageEncryption(new Uint8Array(32).fill(3), "alice");
}

function settledRequest(outcome: "onsuccess" | "onblocked" | "onerror") {
  const request: Record<string, unknown> = { error: new Error("delete failed") };
  queueMicrotask(() => (request[outcome] as (() => void) | undefined)?.());
  return request;
}

const encode = (text: string) => new TextEncoder().encode(text);

it("binds a ciphertext to its additional data", async () => {
  await unlockedDevice();
  const sealed = await encryptBytesForStorage(encode("row"), encode("uniffy-rt-v1|alice|org-1"));
  expect(
    new TextDecoder().decode(
      await decryptBytesFromStorage(sealed, encode("uniffy-rt-v1|alice|org-1")),
    ),
  ).toBe("row");
  await expect(
    decryptBytesFromStorage(sealed, encode("uniffy-rt-v1|alice|org-2")),
  ).rejects.toThrow();
  await expect(decryptBytesFromStorage(sealed)).rejects.toThrow();
  const unbound = await encryptBytesForStorage(encode("row"));
  await expect(
    decryptBytesFromStorage(unbound, encode("uniffy-rt-v1|alice|org-1")),
  ).rejects.toThrow();
  teardownStorageEncryption();
});

it.each(["onblocked", "onerror"] as const)(
  "keeps the key that wrote the surviving rows when a wipe is refused (%s)",
  async (refusal) => {
    await unlockedDevice();
    const sealed = await encryptBytesForStorage(encode("kept"));
    vi.stubGlobal("indexedDB", { deleteDatabase: () => settledRequest(refusal) });
    await expect(clearLocalEncryptedStorage()).rejects.toThrow();
    expect(isStorageEncryptionReady()).toBe(true);
    expect(new TextDecoder().decode(await decryptBytesFromStorage(sealed))).toBe("kept");
    teardownStorageEncryption();
  },
);
