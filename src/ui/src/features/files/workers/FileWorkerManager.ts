import type {
  WorkerRequest,
  WorkerResponse,
  UploadProgress,
  CompressZipProgress,
  ZipFileEntry,
} from "@/features/files/workers/types";

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // crypto.randomUUID is unavailable on non-HTTPS dev origins.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface UploadOptions {
  file: Blob;
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  apiUrl: string;
  onProgress?: (uploadedChunks: number, uploadedBytes: number) => void;
  /** Caller-owned id so the upload can be aborted later via abort(operationId). */
  operationId?: string;
  /** Part numbers already stored server-side; skipped when resuming. */
  completedChunks?: number[];
}

interface CompressOptions {
  files: ZipFileEntry[];
  compressionLevel?: number;
  onProgress?: (current: number, total: number) => void;
}

interface PendingOperation {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (a: number, b: number) => void;
  workerIndex: number;
}

type TokenGetter = () => string | null;
type TokenRefresher = () => Promise<string | null>;

export class FileWorkerManager {
  private workers: Worker[] = [];
  private workerCount: number;
  private pendingOperations = new Map<string, PendingOperation>();
  private nextWorkerIndex = 0;
  private initialized = false;

  private getToken: TokenGetter = () => null;
  private refreshToken: TokenRefresher = async () => null;

  constructor() {
    // Clamp pool size to 2-4 regardless of hardwareConcurrency.
    this.workerCount = Math.min(Math.max(navigator.hardwareConcurrency || 2, 2), 4);
  }

  init(getToken: TokenGetter, refreshToken: TokenRefresher): void {
    if (this.initialized) return;

    this.getToken = getToken;
    this.refreshToken = refreshToken;
    this.initWorkers();
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private initWorkers(): void {
    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(new URL("./FileWorker.worker.ts", import.meta.url), {
        type: "module",
      });

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.handleMessage(e.data, i);
      };

      worker.onerror = (e) => {
        console.error("[FileWorkerManager] Worker error:", e);
      };

      this.workers.push(worker);
    }
  }

  private getNextWorker(): { worker: Worker; index: number } {
    const index = this.nextWorkerIndex;
    const worker = this.workers[index];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workerCount;
    return { worker, index };
  }

  private async handleMessage(response: WorkerResponse, workerIndex: number): Promise<void> {
    if (response.type === "UPLOAD_PROGRESS") {
      const op = this.pendingOperations.get(response.id);
      const progress = response as UploadProgress;
      op?.onProgress?.(progress.uploadedChunks, progress.uploadedBytes);
      return;
    }

    if (response.type === "COMPRESS_ZIP_PROGRESS") {
      const op = this.pendingOperations.get(response.id);
      const progress = response as CompressZipProgress;
      op?.onProgress?.(progress.fileIndex, progress.totalFiles);
      return;
    }

    if (response.type === "TOKEN_NEEDED") {
      const newToken = await this.refreshToken();
      if (newToken) {
        this.workers[workerIndex].postMessage({
          type: "TOKEN_REFRESH",
          id: response.id,
          token: newToken,
        });
      } else {
        const op = this.pendingOperations.get(response.id);
        if (op) {
          op.reject(new Error("Authentication failed: could not refresh token"));
          this.pendingOperations.delete(response.id);
        }
      }
      return;
    }

    const op = this.pendingOperations.get(response.id);
    if (!op) return;

    this.pendingOperations.delete(response.id);

    if (response.type === "ERROR") {
      op.reject(new Error(response.error));
      return;
    }

    switch (response.type) {
      case "UPLOAD_COMPLETE":
        op.resolve(undefined);
        break;
      case "COMPRESS_ZIP_RESULT":
        op.resolve(response.zipData);
        break;
      case "CONCAT_CHUNKS_RESULT":
        op.resolve(response.data);
        break;
    }
  }

  private sendRequest<T>(
    request: WorkerRequest,
    transfer?: Transferable[],
    onProgress?: (a: number, b: number) => void,
  ): Promise<T> {
    if (!this.initialized) {
      return Promise.reject(new Error("FileWorkerManager not initialized. Call init() first."));
    }

    return new Promise((resolve, reject) => {
      const { worker, index } = this.getNextWorker();

      this.pendingOperations.set(request.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
        workerIndex: index,
      });

      if (transfer) {
        worker.postMessage(request, transfer);
      } else {
        worker.postMessage(request);
      }
    });
  }

  async uploadChunks(options: UploadOptions): Promise<void> {
    const {
      file,
      uploadId,
      chunkSize,
      totalChunks,
      apiUrl,
      onProgress,
      operationId,
      completedChunks,
    } = options;

    const token = this.getToken();
    if (!token) {
      throw new Error("No access token available");
    }

    const id = operationId ?? generateId();

    return this.sendRequest<void>(
      {
        type: "UPLOAD_CHUNKS",
        id,
        file,
        uploadId,
        chunkSize,
        totalChunks,
        token,
        apiUrl,
        completedChunks,
      },
      undefined,
      onProgress,
    );
  }

  async compressZip(options: CompressOptions): Promise<ArrayBuffer> {
    const { files, compressionLevel = 6, onProgress } = options;

    const id = generateId();

    // Transfer file data buffers zero-copy.
    const transferables = files.map((f) => f.data);

    return this.sendRequest<ArrayBuffer>(
      {
        type: "COMPRESS_ZIP",
        id,
        files,
        compressionLevel,
      },
      transferables,
      onProgress,
    );
  }

  async concatChunks(chunks: ArrayBuffer[], mimeType: string): Promise<ArrayBuffer> {
    const id = generateId();

    return this.sendRequest<ArrayBuffer>(
      {
        type: "CONCAT_CHUNKS",
        id,
        chunks,
        mimeType,
      },
      chunks,
    );
  }

  abort(operationId: string): void {
    for (const worker of this.workers) {
      worker.postMessage({ type: "ABORT", id: operationId });
    }

    const op = this.pendingOperations.get(operationId);
    if (op) {
      op.reject(new Error("Operation aborted"));
      this.pendingOperations.delete(operationId);
    }
  }

  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pendingOperations.clear();
    this.initialized = false;
  }
}

export const fileWorkerManager = new FileWorkerManager();
