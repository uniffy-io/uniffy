import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import type { UploadInput, UploadRecord } from "@/features/files/upload/uploadTypes";

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
  deleteRecord: vi.fn(),
  listIncomplete: vi.fn(),
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
  deleteRecord: mocks.deleteRecord,
  listIncomplete: mocks.listIncomplete,
}));

vi.mock("@/config/api", () => ({
  getAccessToken: () => "token",
  refreshAccessToken: async () => "token",
}));

vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));

type Service = typeof import("@/features/files/upload/uploadService");

async function loadService(): Promise<Service> {
  vi.resetModules();
  return import("@/features/files/upload/uploadService");
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

beforeEach(() => {
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
  mocks.deleteRecord.mockReset().mockResolvedValue(undefined);
  mocks.listIncomplete.mockReset().mockResolvedValue([]);
});

function storedRecord(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    id: "r1",
    filename: "resume.bin",
    mimeType: "application/octet-stream",
    context: "files",
    organizationId: "org-1",
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

    mocks.listIncomplete.mockResolvedValueOnce([storedRecord()]);
    mocks.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValueOnce({
      status: UploadStatus.ACTIVE,
      completedChunks: [1],
      totalChunks: 3,
    });
    mocks.uploadChunks.mockResolvedValueOnce(undefined);
    mocks.complete.mockResolvedValueOnce({ file: { id: "file-resumed" } });

    await uploadService.recover();

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

    mocks.listIncomplete.mockResolvedValueOnce([storedRecord({ id: "r2" })]);
    mocks.getBlob.mockResolvedValueOnce(undefined);

    await uploadService.recover();

    const record = uploadService.getRecords().find((r) => r.id === "r2");
    expect(record?.status).toBe("failed");
    expect(record?.error).toMatch(/re-select/i);
    expect(mocks.deleteRecord).toHaveBeenCalledWith("r2");
    expect(mocks.uploadChunks).not.toHaveBeenCalled();
  });

  it("fails a resumed upload whose server session expired", async () => {
    const { uploadService } = await loadService();

    mocks.listIncomplete.mockResolvedValueOnce([storedRecord({ id: "r3" })]);
    mocks.getBlob.mockResolvedValueOnce(new Blob([new Uint8Array(15)]));
    mocks.getUploadStatus.mockResolvedValueOnce({
      status: UploadStatus.COMPLETED,
      completedChunks: [1, 2, 3],
      totalChunks: 3,
    });

    await uploadService.recover();

    await vi.waitFor(() => {
      expect(uploadService.getRecords().find((r) => r.id === "r3")?.status).toBe("failed");
    });
    expect(mocks.uploadChunks).not.toHaveBeenCalled();
  });
});
