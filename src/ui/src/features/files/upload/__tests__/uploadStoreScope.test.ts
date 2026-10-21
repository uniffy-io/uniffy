import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import type { UploadRecord, UploadScope } from "@/features/files/upload/uploadTypes";
import { installWebLocks } from "@/features/realtime/__tests__/webLocks";

const mocks = vi.hoisted(() => ({
  uploadChunks: vi.fn(),
  abort: vi.fn(),
  initiate: vi.fn(),
  complete: vi.fn(),
  abortUpload: vi.fn(),
  getUploadStatus: vi.fn(),
}));

vi.mock("@/features/files/workers", () => ({
  fileWorkerManager: {
    isInitialized: () => true,
    init: () => undefined,
    uploadChunks: mocks.uploadChunks,
    abort: mocks.abort,
  },
}));

vi.mock("@/features/files/api/filesApi", () => ({
  filesApi: {
    initiateUpload: mocks.initiate,
    completeUpload: mocks.complete,
    abortUpload: mocks.abortUpload,
    getUploadStatus: mocks.getUploadStatus,
  },
}));

vi.mock("@/config/api", () => ({
  getAccessToken: () => "token",
  refreshAccessToken: async () => "token",
}));

vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));

const ALICE_ORG_1: UploadScope = { userId: "alice", organizationId: "org-1" };
const ALICE_ORG_2: UploadScope = { userId: "alice", organizationId: "org-2" };
const BOB_ORG_1: UploadScope = { userId: "bob", organizationId: "org-1" };
const DEVICE_SEED = new Uint8Array(32).fill(3);

type Engine = typeof import("@/features/files/upload/uploadService") &
  typeof import("@/features/files/upload/uploadStore") &
  typeof import("@/shared/crypto/storageEncryption");

let engine: Engine;
let uninstallWebLocks: () => void = () => undefined;

/** A fresh browser profile signed in as alice, with one module graph so the store and key agree. */
async function loadEngine(): Promise<Engine> {
  vi.resetModules();
  const encryption = await import("@/shared/crypto/storageEncryption");
  await encryption.initStorageEncryption(DEVICE_SEED, "alice");
  const store = await import("@/features/files/upload/uploadStore");
  const service = await import("@/features/files/upload/uploadService");
  return { ...encryption, ...store, ...service };
}

function stored(
  scope: UploadScope,
  id: string,
  overrides: Partial<UploadRecord> = {},
): UploadRecord {
  return {
    id,
    filename: `${id}.bin`,
    mimeType: "application/octet-stream",
    context: "files",
    organizationId: scope.organizationId,
    userId: scope.userId,
    ownerTabId: "tab-closed",
    totalSize: 15,
    uploadedBytes: 0,
    progress: 0,
    status: "uploading",
    createdAt: 1,
    uploadId: `srv-${id}`,
    chunkSize: 5,
    totalChunks: 3,
    ...overrides,
  };
}

async function storeUpload(record: UploadRecord): Promise<void> {
  await engine.putRecord(record);
  expect(await engine.putBlob(record, new Blob([new Uint8Array(15).fill(9)]))).toBe(true);
}

async function rawKeys(store: "records" | "blobs" | "chunks"): Promise<string[]> {
  const db = await openDB("uniffy-uploads");
  const keys = (await db.getAllKeys(store)) as string[];
  db.close();
  return keys.sort();
}

function holdInAnotherTab(id: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void navigator.locks.request(`uniffy:upload:${id}`, {}, () => held);
  return release;
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, String(value)),
    removeItem: (key: string) => void local.delete(key),
  });
  uninstallWebLocks = installWebLocks();
  mocks.uploadChunks.mockReset().mockReturnValue(new Promise<void>(() => undefined));
  mocks.abort.mockReset();
  mocks.abortUpload.mockReset().mockResolvedValue(undefined);
  mocks.initiate
    .mockReset()
    .mockResolvedValue({ uploadId: "srv-new", chunkSize: 1, totalChunks: 1 });
  mocks.complete.mockReset();
  mocks.getUploadStatus.mockReset().mockResolvedValue({
    status: UploadStatus.ACTIVE,
    completedChunks: [],
    totalChunks: 3,
  });
  engine = await loadEngine();
});

afterEach(() => {
  engine.uploadService.resetForScope();
  engine.teardownStorageEncryption();
  uninstallWebLocks();
  vi.unstubAllGlobals();
});

