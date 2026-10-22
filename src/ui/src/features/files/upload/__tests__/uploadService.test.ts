import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import type { UploadInput, UploadRecord, UploadScope } from "@/features/files/upload/uploadTypes";
import { installWebLocks } from "@/features/realtime/__tests__/webLocks";

const mocks = vi.hoisted(() => ({
  uploadChunks: vi.fn(),
  abort: vi.fn(),
  initiate: vi.fn(),
  complete: vi.fn(),
  abortUpload: vi.fn(),
  getUploadStatus: vi.fn(),
  putRecord: vi.fn(),
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  getRecord: vi.fn(),
  deleteRecords: vi.fn(),
  deleteRowsMatching: vi.fn(),
  listIncompleteFor: vi.fn(),
  encryptionReady: true,
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

vi.mock("@/features/files/upload/uploadStore", () => ({
  putRecord: mocks.putRecord,
  putBlob: mocks.putBlob,
  getBlob: mocks.getBlob,
  getRecord: mocks.getRecord,
  deleteRecords: mocks.deleteRecords,
  deleteRowsMatching: mocks.deleteRowsMatching,
  listIncompleteFor: mocks.listIncompleteFor,
}));

vi.mock("@/shared/crypto/storageEncryption", () => ({
  isStorageEncryptionReady: () => mocks.encryptionReady,
}));

vi.mock("@/config/api", () => ({
  getAccessToken: () => "token",
  refreshAccessToken: async () => "token",
}));

vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));

type Service = typeof import("@/features/files/upload/uploadService") &
  typeof import("@/features/files/upload/uploadScope");

const SCOPE: UploadScope = { userId: "user-1", organizationId: "org-1" };

async function loadService(): Promise<Service> {
  vi.resetModules();
  const service = await import("@/features/files/upload/uploadService");
  const scope = await import("@/features/files/upload/uploadScope");
  return { ...service, ...scope };
}

/** What the stored records hold: the scoped listing and the re-read under the lock. */
function storeRecords(...records: UploadRecord[]): void {
  mocks.listIncompleteFor.mockResolvedValue(records);
  mocks.getRecord.mockImplementation(async (id: string) => records.find((r) => r.id === id));
}

/** Another tab running the upload: it holds the lock until the returned release runs. */
function holdInAnotherTab(id: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void navigator.locks.request(`uniffy:upload:${id}`, {}, () => held);
  return release;
}

async function lockIsFree(id: string): Promise<boolean> {
  return navigator.locks.request(`uniffy:upload:${id}`, { ifAvailable: true }, (lock) => !!lock);
}

function input(size: number, overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    file: new Blob([new Uint8Array(size)]),
    filename: `f-${size}.bin`,
    mimeType: "application/octet-stream",
    organizationId: "org-1",
    context: "files",
    ...overrides,
  };
}

function never(): Promise<void> {
  return new Promise<void>(() => undefined);
}

let uninstallWebLocks: () => void = () => undefined;

