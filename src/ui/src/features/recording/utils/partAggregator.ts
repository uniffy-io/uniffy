/**
 * Aggregates MediaRecorder chunks into S3-legal multipart parts: every part except the final one
 * must be at least 5 MiB, so a part seals only once the buffer crosses that floor. Elapsed time
 * never seals a part; `snapshot()` exposes the pending buffer so the uploader can mirror it for
 * crash recovery without cutting an undersized part.
 */

const MIN_PART_SIZE = 5 * 1024 * 1024;

export interface AggregatorPart {
  data: Blob;
  size: number;
}

export class PartAggregator {
  private buffer: Blob[] = [];
  private bufferedBytes = 0;

  pushChunk(chunk: Blob): AggregatorPart | null {
    if (chunk.size === 0) return null;
    this.buffer.push(chunk);
    this.bufferedBytes += chunk.size;
    if (this.bufferedBytes >= MIN_PART_SIZE) {
      return this.seal();
    }
    return null;
  }

  finish(): AggregatorPart | null {
    if (this.bufferedBytes === 0) return null;
    return this.seal();
  }

  /** Pending bytes as one Blob without sealing them; null when nothing is buffered. */
  snapshot(): Blob | null {
    if (this.bufferedBytes === 0) return null;
    return new Blob(this.buffer);
  }

  bufferedSize(): number {
    return this.bufferedBytes;
  }

  private seal(): AggregatorPart {
    const data = new Blob(this.buffer);
    const size = this.bufferedBytes;
    this.buffer = [];
    this.bufferedBytes = 0;
    return { data, size };
  }
}
