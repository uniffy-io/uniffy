/**
 * Aggregates MediaRecorder chunks into S3-legal multipart parts (>= 5 MB except final).
 * Flushes when buffer crosses 5 MB or 45s soft-deadline; 100 MB hard ceiling caps memory.
 */

const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PART_SIZE = 100 * 1024 * 1024;
const SOFT_FLUSH_MS = 45_000;

export interface AggregatorPart {
  data: Blob;
  size: number;
}

export class PartAggregator {
  private buffer: Blob[] = [];
  private bufferedBytes = 0;
  private firstChunkAt: number | null = null;

  pushChunk(chunk: Blob): AggregatorPart | null {
    if (chunk.size === 0) return null;
    if (this.firstChunkAt === null) {
      this.firstChunkAt = Date.now();
    }
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.size;

    if (this.bufferedBytes >= MAX_PART_SIZE) {
      return this.flushUnsafe();
    }

    if (this.bufferedBytes >= MIN_PART_SIZE) {
      return this.flushUnsafe();
    }

    const elapsed = Date.now() - this.firstChunkAt;
    if (elapsed >= SOFT_FLUSH_MS && this.bufferedBytes > 0) {
      return this.flushUnsafe();
    }

    return null;
  }

  finish(): AggregatorPart | null {
    if (this.bufferedBytes === 0) return null;
    return this.flushUnsafe();
  }

  bufferedSize(): number {
    return this.bufferedBytes;
  }

  private flushUnsafe(): AggregatorPart {
    const data = new Blob(this.buffer);
    const size = this.bufferedBytes;
    this.buffer = [];
    this.bufferedBytes = 0;
    this.firstChunkAt = null;
    return { data, size };
  }
}
