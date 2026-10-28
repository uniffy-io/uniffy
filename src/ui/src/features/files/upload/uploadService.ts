import { UploadStatus } from "@uniffy/proto/files/v1/files_pb";
import { filesApi } from "@/features/files/api/filesApi";
import { fileWorkerManager } from "@/features/files/workers";
import { getAccessToken, refreshAccessToken } from "@/config/api";
import { env } from "@/config/env";
import {
  putRecord,
  putBlob,
  getBlob,
  getRecord,
  deleteRecords,
  deleteRowsMatching,
  listIncompleteFor,
  type StoredRowOwner,
} from "@/features/files/upload/uploadStore";
import {
  generateUploadId,
  getUploadScope,
  sameUploadScope,
  setUploadScope,
  uploadTabId,
} from "@/features/files/upload/uploadScope";
import type {
  UploadInput,
  UploadHandle,
  UploadRecord,
  UploadResult,
  UploadContext,
  UploadListener,
  UploadScope,
} from "@/features/files/upload/uploadTypes";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";

export const UPLOAD_MAX_CONCURRENT = 4;
const PROGRESS_FLUSH_MS = 200;

// After a reload the browser cannot re-read the user's disk file, so resume needs the bytes in IDB.
// Persisting large blobs would blow the IDB quota, so above this size we degrade to "re-select".
const UPLOAD_PERSIST_MAX_BYTES = 50 * 1024 * 1024;

const TERMINAL: ReadonlySet<UploadRecord["status"]> = new Set(["completed", "failed", "cancelled"]);

interface Deferred {
  resolve: (result: UploadResult) => void;
  reject: (error: Error) => void;
}

// Web Locks span every tab of this origin. The tab that runs an upload holds its lock until the
// stored row is gone, so recovery in another tab never resumes it a second time. Plain HTTP origins
// have no Web Locks; there a tab resumes only the records it owns.
function lockManager(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

const uploadLockName = (id: string) => `uniffy:upload:${id}`;

/** Holds the upload for this tab until the returned release runs. */
function holdUploadLock(id: string): () => void {
  const locks = lockManager();
  if (!locks) return () => {};
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.request(uploadLockName(id), { mode: "exclusive" }, () => held).catch(() => undefined);
  return release;
}

/** Takes the upload's lock when no tab holds it; null while one does. */
function claimUploadLock(id: string): Promise<(() => void) | null> {
  const locks = lockManager();
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    locks
      .request(uploadLockName(id), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return null;
        }
        resolve(release);
        return held;
      })
      // A lock manager that refuses the request leaves the record to this tab.
      .catch(() => resolve(() => {}));
  });
}

/**
 * Module-level upload engine, owned by no component. Drives initiate -> worker chunk POSTs ->
 * complete entirely outside the React tree, so uploads survive SPA navigation. Framework-agnostic:
 * state lives here and is read via subscribe(); the Redux mirror and chat consume it without
 * the engine knowing about either. Memory holds this tab's uploads only; other tabs share the store.
 */
class UploadService {
  private records = new Map<string, UploadRecord>();
  private blobs = new Map<string, Blob>();
  private deferreds = new Map<string, Deferred>();
  private listeners = new Set<UploadListener>();
  private lockReleases = new Map<string, () => void>();
  private blobWrites = new Map<string, Promise<boolean>>();

  private activeCount = 0;
  private flushScheduled = false;
  private generation = 0;

