/**
 * Streaming uploader for screen recordings.
 *
 * Drives a multipart upload during recording: each `MediaRecorder.ondataavailable`
 * blob is fed into a `PartAggregator` that emits S3-legal parts (>= 5 MB except
 * the last). Parts upload concurrently (max 2 in-flight) with exponential
 * backoff retries on 5xx / network errors; the recording itself never blocks
 * on the upload queue.
 *
 * Production-hardening hooks:
 * - Each part is mirrored to IndexedDB before upload and removed on ack so a
 *   tab crash mid-record leaves the bytes recoverable against the same
 *   `MultipartUpload` row (24h server-side TTL).
 * - A queue-depth governor classifies the backlog into normal / slow /
 *   falling-behind / auto-stop and fires `onBackpressure` so the slice can
 *   surface a banner and the thunk can auto-stop on overflow.
 *
 * Threading: measured main-thread cost on a 5 MB / 5 s cadence
 * (`Blob.slice` is metadata-only, `Blob.arrayBuffer()` is async-yielded
 * by the browser, ConnectRPC's protobuf encoding for an
 * `UploadChunksRequest` is sub-millisecond at this size); jank is not
 * observable on Chrome / Brave. Worker form is held in reserve for a
 * profiler-driven follow-up if the recording UI ever shows frame drops
 * during upload bursts.
 */

import { filesApi } from '@/features/files/api/filesApi';
import { PartAggregator } from '@/features/recording/utils/partAggregator';
import {
    clearUpload,
    deleteChunk,
    putChunk,
} from '@/features/recording/utils/recordingChunkStore';
import {
    classifyBacklog,
    type BackpressureLevel,
} from '@/features/recording/utils/uploadBackpressure';

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
    private backpressureLevel: BackpressureLevel = 'normal';
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
            throw new Error('Uploader not started');
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
            throw new Error('Server did not return a File on completeUpload');
        }
        // Recording is durable on the server; drop any stragglers from the
        // client-side recovery store so they do not haunt the next session.
        void clearUpload(this.uploadId);
        return {
            fileId: completion.file.id,
            filename: completion.file.filename,
        };
    }

    async cancel(): Promise<void> {
        this.terminalError = new Error('Cancelled');
        this.queue = [];
        if (this.uploadId) {
            try {
                await filesApi.abortUpload({ uploadId: this.uploadId });
            } catch {
                // best-effort; the reaper will GC if abort fails
            }
            void clearUpload(this.uploadId);
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
            // Persist before send. If IndexedDB is unavailable (private mode,
            // quota), `putChunk` returns false and we silently fall back to
            // in-memory only. The upload itself proceeds either way.
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
        if (
            this.finishing &&
            this.queue.length === 0 &&
            this.inFlight === 0 &&
            this.finishResolver
        ) {
            this.finishResolver();
            this.finishResolver = null;
            this.finishRejecter = null;
        }
    }

    private async uploadPart(part: PendingPart): Promise<void> {
        if (!this.uploadId) {
            this.fail(new Error('Uploader not started'));
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
                error?.code === 'unauthenticated' ||
                /\b401\b|\bunauthenticated\b/i.test(error?.message ?? '');
            if (isAuth) {
                this.config.onAuthLost();
                this.queue.unshift(part);
                this.pump();
                return;
            }
            const isTerminal =
                error?.code === 'failed_precondition' ||
                error?.code === 'permission_denied' ||
                error?.code === 'not_found';
            if (isTerminal || part.attempts + 1 >= MAX_ATTEMPTS) {
                this.fail(new Error(error?.message ?? 'Upload failed'));
                return;
            }
            const backoff = Math.min(
                MAX_BACKOFF_MS,
                BASE_BACKOFF_MS * 2 ** part.attempts,
            );
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
