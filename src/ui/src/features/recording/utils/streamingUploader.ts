/**
 * Streaming multipart uploader. Parts (>=5MB) upload with max 2 concurrent + exponential backoff.
 * Each part is mirrored to IndexedDB before send for tab-crash recovery; queue-depth governor
 * fires `onBackpressure` so the slice can banner and auto-stop on overflow.
 */

import { filesApi } from "@/features/files/api/filesApi";
import { PartAggregator } from "@/features/recording/utils/partAggregator";
import { clearUploadChunks, deleteChunk, putChunk } from "@/features/files/upload/uploadStore";
import {
  classifyBacklog,
  type BackpressureLevel,
} from "@/features/recording/utils/uploadBackpressure";

const MAX_CONCURRENCY = 2;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export interface StreamingUploaderConfig {
  organizationId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  onProgress: (info: { queued: number; uploaded: number }) => void;
  onAuthLost: () => void;
  onBackpressure?: (level: BackpressureLevel) => void;
}

interface PendingPart {
  partNumber: number;
  data: Blob;
  attempts: number;
}

export class StreamingUploader {
  private uploadId: string | null = null;
  private nextPartNumber = 1;
  private aggregator = new PartAggregator();
  private queue: PendingPart[] = [];
  private inFlight = 0;
  private bytesQueued = 0;
  private bytesUploaded = 0;
  private finishing = false;
  private finishResolver: ((value: void) => void) | null = null;
  private finishRejecter: ((reason: Error) => void) | null = null;
  private terminalError: Error | null = null;
  private backpressureLevel: BackpressureLevel = "normal";
  private readonly config: StreamingUploaderConfig;

  constructor(config: StreamingUploaderConfig) {
    this.config = config;
  }

  async start(): Promise<string> {
    const response = await filesApi.initiateUpload({
      organizationId: this.config.organizationId,
      filename: this.config.filename,
      mimeType: this.config.mimeType,
      totalSize: BigInt(0),
      folderId: this.config.folderId ?? undefined,
    });
    this.uploadId = response.uploadId;
    return this.uploadId;
  }

  pushChunk(blob: Blob): void {
    if (this.terminalError) return;
    const part = this.aggregator.pushChunk(blob);
    if (part) {
      this.enqueuePart(part.data, part.size);
    }
    this.emitProgress();
  }

  async finish(): Promise<{ fileId: string; filename: string }> {
    if (!this.uploadId) {
      throw new Error("Uploader not started");
    }
    this.finishing = true;
    const tail = this.aggregator.finish();
    if (tail) {
      this.enqueuePart(tail.data, tail.size);
    }
    if (this.queue.length > 0 || this.inFlight > 0) {
      await new Promise<void>((resolve, reject) => {
        this.finishResolver = resolve;
        this.finishRejecter = reject;
      });
    }
    if (this.terminalError) {
      throw this.terminalError;
    }
    const completion = await filesApi.completeUpload({
      uploadId: this.uploadId,
    });
    if (!completion.file) {
      throw new Error("Server did not return a File on completeUpload");
    }
    // Server has it; drop client-side recovery rows so they don't haunt the next session.
    void clearUploadChunks(this.uploadId);
    return {
      fileId: completion.file.id,
      filename: completion.file.filename,
    };
  }

  async cancel(): Promise<void> {
    this.terminalError = new Error("Cancelled");
    this.queue = [];
    if (this.uploadId) {
      try {
        await filesApi.abortUpload({ uploadId: this.uploadId });
      } catch {
        // best-effort; the reaper will GC if abort fails
      }
      void clearUploadChunks(this.uploadId);
    }
  }

  getUploadId(): string | null {
    return this.uploadId;
  }

  private enqueuePart(data: Blob, size: number): void {
    const partNumber = this.nextPartNumber++;
    this.queue.push({ partNumber, data, attempts: 0 });
    this.bytesQueued += size;
    if (this.uploadId) {
      // Persist before send; in-memory-only fallback when IDB is unavailable.
      void putChunk(this.uploadId, partNumber, data);
    }
    this.evaluateBackpressure();
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_CONCURRENCY && this.queue.length > 0) {
      const part = this.queue.shift();
      if (!part) break;
      this.inFlight += 1;
      void this.uploadPart(part);
    }
    if (this.finishing && this.queue.length === 0 && this.inFlight === 0 && this.finishResolver) {
      this.finishResolver();
      this.finishResolver = null;
      this.finishRejecter = null;
    }
  }

  private async uploadPart(part: PendingPart): Promise<void> {
    if (!this.uploadId) {
      this.fail(new Error("Uploader not started"));
      return;
    }
    try {
      const buffer = new Uint8Array(await part.data.arrayBuffer());
      await filesApi.uploadChunk({
        uploadId: this.uploadId,
        chunkNumber: part.partNumber,
        data: buffer,
        isLast: false,
      });
      this.bytesUploaded += part.data.size;
      void deleteChunk(this.uploadId, part.partNumber);
      this.emitProgress();
      this.evaluateBackpressure();
      this.inFlight -= 1;
      this.pump();
    } catch (err) {
      this.inFlight -= 1;
      const error = err as { code?: string; message?: string };
      const isAuth =
        error?.code === "unauthenticated" ||
        /\b401\b|\bunauthenticated\b/i.test(error?.message ?? "");
      if (isAuth) {
        this.config.onAuthLost();
        this.queue.unshift(part);
        this.pump();
        return;
      }
      const isTerminal =
        error?.code === "failed_precondition" ||
        error?.code === "permission_denied" ||
        error?.code === "not_found";
      if (isTerminal || part.attempts + 1 >= MAX_ATTEMPTS) {
        this.fail(new Error(error?.message ?? "Upload failed"));
        return;
      }
      const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** part.attempts);
      const jitter = Math.floor(Math.random() * 250);
      setTimeout(() => {
        this.queue.unshift({ ...part, attempts: part.attempts + 1 });
        this.pump();
      }, backoff + jitter);
    }
  }

  private evaluateBackpressure(): void {
    if (!this.config.onBackpressure) return;
    const backlog = Math.max(0, this.bytesQueued - this.bytesUploaded);
    const next = classifyBacklog(backlog, this.backpressureLevel);
    if (next !== this.backpressureLevel) {
      this.backpressureLevel = next;
      this.config.onBackpressure(next);
    }
  }

  private fail(err: Error): void {
    if (this.terminalError) return;
    this.terminalError = err;
    if (this.finishRejecter) {
      this.finishRejecter(err);
      this.finishRejecter = null;
      this.finishResolver = null;
    }
  }

  private emitProgress(): void {
    this.config.onProgress({
      queued: this.bytesQueued,
      uploaded: this.bytesUploaded,
    });
  }
}
