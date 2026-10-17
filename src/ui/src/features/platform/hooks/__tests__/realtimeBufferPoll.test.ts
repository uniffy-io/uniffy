import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeBufferStatusSchema,
  type RealtimeBufferStatus,
} from "@uniffy/proto/superadmin/v1/system_config_pb";
import { createRealtimeBufferPoll } from "@/features/platform/hooks/useRealtimeBufferStatus";

const INTERVAL_MS = 1_000;

function reading(pendingRecords: bigint): RealtimeBufferStatus {
  return create(RealtimeBufferStatusSchema, { totals: { pendingRecords } });
}

function records(poll: ReturnType<typeof createRealtimeBufferPoll>): bigint | undefined {
  return poll.getSnapshot().status?.totals?.pendingRecords;
}

/** Answers each poll with the next scripted reply; an Error rejects that poll. */
function scripted(...replies: (RealtimeBufferStatus | Error)[]) {
  return async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("realtime buffer poll", () => {
  it("reads at once on subscribe and again each interval", async () => {
    const poll = createRealtimeBufferPoll(scripted(reading(1n), reading(2n)), INTERVAL_MS);
    const seen: (bigint | undefined)[] = [];

    const unsubscribe = poll.subscribe(() => seen.push(records(poll)));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(seen).toEqual([1n, 2n]);
    unsubscribe();
  });

  it("keeps the earlier reading and marks it stale while polls fail", async () => {
    const poll = createRealtimeBufferPoll(
      scripted(reading(1n), new Error("unavailable"), reading(3n)),
      INTERVAL_MS,
    );

    const unsubscribe = poll.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    const failed = poll.getSnapshot();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(failed.stale).toBe(true);
    expect(failed.status?.totals?.pendingRecords).toBe(1n);
    expect(poll.getSnapshot().stale).toBe(false);
    expect(records(poll)).toBe(3n);
    unsubscribe();
  });

  it("forgets the reading and drops a late reply after the last unsubscribe", async () => {
    let answer: (status: RealtimeBufferStatus) => void = () => {};
    const poll = createRealtimeBufferPoll(
      () => new Promise<RealtimeBufferStatus>((resolve) => (answer = resolve)),
      INTERVAL_MS,
    );

    const unsubscribe = poll.subscribe(() => {});
    unsubscribe();
    answer(reading(4n));
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(poll.getSnapshot()).toEqual({ status: null, stale: false });
  });

  it("stops reading once nothing subscribes", async () => {
    const poll = createRealtimeBufferPoll(scripted(reading(1n), reading(2n)), INTERVAL_MS);

    const unsubscribe = poll.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    const resubscribe = poll.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // The next subscription gets the reply the stopped poll never asked for.
    expect(records(poll)).toBe(2n);
    resubscribe();
  });
});
