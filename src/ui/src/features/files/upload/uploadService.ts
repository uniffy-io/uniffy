import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import { filesApi } from "@/features/files/api/filesApi";
import { fileWorkerManager } from "@/features/files/workers";
import { getAccessToken, refreshAccessToken } from "@/config/api";
import { env } from "@/config/env";
import {
  putRecord,
  putBlob,
  getBlob,
  deleteRecord,
  listIncomplete,
  clearUploadRecords,
} from "@/features/files/upload/uploadStore";
import type {
  UploadInput,
  UploadHandle,
  UploadRecord,
  UploadResult,
  UploadContext,
  UploadListener,
} from "@/features/files/upload/uploadTypes";

export const UPLOAD_MAX_CONCURRENT = 4;
const PROGRESS_FLUSH_MS = 200;

// After a reload the browser cannot re-read the user's disk file, so resume needs the bytes in IDB.
// Persisting large blobs would blow the IDB quota, so above this size we degrade to "re-select".
const UPLOAD_PERSIST_MAX_BYTES = 50 * 1024 * 1024;

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TERMINAL: ReadonlySet<UploadRecord["status"]> = new Set(["completed", "failed", "cancelled"]);

interface Deferred {
  resolve: (result: UploadResult) => void;
  reject: (error: Error) => void;
}

/**
 * Module-level upload engine, owned by no component. Drives initiate -> worker chunk POSTs ->
 * complete entirely outside the React tree, so uploads survive SPA navigation. Framework-agnostic:
 * state lives here and is read via subscribe(); the Redux mirror and chat consume it without
 * the engine knowing about either.
 */
class UploadService {
  private records = new Map<string, UploadRecord>();
  private blobs = new Map<string, Blob>();
  private deferreds = new Map<string, Deferred>();
  private listeners = new Set<UploadListener>();

  private activeCount = 0;
  private flushScheduled = false;
  private generation = 0;

  enqueue(inputs: UploadInput[]): UploadHandle[] {
    this.ensureWorker();

    const handles = inputs.map((input) => {
      const id = generateId();
      this.blobs.set(id, input.file);
      const record: UploadRecord = {
        id,
        filename: input.filename,
        mimeType: input.mimeType,
        context: input.context,
        organizationId: input.organizationId,
        folderId: input.folderId,
        accessMode: input.accessMode,
        totalSize: input.file.size,
        uploadedBytes: 0,
        progress: 0,
        status: "queued",
        createdAt: Date.now(),
      };
      this.records.set(id, record);
      this.persist(id, input.file, input.persist);

      const done = new Promise<UploadResult>((resolve, reject) => {
        this.deferreds.set(id, { resolve, reject });
      });
      // Avoid an unhandled-rejection warning when a caller ignores the handle.
      done.catch(() => undefined);

      return { id, done };
    });

    this.emitNow();
    this.drain();
    return handles;
  }

  cancel(id: string): void {
    const record = this.records.get(id);
    if (!record || TERMINAL.has(record.status)) return;

    record.status = "cancelled";
    record.error = undefined;
    this.emitNow();

    // Stops an in-flight worker loop; no-op if the record was still queued.
    fileWorkerManager.abort(id);

    if (record.uploadId) {
      filesApi.abortUpload({ uploadId: record.uploadId }).catch(() => undefined);
    }

    this.blobs.delete(id);
    void deleteRecord(id);
    this.settle(id, new Error("Upload cancelled"));
  }

  cancelAll(context?: UploadContext): void {
    for (const record of this.records.values()) {
      if (TERMINAL.has(record.status)) continue;
      if (context && record.context !== context) continue;
      this.cancel(record.id);
    }
  }

  reset(): void {
    this.generation += 1;
    this.cancelAll();
    for (const id of this.deferreds.keys()) {
      this.settle(id, new Error("Upload cancelled"));
    }
    this.records.clear();
    this.blobs.clear();
    this.activeCount = 0;
    void clearUploadRecords();
    this.emitNow();
  }

  retry(id: string): void {
    const record = this.records.get(id);
    if (!record || !TERMINAL.has(record.status)) return;

    if (!this.blobs.has(id)) {
      record.status = "failed";
      record.error = "File data no longer available - re-select to upload";
      this.emitNow();
      return;
    }

    record.status = "queued";
    record.uploadedBytes = 0;
    record.progress = 0;
    record.error = undefined;
    record.fileId = undefined;
    record.uploadId = undefined;
    record.chunkSize = undefined;
    record.totalChunks = undefined;
    this.emitNow();
    this.drain();
  }

