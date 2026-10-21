import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import type { UploadScope } from "@/features/files/upload/uploadTypes";

const mocks = vi.hoisted(() => ({
  getUploadStatus: vi.fn(),
  uploadChunk: vi.fn(),
  completeUpload: vi.fn(),
}));

vi.mock("@/features/files/api/filesApi", () => ({
  filesApi: {
    getUploadStatus: mocks.getUploadStatus,
    uploadChunk: mocks.uploadChunk,
    completeUpload: mocks.completeUpload,
  },
}));

const ALICE_ORG_1: UploadScope = { userId: "alice", organizationId: "org-1" };
const ALICE_ORG_2: UploadScope = { userId: "alice", organizationId: "org-2" };
const BOB_ORG_1: UploadScope = { userId: "bob", organizationId: "org-1" };

type Recovery = typeof import("@/features/recording/utils/recoverOrphanedRecordings") &
  typeof import("@/features/files/upload/uploadStore") &
  typeof import("@/shared/crypto/storageEncryption") &
  typeof import("@/features/files/upload/uploadScope");

const DEVICE_SEED = new Uint8Array(32).fill(3);

async function loadRecovery(ready = true): Promise<Recovery> {
  vi.resetModules();
  const encryption = await import("@/shared/crypto/storageEncryption");
  if (ready) await encryption.initStorageEncryption(DEVICE_SEED, "alice");
  const recovery = await import("@/features/recording/utils/recoverOrphanedRecordings");
  const store = await import("@/features/files/upload/uploadStore");
  const scope = await import("@/features/files/upload/uploadScope");
  return { ...recovery, ...store, ...scope, ...encryption };
}

/** Writes one buffered part as a recording tab in `scope` would, a while before recovery runs. */
async function leaveChunk(recovery: Recovery, uploadId: string, scope: UploadScope) {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  await recovery.putChunk(uploadId, 1, new Blob(["part"]), scope);
  now.mockRestore();
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  });
  mocks.getUploadStatus.mockReset().mockResolvedValue({
    status: UploadStatus.ACTIVE,
    completedChunks: [],
    totalChunks: 0,
  });
  mocks.uploadChunk.mockReset().mockResolvedValue({});
  mocks.completeUpload
    .mockReset()
    .mockImplementation(async ({ uploadId }: { uploadId: string }) => ({
      file: { id: `file-${uploadId}`, filename: `${uploadId}.webm` },
    }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recoverOrphanedRecordings", () => {
  it("preserves buffered bytes during reload until encryption becomes ready", async () => {
    let recovery = await loadRecovery();
    await leaveChunk(recovery, "delayed-key", ALICE_ORG_1);
    recovery = await loadRecovery(false);
    const recovered = vi.fn();
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    expect(mocks.getUploadStatus).not.toHaveBeenCalled();
    await expect(recovery.resumeUpload("delayed-key", ALICE_ORG_1)).rejects.toThrow("not ready");
    expect(mocks.completeUpload).not.toHaveBeenCalled();
    await recovery.initStorageEncryption(DEVICE_SEED, "alice");
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    expect(mocks.uploadChunk).toHaveBeenCalledWith(
      expect.objectContaining({ data: new TextEncoder().encode("part") }),
    );
    expect(recovered).toHaveBeenCalledOnce();
  });

  it("retains ciphertext after a transient recovery error and allows retry", async () => {
    const recovery = await loadRecovery();
    await leaveChunk(recovery, "retry", ALICE_ORG_1);
    mocks.uploadChunk.mockRejectedValueOnce(new Error("offline"));
    const recovered = vi.fn();
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    expect(await recovery.loadPendingChunks("retry", ALICE_ORG_1)).toHaveLength(1);
    expect(mocks.completeUpload).not.toHaveBeenCalled();
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    expect(recovered).toHaveBeenCalledOnce();
  });
  it("resumes only recordings the tab's account and organization buffered", async () => {
    const recovery = await loadRecovery();
    await leaveChunk(recovery, "rec-mine", ALICE_ORG_1);
    await leaveChunk(recovery, "rec-other-org", ALICE_ORG_2);
    await leaveChunk(recovery, "rec-other-user", BOB_ORG_1);
    const recovered = vi.fn();

    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);

    expect(mocks.getUploadStatus.mock.calls.map(([request]) => request.uploadId)).toEqual([
      "rec-mine",
    ]);
    expect(recovered).toHaveBeenCalledWith({ fileId: "file-rec-mine", filename: "rec-mine.webm" });
    expect(await recovery.loadPendingChunks("rec-mine", ALICE_ORG_1)).toEqual([]);
    expect(await recovery.loadPendingChunks("rec-other-org", ALICE_ORG_2)).toHaveLength(1);
    expect(await recovery.loadPendingChunks("rec-other-user", BOB_ORG_1)).toHaveLength(1);
  });

  it("stamps buffered parts with the tab's scope and waits for one before recovering", async () => {
    const recovery = await loadRecovery();
    const recovered = vi.fn();
    await recovery.recoverOrphanedRecordings(recovered);
    expect(mocks.getUploadStatus).not.toHaveBeenCalled();

    recovery.setUploadScope(ALICE_ORG_1);
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await recovery.putChunk("rec-stamped", 1, new Blob(["part"]));
    now.mockRestore();

    await recovery.recoverOrphanedRecordings(recovered);
    expect(recovered).toHaveBeenCalledWith({
      fileId: "file-rec-stamped",
      filename: "rec-stamped.webm",
    });
  });

  it("recovers each scope once and a switched tab recovers the new one", async () => {
    const recovery = await loadRecovery();
    await leaveChunk(recovery, "rec-org-1", ALICE_ORG_1);
    await leaveChunk(recovery, "rec-org-2", ALICE_ORG_2);
    const recovered = vi.fn();

    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_1);
    await recovery.recoverOrphanedRecordings(recovered, ALICE_ORG_2);

    expect(mocks.getUploadStatus.mock.calls.map(([request]) => request.uploadId)).toEqual([
      "rec-org-1",
      "rec-org-2",
    ]);
  });
});
