import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initStorageEncryption,
  teardownStorageEncryption,
} from "@/shared/crypto/storageEncryption";
import {
  preparePendingSend,
  pendingSends,
  forgetPendingSend,
  clearPendingSends,
} from "@/features/chat/utils/pendingSends";

beforeAll(async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  await initStorageEncryption(new Uint8Array(32).fill(7), "user");
});
afterAll(() => {
  teardownStorageEncryption();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await clearPendingSends("user");
  await clearPendingSends("other");
});
const request = { channelId: "channel", content: "Private pending text", clientMessageId: "first" };

describe("encrypted pending sends", () => {
  it("reuses identity after reload and concurrent attempts", async () => {
    const first = await preparePendingSend("user", "org", request);
    const retry = await preparePendingSend("user", "org", {
      ...request,
      clientMessageId: "replacement",
    });
    expect(retry).toEqual(first);
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        preparePendingSend("user", "org", {
          ...request,
          content: "concurrent",
          clientMessageId: String(n),
        }),
      ),
    );
    expect(new Set(concurrent.map((row) => row.request.clientMessageId)).size).toBe(1);
    expect(await pendingSends("user", "org")).toHaveLength(2);
    const reopened = await openDB("uniffy-chat-sends");
    const rows = await reopened.getAll("sends");
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(request.content);
    expect(new TextDecoder().decode(rows[0].ciphertext)).not.toContain(request.content);
    reopened.close();
  });
  it("separates tenants, users, threads, files and broadcast intent", async () => {
    for (const changed of [
      {},
      { rootId: "root" },
      { attachmentFileIds: ["file"] },
      { alsoSendToChannel: true },
    ])
      await preparePendingSend("user", "org", { ...request, ...changed });
    await preparePendingSend("user", "other-org", request);
    await preparePendingSend("other", "org", request);
    expect(await pendingSends("user", "org")).toHaveLength(4);
    await clearPendingSends("user", "org");
    expect(await pendingSends("user", "org")).toEqual([]);
    expect(await pendingSends("user", "other-org")).toHaveLength(1);
    expect(await pendingSends("other", "org")).toHaveLength(1);
  });
  it("does not let a late acknowledgement delete a newer identical send", async () => {
    const first = await preparePendingSend("user", "org", request);
    await forgetPendingSend(first);
    const next = await preparePendingSend("user", "org", { ...request, clientMessageId: "next" });
    await forgetPendingSend(first);
    expect(await pendingSends("user", "org")).toEqual([next]);
  });
  it("blocks a pending write that crosses logout", async () => {
    const writing = preparePendingSend("user", "org", request);
    const rejected = expect(writing).rejects.toThrow("Session changed");
    await clearPendingSends("user");
    await rejected;
    expect(await pendingSends("user", "org")).toEqual([]);
  });
  it("normalizes metadata ordering without merging different payloads", async () => {
    const first = await preparePendingSend("user", "org", {
      ...request,
      metadata: { a: "1", b: "2" },
    });
    const retry = await preparePendingSend("user", "org", {
      ...request,
      metadata: { b: "2", a: "1" },
    });
    expect(retry.key).toBe(first.key);
  });
});

it("bounds queued payloads without evicting an unsent message", async () => {
  await Promise.all(
    Array.from({ length: 200 }, (_, n) =>
      preparePendingSend("user", "org", { ...request, content: String(n) }),
    ),
  );
  await expect(preparePendingSend("user", "org", request)).rejects.toThrow(
    "Pending message limit reached",
  );
  expect(
    (await preparePendingSend("user", "org", { ...request, content: "0" })).request.clientMessageId,
  ).toBe("first");
  expect(await pendingSends("user", "org")).toHaveLength(200);
});
it("keeps insecure-origin retries in memory without persisting plaintext", async () => {
  const secureCrypto = crypto;
  vi.stubGlobal("crypto", {
    randomUUID: () => "random",
    getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto),
  });
  try {
    const first = await preparePendingSend("user", "org", request);
    expect(
      await preparePendingSend("user", "org", { ...request, clientMessageId: "changed" }),
    ).toEqual(first);
    expect(await pendingSends("user", "org")).toEqual([first]);
    const db = await openDB("uniffy-chat-sends");
    expect(await db.getAll("sends")).toEqual([]);
    db.close();
    await forgetPendingSend(first);
    expect(await pendingSends("user", "org")).toEqual([]);
  } finally {
    vi.stubGlobal("crypto", secureCrypto);
  }
});
