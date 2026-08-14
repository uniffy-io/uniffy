import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PartAggregator } from "../utils/partAggregator";

const ONE_MB = 1024 * 1024;
const FIVE_MB = 5 * ONE_MB;

function blob(sizeBytes: number): Blob {
  return new Blob([new Uint8Array(sizeBytes)]);
}

describe("PartAggregator", () => {
  let aggregator: PartAggregator;

  beforeEach(() => {
    aggregator = new PartAggregator();
  });

  it("returns null for chunks below the 5 MB floor", () => {
    const result = aggregator.pushChunk(blob(ONE_MB));
    expect(result).toBeNull();
    expect(aggregator.bufferedSize()).toBe(ONE_MB);
  });

  it("emits a part when buffered bytes cross the 5 MB floor", () => {
    aggregator.pushChunk(blob(2 * ONE_MB));
    aggregator.pushChunk(blob(2 * ONE_MB));
    const result = aggregator.pushChunk(blob(2 * ONE_MB));
    expect(result).not.toBeNull();
    expect(result!.size).toBeGreaterThanOrEqual(FIVE_MB);
    expect(aggregator.bufferedSize()).toBe(0);
  });

  it("finish() returns the trailing buffered bytes regardless of size", () => {
    aggregator.pushChunk(blob(ONE_MB));
    const tail = aggregator.finish();
    expect(tail).not.toBeNull();
    expect(tail!.size).toBe(ONE_MB);
  });

  it("finish() returns null when nothing is buffered", () => {
    expect(aggregator.finish()).toBeNull();
  });

  it("drops zero-size chunks", () => {
    const result = aggregator.pushChunk(blob(0));
    expect(result).toBeNull();
    expect(aggregator.bufferedSize()).toBe(0);
  });

  describe("soft flush deadline", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-09T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("flushes after 45 s even when the buffer is below the 5 MB floor", () => {
      aggregator.pushChunk(blob(ONE_MB));
      vi.setSystemTime(new Date("2026-05-09T12:00:45Z"));
      const result = aggregator.pushChunk(blob(ONE_MB));
      expect(result).not.toBeNull();
      expect(result!.size).toBe(2 * ONE_MB);
    });
  });
});