beforeEach(() => {
  uninstallWebLocks = installWebLocks();
  mocks.encryptionReady = true;
  let counter = 0;
  mocks.uploadChunks.mockReset().mockReturnValue(never());
  mocks.abort.mockReset();
  mocks.abortUpload.mockReset().mockResolvedValue(undefined);
  mocks.initiate.mockReset().mockImplementation(async () => ({
    uploadId: `upload-${counter++}`,
    chunkSize: 1,
    totalChunks: 1,
  }));
  mocks.complete.mockReset().mockResolvedValue({ file: { id: "file-default" } });
  mocks.getUploadStatus.mockReset();
  mocks.putRecord.mockReset().mockResolvedValue(undefined);
  mocks.putBlob.mockReset().mockResolvedValue(true);
  mocks.getBlob.mockReset().mockResolvedValue(undefined);
  mocks.getRecord.mockReset().mockResolvedValue(undefined);
  mocks.deleteRecords.mockReset().mockResolvedValue(undefined);
  mocks.deleteRowsMatching.mockReset().mockResolvedValue(undefined);
  mocks.listIncompleteFor.mockReset().mockResolvedValue([]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function storedRecord(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    id: "r1",
    filename: "resume.bin",
    mimeType: "application/octet-stream",
    context: "files",
    organizationId: "org-1",
    userId: "user-1",
    ownerTabId: "tab-closed",
    totalSize: 15,
    uploadedBytes: 5,
    progress: 33,
    status: "uploading",
    createdAt: 1,
    uploadId: "srv-upload-1",
    chunkSize: 5,
    totalChunks: 3,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  uninstallWebLocks();
});

describe("uploadService concurrency", () => {
  it("runs at most UPLOAD_MAX_CONCURRENT uploads at once and queues the rest", async () => {
    const { uploadService, UPLOAD_MAX_CONCURRENT } = await loadService();

    const total = UPLOAD_MAX_CONCURRENT + 2;
    uploadService.enqueue(Array.from({ length: total }, () => input(100)));

    await vi.waitFor(() => {
      expect(mocks.uploadChunks.mock.calls.length).toBe(UPLOAD_MAX_CONCURRENT);
    });

    const records = uploadService.getRecords();
    expect(records.filter((r) => r.status === "uploading")).toHaveLength(UPLOAD_MAX_CONCURRENT);
    expect(records.filter((r) => r.status === "queued")).toHaveLength(2);
  });

  it("starts a queued upload once an active slot frees", async () => {
    const { uploadService, UPLOAD_MAX_CONCURRENT } = await loadService();

    // First slot resolves on demand; the rest stay in-flight to hold their slots.
    let releaseFirst: () => void = () => undefined;
    mocks.uploadChunks.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    uploadService.enqueue(Array.from({ length: UPLOAD_MAX_CONCURRENT + 1 }, () => input(100)));

    await vi.waitFor(() => {
      expect(mocks.uploadChunks.mock.calls.length).toBe(UPLOAD_MAX_CONCURRENT);
    });

    releaseFirst();

    await vi.waitFor(() => {
      expect(mocks.uploadChunks.mock.calls.length).toBe(UPLOAD_MAX_CONCURRENT + 1);
    });
  });
});

describe("uploadService lifecycle", () => {
  it("resolves the handle with the completed file id", async () => {
    const { uploadService } = await loadService();
    mocks.uploadChunks.mockResolvedValueOnce(undefined);
    mocks.complete.mockResolvedValueOnce({ file: { id: "file-xyz" } });

    const [handle] = uploadService.enqueue([input(100)]);
    const result = await handle.done;

    expect(result.fileId).toBe("file-xyz");
    const record = uploadService.getRecords().find((r) => r.id === handle.id);
    expect(record?.status).toBe("completed");
    expect(record?.progress).toBe(100);
  });

  it("marks a record failed and rejects the handle when completion has no file", async () => {
    const { uploadService } = await loadService();
    mocks.uploadChunks.mockResolvedValueOnce(undefined);
    mocks.complete.mockResolvedValueOnce({ file: undefined });

    const [handle] = uploadService.enqueue([input(100)]);
    await expect(handle.done).rejects.toThrow();

    const record = uploadService.getRecords().find((r) => r.id === handle.id);
    expect(record?.status).toBe("failed");
  });
});

describe("uploadService cancel", () => {
  it("cancels a still-queued upload without ever starting it", async () => {
    const { uploadService, UPLOAD_MAX_CONCURRENT } = await loadService();

    const handles = uploadService.enqueue(
      Array.from({ length: UPLOAD_MAX_CONCURRENT + 1 }, () => input(100)),
    );

    await vi.waitFor(() => {
      expect(mocks.uploadChunks.mock.calls.length).toBe(UPLOAD_MAX_CONCURRENT);
    });

    const queued = uploadService.getRecords().find((r) => r.status === "queued");
    expect(queued).toBeDefined();
    const queuedHandle = handles.find((h) => h.id === queued!.id)!;

    uploadService.cancel(queued!.id);

    await expect(queuedHandle.done).rejects.toThrow("Upload cancelled");
    expect(uploadService.getRecords().find((r) => r.id === queued!.id)?.status).toBe("cancelled");
    // Still capped: the cancelled item never consumed a worker call.
    expect(mocks.uploadChunks.mock.calls.length).toBe(UPLOAD_MAX_CONCURRENT);
  });
});

describe("uploadService progress throttle", () => {
  it("coalesces a burst of progress callbacks into a single emit", async () => {
    vi.useFakeTimers();
    const { uploadService } = await loadService();

    mocks.uploadChunks.mockImplementationOnce(
      (opts: { onProgress?: (chunks: number, bytes: number) => void }) => {
        opts.onProgress?.(1, 100);
        opts.onProgress?.(1, 200);
        opts.onProgress?.(1, 300);
        return never();
      },
    );

    const listener = vi.fn();
    uploadService.subscribe(listener);

    uploadService.enqueue([input(1000)]);

    // Let the async initiate -> uploadChunks chain run so the burst fires.
    await vi.advanceTimersByTimeAsync(0);
    const beforeFlush = listener.mock.calls.length;

    await vi.advanceTimersByTimeAsync(200);
    expect(listener.mock.calls.length).toBe(beforeFlush + 1);

    const last = listener.mock.calls.at(-1)![0];
    expect(last[0].uploadedBytes).toBe(300);
    expect(last[0].progress).toBe(30);
  });
});

describe("uploadService recover", () => {
  it("resumes a persisted upload from the first missing part, skipping initiate", async () => {
    const { uploadService } = await loadService();

    storeRecords(storedRecord());
    mocks.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValueOnce({
      status: UploadStatus.ACTIVE,
      completedChunks: [1],
      totalChunks: 3,
    });
    mocks.uploadChunks.mockResolvedValueOnce(undefined);
    mocks.complete.mockResolvedValueOnce({ file: { id: "file-resumed" } });

    await uploadService.recover(SCOPE);

    await vi.waitFor(() => {
      expect(uploadService.getRecords().find((r) => r.id === "r1")?.status).toBe("completed");
    });

    expect(mocks.initiate).not.toHaveBeenCalled();
    const opts = mocks.uploadChunks.mock.calls[0][0];
    expect(opts.completedChunks).toEqual([1]);
    expect(opts.chunkSize).toBe(5);
    expect(opts.totalChunks).toBe(3);
  });

  it("fails a persisted upload whose bytes did not survive the reload", async () => {
    const { uploadService } = await loadService();

    storeRecords(storedRecord({ id: "r2" }));
    mocks.getBlob.mockResolvedValueOnce(undefined);

    await uploadService.recover(SCOPE);

    const record = uploadService.getRecords().find((r) => r.id === "r2");
    expect(record?.status).toBe("failed");
    expect(record?.error).toMatch(/re-select/i);
    expect(mocks.deleteRecords).toHaveBeenCalledWith(["r2"]);
    expect(mocks.uploadChunks).not.toHaveBeenCalled();
  });

  it("fails a resumed upload whose server session expired", async () => {
    const { uploadService } = await loadService();

    storeRecords(storedRecord({ id: "r3" }));
    mocks.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValueOnce({
      status: UploadStatus.COMPLETED,
      completedChunks: [1, 2, 3],
      totalChunks: 3,
    });

    await uploadService.recover(SCOPE);

    await vi.waitFor(() => {
      expect(uploadService.getRecords().find((r) => r.id === "r3")?.status).toBe("failed");
    });
    expect(mocks.uploadChunks).not.toHaveBeenCalled();
  });
});

describe("uploadService recover scope", () => {
  it("lists only the tab's account and organization", async () => {
    const { uploadService } = await loadService();
    await uploadService.recover({ userId: "user-2", organizationId: "org-9" });
    expect(mocks.listIncompleteFor).toHaveBeenCalledWith({
      userId: "user-2",
      organizationId: "org-9",
    });
  });

  it("leaves a record another tab is still uploading", async () => {
    const { uploadService } = await loadService();
    storeRecords(storedRecord({ id: "busy" }), storedRecord({ id: "free", uploadId: "srv-free" }));
    mocks.getBlob.mockResolvedValue(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValue({
      status: UploadStatus.ACTIVE,
      completedChunks: [],
      totalChunks: 3,
    });
    const release = holdInAnotherTab("busy");

    await uploadService.recover(SCOPE);

    expect(uploadService.getRecords().map((r) => r.id)).toEqual(["free"]);
    await vi.waitFor(() => expect(mocks.getUploadStatus).toHaveBeenCalledOnce());
    expect(mocks.getUploadStatus).toHaveBeenCalledWith({ uploadId: "srv-free" });
    expect(mocks.getBlob).toHaveBeenCalledTimes(1);
    release();
  });

  it("skips a record whose stored row belongs to another organization or account", async () => {
    const { uploadService } = await loadService();
    const listed = [storedRecord({ id: "moved" }), storedRecord({ id: "foreign" })];
    mocks.listIncompleteFor.mockResolvedValue(listed);
    mocks.getRecord.mockImplementation(async (id: string) =>
      id === "moved"
        ? storedRecord({ id, organizationId: "org-2" })
        : storedRecord({ id, userId: "user-2" }),
    );

    await uploadService.recover(SCOPE);

    expect(uploadService.getRecords()).toEqual([]);
    expect(mocks.getBlob).not.toHaveBeenCalled();
    expect(await lockIsFree("moved")).toBe(true);
    expect(await lockIsFree("foreign")).toBe(true);
  });

  it("holds the lock of a resumed upload and stamps this tab as its owner", async () => {
    const { uploadService, uploadTabId } = await loadService();
    storeRecords(storedRecord());
    mocks.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValueOnce({
      status: UploadStatus.ACTIVE,
      completedChunks: [],
      totalChunks: 3,
    });

    await uploadService.recover(SCOPE);

    expect(uploadService.getRecords()[0].ownerTabId).toBe(uploadTabId());
    expect(mocks.putRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1", ownerTabId: uploadTabId() }),
    );
    expect(await lockIsFree("r1")).toBe(false);
  });

  it("without Web Locks resumes only the records this tab owns", async () => {
    uninstallWebLocks();
    const { uploadService, uploadTabId } = await loadService();
    storeRecords(
      storedRecord({ id: "elsewhere", ownerTabId: "tab-live" }),
      storedRecord({ id: "own", ownerTabId: uploadTabId() }),
    );
    mocks.getBlob.mockResolvedValue(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValue({
      status: UploadStatus.ACTIVE,
      completedChunks: [],
      totalChunks: 3,
    });

    await uploadService.recover(SCOPE);

    expect(uploadService.getRecords().map((r) => r.id)).toEqual(["own"]);
  });

  it("stops a recovery that a newer scope replaced", async () => {
    const { uploadService } = await loadService();
    const pending = deferred<UploadRecord[]>();
    mocks.listIncompleteFor.mockReturnValueOnce(pending.promise);
    const stale = uploadService.recover(SCOPE);
    await uploadService.recover({ userId: "user-1", organizationId: "org-2" });
    pending.resolve([storedRecord()]);
    await stale;
    expect(mocks.getRecord).not.toHaveBeenCalled();
    expect(uploadService.getRecords()).toEqual([]);
  });
});

describe("uploadService enqueue ownership", () => {
  it("stamps the account and tab and holds the upload lock until the row is gone", async () => {
    const { uploadService, uploadTabId } = await loadService();
    await uploadService.recover(SCOPE);
    const finish = deferred<void>();
    mocks.uploadChunks.mockReturnValueOnce(finish.promise);

    const [handle] = uploadService.enqueue([input(100)]);

    const record = uploadService.getRecords()[0];
    expect(record.userId).toBe("user-1");
    expect(record.ownerTabId).toBe(uploadTabId());
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledOnce());
    expect(await lockIsFree(handle.id)).toBe(false);

    finish.resolve();
    await handle.done;
    await vi.waitFor(async () => expect(await lockIsFree(handle.id)).toBe(true));
    expect(mocks.deleteRecords).toHaveBeenCalledWith([handle.id]);
  });

  it("stores the bytes only while storage encryption is ready", async () => {
    const { uploadService } = await loadService();
    await uploadService.recover(SCOPE);

    mocks.encryptionReady = false;
    uploadService.enqueue([input(100)]);
    expect(mocks.putRecord).toHaveBeenCalledTimes(1);
    expect(mocks.putBlob).not.toHaveBeenCalled();

    mocks.encryptionReady = true;
    const [handle] = uploadService.enqueue([input(100)]);
    expect(mocks.putBlob).toHaveBeenCalledWith(
      expect.objectContaining({ id: handle.id, userId: "user-1", organizationId: "org-1" }),
      expect.any(Blob),
    );
  });

  it("persists nothing for a tab that has no account yet", async () => {
    const { uploadService } = await loadService();
    uploadService.enqueue([input(100)]);
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledOnce());
    expect(uploadService.getRecords()[0].userId).toBe("");
    expect(mocks.putRecord).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });

  it("reports active uploads until they settle", async () => {
    const { uploadService } = await loadService();
    expect(uploadService.hasActiveUploads()).toBe(false);
    const finish = deferred<void>();
    mocks.uploadChunks.mockReturnValueOnce(finish.promise);
    const [handle] = uploadService.enqueue([input(100)]);
    expect(uploadService.hasActiveUploads()).toBe(true);
    finish.resolve();
    await handle.done;
    expect(uploadService.hasActiveUploads()).toBe(false);
  });
});

describe("uploadService purge", () => {
  it("purgeUser drops this tab's uploads and the account's stored rows", async () => {
    const { uploadService } = await loadService();
    await uploadService.recover(SCOPE);
    const [handle] = uploadService.enqueue([input(100)]);

    await uploadService.purgeUser("user-1");

    await expect(handle.done).rejects.toThrow("Upload cancelled");
    expect(uploadService.getRecords()).toEqual([]);
    const match = mocks.deleteRowsMatching.mock.calls[0][0] as (owner: object) => boolean;
    expect(match({ userId: "user-1", organizationId: "org-2" })).toBe(true);
    expect(match({})).toBe(true);
    expect(match({ userId: "user-2", organizationId: "org-1" })).toBe(false);
  });

  it("purgeOrganization drops only that organization's uploads and rows", async () => {
    const { uploadService, getUploadScope } = await loadService();
    await uploadService.recover(SCOPE);
    const [lost] = uploadService.enqueue([input(100)]);
    const [kept] = uploadService.enqueue([input(100, { organizationId: "org-2" })]);

    await uploadService.purgeOrganization("org-1", "user-1");

    await expect(lost.done).rejects.toThrow("Upload cancelled");
    expect(uploadService.getRecords().map((r) => r.id)).toEqual([kept.id]);
    expect(getUploadScope()).toBeNull();
    const match = mocks.deleteRowsMatching.mock.calls[0][0] as (owner: object) => boolean;
    expect(match({ userId: "user-1", organizationId: "org-1" })).toBe(true);
    expect(match({ userId: "user-1", organizationId: "org-2" })).toBe(false);
    expect(match({ userId: "user-2", organizationId: "org-1" })).toBe(false);
    expect(match({})).toBe(false);
  });

  it("purgeOrganization without an account drops every account's rows of that organization", async () => {
    const { uploadService } = await loadService();
    await uploadService.purgeOrganization("org-1");
    const match = mocks.deleteRowsMatching.mock.calls[0][0] as (owner: object) => boolean;
    expect(match({ userId: "user-2", organizationId: "org-1" })).toBe(true);
    expect(match({ userId: "user-1", organizationId: "org-2" })).toBe(false);
  });
});

describe("uploadService scope reset", () => {
  it("cancels and forgets only this tab's records, never the shared stores", async () => {
    const { uploadService, getUploadScope } = await loadService();
    await uploadService.recover(SCOPE);
    const release = holdInAnotherTab("other-tab");
    const [handle] = uploadService.enqueue([input(100)]);
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledOnce());

    uploadService.resetForScope();

    await expect(handle.done).rejects.toThrow("Upload cancelled");
    expect(mocks.abortUpload).toHaveBeenCalledWith({ uploadId: "upload-0" });
    const deleted = mocks.deleteRecords.mock.calls.flatMap(([ids]) => ids as string[]);
    expect(new Set(deleted)).toEqual(new Set([handle.id]));
    expect(mocks.deleteRowsMatching).not.toHaveBeenCalled();
    expect(await lockIsFree("other-tab")).toBe(false);
    await vi.waitFor(async () => expect(await lockIsFree(handle.id)).toBe(true));
    expect(getUploadScope()).toBeNull();
    release();
  });

  it("keeps reset as an alias of resetForScope", async () => {
    const { uploadService } = await loadService();
    const [handle] = uploadService.enqueue([input(100)]);
    uploadService.reset();
    await expect(handle.done).rejects.toThrow("Upload cancelled");
    expect(uploadService.getRecords()).toEqual([]);
  });

  it("clears terminal history and keeps it out of subsequent mirror updates", async () => {
    const { uploadService } = await loadService();
    const { subscribeUploadMirror } = await import("@/features/files/upload/reduxMirror");
    const dispatch = vi.fn();
    const unsubscribe = subscribeUploadMirror(dispatch);
    mocks.uploadChunks.mockResolvedValueOnce(undefined);
    const [completed] = uploadService.enqueue([input(100)]);
    await completed.done;
    mocks.initiate.mockRejectedValueOnce(new Error("Failed upload"));
    const [failed] = uploadService.enqueue([input(100)]);
    await expect(failed.done).rejects.toThrow("Failed upload");
    const [cancelled] = uploadService.enqueue([input(100)]);
    uploadService.cancel(cancelled.id);
    await expect(cancelled.done).rejects.toThrow("Upload cancelled");
    expect(uploadService.getRecords().map((record) => record.status)).toEqual([
      "completed",
      "failed",
      "cancelled",
    ]);

    uploadService.resetForScope();
    expect(uploadService.getRecords()).toEqual([]);
    expect(mocks.deleteRowsMatching).not.toHaveBeenCalled();
    expect(dispatch.mock.calls.at(-1)?.[0].payload).toEqual([]);
    const [current] = uploadService.enqueue([input(100, { organizationId: "org-2" })]);
    expect(
      dispatch.mock.calls.at(-1)?.[0].payload.map((record: UploadRecord) => record.id),
    ).toEqual([current.id]);
    unsubscribe();
  });

  it.each(["initiate", "uploadChunks", "complete"] as const)(
    "ignores a pending %s response after reset",
    async (stage) => {
      const { uploadService } = await loadService();
      const pending = deferred<unknown>();
      mocks.uploadChunks.mockResolvedValue(undefined);
      mocks[stage].mockReturnValueOnce(pending.promise);
      const [handle] = uploadService.enqueue([input(100)]);
      await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledOnce());
      uploadService.resetForScope();
      await expect(handle.done).rejects.toThrow("Upload cancelled");
      pending.resolve(
        stage === "initiate"
          ? { uploadId: "late-upload", chunkSize: 1, totalChunks: 1 }
          : stage === "complete"
            ? { file: { id: "old-file" } }
            : undefined,
      );
      await pending.promise;
      await Promise.resolve();
      expect(uploadService.getRecords()).toEqual([]);
      if (stage === "initiate") {
        expect(mocks.uploadChunks).not.toHaveBeenCalled();
        expect(mocks.abortUpload).toHaveBeenCalledWith({ uploadId: "late-upload" });
      }
      if (stage !== "complete") expect(mocks.complete).not.toHaveBeenCalled();
    },
  );

  it.each(["listIncompleteFor", "getRecord", "getBlob"] as const)(
    "ignores recovery awaiting %s when reset happens",
    async (stage) => {
      const { uploadService } = await loadService();
      const pending = deferred<unknown>();
      storeRecords(storedRecord());
      mocks.getBlob.mockResolvedValue(new Blob(["old bytes"]));
      mocks[stage].mockReturnValueOnce(pending.promise);
      const recovery = uploadService.recover(SCOPE);
      await vi.waitFor(() => expect(mocks[stage]).toHaveBeenCalledOnce());
      uploadService.resetForScope();
      pending.resolve(
        stage === "listIncompleteFor"
          ? [storedRecord()]
          : stage === "getRecord"
            ? storedRecord()
            : new Blob(["old bytes"]),
      );
      await recovery;
      expect(uploadService.getRecords()).toEqual([]);
      expect(mocks.uploadChunks).not.toHaveBeenCalled();
      expect(await lockIsFree("r1")).toBe(true);
    },
  );

  it("keeps the new session's concurrency budget when old workers settle", async () => {
    const { uploadService, UPLOAD_MAX_CONCURRENT } = await loadService();
    const pending = deferred<void>();
    for (let i = 0; i < UPLOAD_MAX_CONCURRENT; i++) {
      mocks.uploadChunks.mockReturnValueOnce(pending.promise);
    }
    const old = uploadService.enqueue(
      Array.from({ length: UPLOAD_MAX_CONCURRENT }, () => input(100)),
    );
    await vi.waitFor(() => expect(mocks.uploadChunks).toHaveBeenCalledTimes(UPLOAD_MAX_CONCURRENT));
    uploadService.resetForScope();
    await Promise.all(old.map((handle) => expect(handle.done).rejects.toThrow("Upload cancelled")));
    uploadService.enqueue(Array.from({ length: UPLOAD_MAX_CONCURRENT + 1 }, () => input(100)));
    await vi.waitFor(() =>
      expect(mocks.uploadChunks).toHaveBeenCalledTimes(2 * UPLOAD_MAX_CONCURRENT),
    );
    pending.resolve();
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.uploadChunks).toHaveBeenCalledTimes(2 * UPLOAD_MAX_CONCURRENT);
    expect(uploadService.getRecords().filter((record) => record.status === "queued")).toHaveLength(
      1,
    );
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