describe("upload recovery scope", () => {
  it("resumes only the tab's own scope and leaves uploads another tab holds", async () => {
    await storeUpload(stored(ALICE_ORG_1, "mine"));
    await storeUpload(stored(ALICE_ORG_2, "other-org"));
    await storeUpload(stored(BOB_ORG_1, "other-user"));
    await storeUpload(stored(ALICE_ORG_1, "other-tab"));
    const release = holdInAnotherTab("other-tab");

    await engine.uploadService.recover(ALICE_ORG_1);

    expect(engine.uploadService.getRecords().map((r) => r.id)).toEqual(["mine"]);
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledOnce());
    expect(mocks.getUploadStatus.mock.calls.map(([request]) => request.uploadId)).toEqual([
      "srv-mine",
    ]);
    expect(await rawKeys("records")).toEqual(["mine", "other-org", "other-tab", "other-user"]);
    release();
  });

  it("resetForScope forgets this tab's uploads and keeps every other tab's records", async () => {
    await storeUpload(stored(ALICE_ORG_1, "other-tab"));
    const release = holdInAnotherTab("other-tab");
    await engine.uploadService.recover(ALICE_ORG_1);
    const [handle] = engine.uploadService.enqueue([
      {
        file: new Blob([new Uint8Array(10)]),
        filename: "mine.bin",
        mimeType: "application/octet-stream",
        organizationId: "org-1",
        context: "files",
      },
    ]);
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledOnce());
    await vi.waitFor(async () => expect(await rawKeys("blobs")).toContain(handle.id));

    engine.uploadService.resetForScope();

    await expect(handle.done).rejects.toThrow("Upload cancelled");
    await vi.waitFor(async () => expect(await rawKeys("records")).toEqual(["other-tab"]));
    expect(await rawKeys("blobs")).toEqual(["other-tab"]);
    release();
  });
});

describe("upload purge", () => {
  beforeEach(async () => {
    await storeUpload(stored(ALICE_ORG_1, "alice-1"));
    await storeUpload(stored(ALICE_ORG_2, "alice-2"));
    await storeUpload(stored(BOB_ORG_1, "bob-1"));
    // A row without an owner stamp, as a client that never scoped its rows left it.
    await engine.putRecord({ ...stored(ALICE_ORG_1, "unowned"), userId: undefined as never });
    await engine.putChunk("rec-alice-1", 1, new Blob(["a"]), ALICE_ORG_1);
    await engine.putChunk("rec-alice-2", 1, new Blob(["a"]), ALICE_ORG_2);
    await engine.putChunk("rec-bob-1", 1, new Blob(["b"]), BOB_ORG_1);
    await engine.putChunk("rec-unowned", 1, new Blob(["c"]), null);
  });

  it("purgeUser deletes the account's records, blobs and chunks and unowned rows only", async () => {
    await engine.uploadService.purgeUser("alice");

    expect(await rawKeys("records")).toEqual(["bob-1"]);
    expect(await rawKeys("blobs")).toEqual(["bob-1"]);
    expect(await rawKeys("chunks")).toEqual(["rec-bob-1:00000001"]);
  });

  it("purgeOrganization deletes only that organization's rows of the account", async () => {
    await engine.uploadService.purgeOrganization("org-1", "alice");

    expect(await rawKeys("records")).toEqual(["alice-2", "bob-1", "unowned"]);
    expect(await rawKeys("blobs")).toEqual(["alice-2", "bob-1"]);
    expect(await rawKeys("chunks")).toEqual([
      "rec-alice-2:00000001",
      "rec-bob-1:00000001",
      "rec-unowned:00000001",
    ]);
  });

  it("purgeOrganization without an account deletes every account's rows of the organization", async () => {
    await engine.uploadService.purgeOrganization("org-1");

    expect(await rawKeys("records")).toEqual(["alice-2"]);
    expect(await rawKeys("chunks")).toEqual(["rec-alice-2:00000001", "rec-unowned:00000001"]);
  });
});

describe("upload blob encryption", () => {
  it("stores ciphertext that reads back only under the scope that wrote it", async () => {
    const owner = stored(ALICE_ORG_1, "secret");
    const bytes = new TextEncoder().encode("plain file bytes");
    expect(await engine.putBlob(owner, new Blob([bytes], { type: "text/plain" }))).toBe(true);

    const db = await openDB("uniffy-uploads");
    const row = await db.get("blobs", "secret");
    db.close();
    expect(row.blob).toBeUndefined();
    expect(new TextDecoder().decode(new Uint8Array(row.data))).not.toContain("plain file bytes");

    const back = await engine.getBlob(owner);
    expect(back?.type).toBe("text/plain");
    expect(new TextDecoder().decode(new Uint8Array(await back!.arrayBuffer()))).toBe(
      "plain file bytes",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await engine.getBlob({ ...owner, organizationId: "org-2" })).toBeUndefined();
    expect(await engine.getBlob({ ...owner, userId: "bob" })).toBeUndefined();
  });

  it("keeps no bytes at rest while storage encryption is not ready", async () => {
    engine.teardownStorageEncryption();
    const owner = stored(ALICE_ORG_1, "unkeyed");
    await engine.putRecord(owner);
    expect(await engine.putBlob(owner, new Blob(["bytes"]))).toBe(false);
    expect(await rawKeys("blobs")).toEqual([]);
  });

  it("asks to re-select an upload whose bytes another scope wrote", async () => {
    const record = stored(ALICE_ORG_1, "swapped");
    await engine.putRecord(record);
    await engine.putBlob({ ...record, organizationId: "org-2" }, new Blob(["bytes"]));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await engine.uploadService.recover(ALICE_ORG_1);

    const recovered = engine.uploadService.getRecords().find((r) => r.id === "swapped");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toMatch(/re-select/i);
    expect(mocks.getUploadStatus).not.toHaveBeenCalled();
  });
});