  subscribe(listener: UploadListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getRecords(context?: UploadContext): ReadonlyArray<UploadRecord> {
    const snapshot = this.snapshot();
    return context ? snapshot.filter((r) => r.context === context) : snapshot;
  }

  /** Called once at app boot: re-queue uploads whose bytes survived a reload, fail the rest. */
  async recover(): Promise<void> {
    const generation = this.generation;
    this.ensureWorker();
    const incomplete = await listIncomplete();
    if (generation !== this.generation) return;
    for (const stored of incomplete) {
      if (this.records.has(stored.id)) continue;

      const blob = stored.uploadId ? await getBlob(stored.id) : undefined;
      if (generation !== this.generation) return;
      if (!blob || !stored.uploadId) {
        // Metadata survived but the bytes did not (oversize/quota) - cannot auto-resume.
        this.records.set(stored.id, {
          ...stored,
          status: "failed",
          error: "Upload interrupted - re-select to upload",
        });
        void deleteRecord(stored.id);
        continue;
      }

      this.blobs.set(stored.id, blob);
      this.records.set(stored.id, { ...stored, status: "queued" });
    }
    this.emitNow();
    this.drain();
  }

  private ensureWorker(): void {
    if (!fileWorkerManager.isInitialized()) {
      fileWorkerManager.init(getAccessToken, refreshAccessToken);
    }
  }

  private persist(id: string, blob: Blob, persistOverride?: boolean): void {
    const record = this.records.get(id);
    if (!record) return;
    void putRecord(record);

    const shouldStoreBlob = persistOverride ?? blob.size <= UPLOAD_PERSIST_MAX_BYTES;
    if (!shouldStoreBlob) {
      // No silent cap on an over-limit file: a reload drops it, surfaced as "re-select" not lost.
      // An explicit persist:false (e.g. chat) is a deliberate opt-out and stays quiet.
      if (persistOverride === undefined) {
        console.warn(
          `[upload] ${record.filename} (${blob.size} bytes) exceeds the persist limit; it will not survive a reload`,
        );
      }
      return;
    }
    void putBlob(id, blob).then((ok) => {
      if (!ok) {
        console.warn(`[upload] could not persist ${record.filename}; it will not survive a reload`);
      }
    });
  }

  private drain(): void {
    while (this.activeCount < UPLOAD_MAX_CONCURRENT) {
      const next = this.nextQueued();
      if (!next) return;

      next.status = "uploading";
      this.activeCount += 1;
      const generation = this.generation;
      void this.process(next.id).finally(() => {
        if (generation !== this.generation) return;
        this.activeCount -= 1;
        this.drain();
      });
    }
  }

  private nextQueued(): UploadRecord | undefined {
    for (const record of this.records.values()) {
      if (record.status === "queued") return record;
    }
    return undefined;
  }

  // Cancellation and session cleanup can retire a record while a request is pending.
  private wasCancelled(id: string): boolean {
    const record = this.records.get(id);
    return !record || record.status === "cancelled";
  }

  private async process(id: string): Promise<void> {
    const record = this.records.get(id);
    const blob = this.blobs.get(id);
    if (!record) return;
    if (!blob) {
      this.fail(id, "File data not found");
      return;
    }

    try {
      let completedChunks: number[] = [];

      if (record.uploadId) {
        // Resume after a reload: the server is the authority on which parts already exist.
        const status = await filesApi.getUploadStatus({ uploadId: record.uploadId });
        if (this.wasCancelled(id)) return;
        if (status.status !== UploadStatus.ACTIVE) {
          this.blobs.delete(id);
          void deleteRecord(id);
          this.fail(id, "Upload session expired - re-select to upload");
          return;
        }
        completedChunks = status.completedChunks.map(Number);
      } else {
        const init = await filesApi.initiateUpload({
          organizationId: record.organizationId,
          filename: record.filename,
          mimeType: record.mimeType,
          totalSize: BigInt(record.totalSize),
          folderId: record.folderId,
          accessMode: record.accessMode,
        });

        if (this.wasCancelled(id)) {
          void filesApi.abortUpload({ uploadId: init.uploadId }).catch(() => undefined);
          return;
        }

        record.uploadId = init.uploadId;
        record.chunkSize = init.chunkSize;
        record.totalChunks = init.totalChunks;
        // Persist the uploadId now so a reload mid-upload can resume via getUploadStatus.
        void putRecord({ ...record, status: "uploading" });
      }

      if (this.wasCancelled(id)) return;
      if (!record.chunkSize || !record.totalChunks) {
        throw new Error("Upload metadata missing - re-select to upload");
      }

      await fileWorkerManager.uploadChunks({
        file: blob,
        uploadId: record.uploadId,
        chunkSize: record.chunkSize,
        totalChunks: record.totalChunks,
        apiUrl: env.apiBaseUrl,
        operationId: id,
        completedChunks,
        onProgress: (_chunks, uploadedBytes) => {
          const live = this.records.get(id);
          if (!live || live.status !== "uploading") return;
          live.uploadedBytes = uploadedBytes;
          live.progress =
            live.totalSize > 0 ? Math.round((uploadedBytes / live.totalSize) * 100) : 0;
          this.scheduleFlush();
        },
      });

      if (this.wasCancelled(id)) return;

      record.status = "completing";
      this.emitNow();

      const response = await filesApi.completeUpload({ uploadId: record.uploadId });
      if (this.wasCancelled(id)) return;

      if (!response.file) {
        throw new Error("Upload completed but no file returned");
      }

      record.status = "completed";
      record.fileId = response.file.id;
      record.uploadedBytes = record.totalSize;
      record.progress = 100;
      this.blobs.delete(id);
      void deleteRecord(id);
      this.emitNow();
      this.settle(id, undefined, { fileId: response.file.id, file: response.file });
    } catch (error) {
      // A cancel mid-flight surfaces here as the worker's abort error; cancel() already settled it.
      if (this.wasCancelled(id)) return;
      const message = error instanceof Error ? error.message : "Upload failed";
      if (message === "Operation aborted") {
        record.status = "cancelled";
        this.blobs.delete(id);
        void deleteRecord(id);
        this.emitNow();
        this.settle(id, new Error("Upload cancelled"));
        return;
      }
      this.fail(id, message);
    }
  }

  private fail(id: string, message: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "failed";
    record.error = message;
    this.blobs.delete(id);
    void deleteRecord(id);
    this.emitNow();
    this.settle(id, new Error(message));
  }

  private settle(id: string, error?: Error, result?: UploadResult): void {
    const deferred = this.deferreds.get(id);
    if (!deferred) return;
    this.deferreds.delete(id);
    if (error) deferred.reject(error);
    else if (result) deferred.resolve(result);
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      this.emitNow();
    }, PROGRESS_FLUSH_MS);
  }

  private snapshot(): ReadonlyArray<UploadRecord> {
    return Array.from(this.records.values(), (record) => ({ ...record }));
  }

  private emitNow(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const uploadService = new UploadService();