  enqueue(inputs: UploadInput[]): UploadHandle[] {
    this.ensureWorker();
    const userId = getUploadScope()?.userId ?? "";

    const handles = inputs.map((input) => {
      const id = generateUploadId();
      this.blobs.set(id, input.file);
      const record: UploadRecord = {
        id,
        filename: input.filename,
        mimeType: input.mimeType,
        context: input.context,
        organizationId: input.organizationId,
        userId,
        ownerTabId: uploadTabId(),
        folderId: input.folderId,
        accessMode: input.accessMode,
        totalSize: input.file.size,
        uploadedBytes: 0,
        progress: 0,
        status: "queued",
        createdAt: Date.now(),
      };
      this.records.set(id, record);
      this.lockReleases.set(id, holdUploadLock(id));
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
    this.retire(id);
    this.settle(id, new Error("Upload cancelled"));
  }

  cancelAll(context?: UploadContext): void {
    for (const record of this.records.values()) {
      if (TERMINAL.has(record.status)) continue;
      if (context && record.context !== context) continue;
      this.cancel(record.id);
    }
  }

  /** Ends this tab's scope: cancels and forgets its uploads. Other tabs' stored records stay. */
  resetForScope(): void {
    this.generation += 1;
    setUploadScope(null);
    const ids = Array.from(this.records.keys());
    this.cancelAll();
    for (const id of this.deferreds.keys()) {
      this.settle(id, new Error("Upload cancelled"));
    }
    this.retire(...ids);
    this.records.clear();
    this.blobs.clear();
    this.activeCount = 0;
    this.emitNow();
  }

  /** @deprecated Use resetForScope, purgeUser or purgeOrganization. */
  reset(): void {
    this.resetForScope();
  }

  /** Sign-out and session death: drops this tab's uploads and every stored row of the account. */
  async purgeUser(userId: string): Promise<void> {
    this.resetForScope();
    await Promise.allSettled(this.blobWrites.values());
    // A row without an owner stamp cannot be told apart from this account's, so it goes too.
    await deleteRowsMatching((owner) => !owner.userId || owner.userId === userId);
  }

  /**
   * A confirmed lost grant: drops the organization's uploads in this tab and its stored rows for
   * every tab, since the server refuses them now. `userId` narrows the purge to one account.
   */
  async purgeOrganization(organizationId: string, userId?: string): Promise<void> {
    const owned = (owner: StoredRowOwner) =>
      owner.organizationId === organizationId && (!userId || owner.userId === userId);
    const scope = getUploadScope();
    if (scope && owned(scope)) setUploadScope(null);
    const dropped = Array.from(this.records.values()).filter(owned);
    for (const record of dropped) {
      this.cancel(record.id);
      this.records.delete(record.id);
      this.blobs.delete(record.id);
      this.settle(record.id, new Error("Upload cancelled"));
    }
    if (dropped.length > 0) this.emitNow();
    await Promise.allSettled(this.blobWrites.values());
    await deleteRowsMatching(owned);
  }

  /** True while this tab runs an upload that ending its scope would cancel. */
  hasActiveUploads(): boolean {
    for (const record of this.records.values()) {
      if (!TERMINAL.has(record.status)) return true;
    }
    return false;
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
    if (!this.lockReleases.has(id)) this.lockReleases.set(id, holdUploadLock(id));
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

  /**
   * Makes `scope` this tab's scope and re-queues its stored uploads that no live tab holds, so a
   * reload or a closed tab resumes. Records of other accounts and organizations stay untouched.
   */
  async recover(scope: UploadScope): Promise<void> {
    const current: UploadScope = { userId: scope.userId, organizationId: scope.organizationId };
    setUploadScope(current);
    if (!isStorageEncryptionReady()) return;
    const generation = this.generation;
    const live = () => generation === this.generation && getUploadScope() === current;
    const hasWebLocks = lockManager() !== null;
    this.ensureWorker();
    const incomplete = await listIncompleteFor(current);
    if (!live()) return;
    for (const candidate of incomplete) {
      if (this.records.has(candidate.id)) continue;
      // Without Web Locks a live tab's upload looks the same as an abandoned one.
      if (!hasWebLocks && candidate.ownerTabId !== uploadTabId()) continue;
      const release = await claimUploadLock(candidate.id);
      if (!release) continue;

      // Read again under the lock: the tab that held it may have finished and deleted the row.
      const stored = live() ? await getRecord(candidate.id) : undefined;
      if (!live()) {
        release();
        return;
      }
      if (!stored || TERMINAL.has(stored.status) || !sameUploadScope(stored, current)) {
        release();
        continue;
      }
      const blob = stored.uploadId ? await getBlob(stored) : undefined;
      if (!live() || !isStorageEncryptionReady()) {
        release();
        return;
      }

      const adopted: UploadRecord = { ...stored, ownerTabId: uploadTabId() };
      this.lockReleases.set(stored.id, release);
      if (!blob || !stored.uploadId) {
        // Metadata survived but the bytes did not (oversize, quota, no storage key).
        this.records.set(stored.id, {
          ...adopted,
          status: "failed",
          error: "Upload interrupted - re-select to upload",
        });
        this.retire(stored.id);
        continue;
      }

      this.blobs.set(stored.id, blob);
      this.records.set(stored.id, { ...adopted, status: "queued" });
      this.save(adopted);
    }
    this.emitNow();
    this.drain();
  }

  private ensureWorker(): void {
    if (!fileWorkerManager.isInitialized()) {
      fileWorkerManager.init(getAccessToken, refreshAccessToken);
    }
  }

  // Retires the stored row and releases the lock only after the row is gone, so no tab can claim
  // a record whose upload just finished here.
  private retire(...ids: string[]): void {
    if (ids.length === 0) return;
    const releases = ids.flatMap((id) => {
      const release = this.lockReleases.get(id);
      this.lockReleases.delete(id);
      return release ? [release] : [];
    });
    const writes = ids.flatMap((id) => this.blobWrites.get(id) ?? []);
    const deleted =
      writes.length === 0
        ? deleteRecords(ids)
        : Promise.allSettled(writes).then(() => deleteRecords(ids));
    void deleted.finally(() => {
      for (const release of releases) release();
    });
  }

  // A row without an account could never be matched to a scope again.
  private save(record: UploadRecord): void {
    if (record.userId) void putRecord(record);
  }

  private persist(id: string, blob: Blob, persistOverride?: boolean): void {
    const record = this.records.get(id);
    if (!record?.userId) return;
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
    // File bytes rest only encrypted, so without the storage key a reload asks to re-select.
    if (!isStorageEncryptionReady()) return;
    const write = putBlob(record, blob).then((ok) => {
      if (!ok) {
        console.warn(`[upload] could not persist ${record.filename}; it will not survive a reload`);
      }
      return ok;
    });
    this.blobWrites.set(id, write);
    void write.finally(() => {
      if (this.blobWrites.get(id) === write) this.blobWrites.delete(id);
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
        this.save({ ...record, status: "uploading" });
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
      this.retire(id);
      this.emitNow();
      this.settle(id, undefined, { fileId: response.file.id, file: response.file });
    } catch (error) {
      // A cancel mid-flight surfaces here as the worker's abort error; cancel() already settled it.
      if (this.wasCancelled(id)) return;
      const message = error instanceof Error ? error.message : "Upload failed";
      if (message === "Operation aborted") {
        record.status = "cancelled";
        this.blobs.delete(id);
        this.retire(id);
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
    this.retire(id);
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
