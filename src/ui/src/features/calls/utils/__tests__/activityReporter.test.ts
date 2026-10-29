import { afterEach, describe, expect, it, vi } from "vitest";
import { startActivityReporter, type ActivityChunk } from "@/features/calls/utils/activityReporter";

const ticks = (chunks: ActivityChunk[], field: "observedMask" | "speakingMask") =>
  chunks.flatMap((chunk) =>
    Array.from({ length: 30 }, (_, bit) =>
      chunk[field] & (1 << bit) ? chunk.offsetSeconds + bit : -1,
    ).filter((second) => second >= 0),
  );

afterEach(() => vi.useRealTimers());

describe("call activity reporter", () => {
  it("uses server elapsed time, reports silence, and skips disconnected time", async () => {
    vi.useFakeTimers();
    let clock = 0;
    let connected = true;
    let speaking = true;
    const report = vi.fn(async () => ({ participantId: "attendance", elapsedSeconds: 42 }));
    const stop = startActivityReporter({
      report,
      now: () => clock,
      sample: () => ({ connected, speaking }),
    });
    await Promise.resolve();
    clock = 1000;
    speaking = false;
    await vi.advanceTimersByTimeAsync(1000);
    clock = 2000;
    connected = false;
    await vi.advanceTimersByTimeAsync(1000);
    clock = 15000;
    connected = true;
    await vi.advanceTimersByTimeAsync(13000);
    const [id, chunks] = report.mock.calls.at(-1)! as unknown as [string, ActivityChunk[]];
    expect(id).toBe("attendance");
    expect(ticks(chunks, "observedMask")).toEqual([42, 43, 57]);
    expect(ticks(chunks, "speakingMask")).toEqual([42]);
    stop();
  });

  it("keeps retries bounded and never fills suspended gaps", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const report = vi.fn(async (id: string, _chunks: ActivityChunk[]) => {
      if (id) throw new Error("offline");
      return { participantId: "attendance", elapsedSeconds: 10 };
    });
    const stop = startActivityReporter({
      report,
      now: () => clock,
      sample: () => ({ connected: true, speaking: true }),
    });
    await Promise.resolve();
    clock = 300000;
    await vi.advanceTimersByTimeAsync(15000);
    const chunks = report.mock.calls.at(-1)![1];
    expect(ticks(chunks, "observedMask")).toEqual([310]);
    expect(chunks.length).toBeLessThanOrEqual(8);
    stop();
    const count = report.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(report.mock.calls.length).toBe(count);
  });

  it("does not start after disposal during bootstrap", async () => {
    vi.useFakeTimers();
    let resolve!: (reply: { participantId: string; elapsedSeconds: number }) => void;
    const report = vi.fn(
      () =>
        new Promise<{ participantId: string; elapsedSeconds: number }>((r) => {
          resolve = r;
        }),
    );
    const stop = startActivityReporter({
      report,
      sample: () => ({ connected: true, speaking: true }),
    });
    stop();
    resolve({ participantId: "attendance", elapsedSeconds: 10 });
    await vi.advanceTimersByTimeAsync(30000);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("flushes trailing observations after an in-flight report completes", async () => {
    vi.useFakeTimers();
    let clock = 0;
    let finish!: () => void;
    let count = 0;
    const report = vi.fn(async (_id: string, _chunks: ActivityChunk[]) => {
      count++;
      if (count === 2)
        await new Promise<void>((r) => {
          finish = r;
        });
      return { participantId: "attendance", elapsedSeconds: 0 };
    });
    const stop = startActivityReporter({
      report,
      now: () => clock,
      sample: () => ({ connected: true, speaking: true }),
    });
    await Promise.resolve();
    clock = 15000;
    await vi.advanceTimersByTimeAsync(15000);
    clock = 16000;
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledTimes(3);
    expect(ticks(report.mock.calls[2][1], "speakingMask")).toContain(16);
  });
});
