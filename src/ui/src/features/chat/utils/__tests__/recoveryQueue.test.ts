import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryQueue, StreamPosition } from "@/features/chat/utils/recoveryQueue";

const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("stream continuity", () => {
  it("detects missing events, duplicate frames and subscription replacement", () => {
    const position = new StreamPosition();
    expect(position.observe("a", 1n)).toBe("new");
    expect(position.observe("a", 2n)).toBe("next");
    expect(position.observe("a", 2n)).toBe("duplicate");
    expect(position.observe("a", 1n)).toBe("duplicate");
    expect(position.observe("a", 4n)).toBe("gap");
    expect(position.observe("a", 5n)).toBe("next");
    expect(position.observe("b", 1n)).toBe("new");
  });
});
describe("snapshot recovery", () => {
  let queue: RecoveryQueue;
  beforeEach(() => {
    vi.useFakeTimers();
    queue = new RecoveryQueue(() => true);
  });
  afterEach(() => {
    queue.stop();
    vi.useRealTimers();
  });
  it("caps concurrent reads and coalesces repeated gaps", async () => {
    const pending = Array.from({ length: 5 }, () => deferred<() => void>());
    const loads = pending.map((item) => vi.fn(() => item.promise));
    loads.forEach((load, i) => queue.request(String(i), load));
    expect(loads.map((load) => load.mock.calls.length)).toEqual([1, 1, 1, 0, 0]);
    queue.request("0", loads[0]);
    const stale = vi.fn();
    pending[0].resolve(stale);
    await drain();
    expect(stale).not.toHaveBeenCalled();
    expect(loads[3]).toHaveBeenCalledOnce();
  });
  it("rejects a snapshot crossed by a live edit and retries", async () => {
    const pending = deferred<() => void>();
    const stale = vi.fn();
    const fresh = vi.fn();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(fresh);
    queue.request("messages", load);
    queue.changed("messages");
    pending.resolve(stale);
    await drain();
    expect(stale).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fresh).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
    queue.changed("messages");
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("retries local state conflicts and transient failures", async () => {
    const apply = vi.fn().mockReturnValueOnce(false).mockReturnValue(undefined);
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(apply);
    queue.request("drafts", load);
    await vi.advanceTimersByTimeAsync(3000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it("drops late snapshots after disconnect", async () => {
    const pending = deferred<() => void>();
    const apply = vi.fn();
    queue.request("channel", () => pending.promise);
    queue.stop();
    pending.resolve(apply);
    await drain();
    expect(apply).not.toHaveBeenCalled();
  });
  it("drops late snapshots after tenant or session change", async () => {
    let current = true;
    queue.stop();
    queue = new RecoveryQueue(() => current);
    const pending = deferred<() => void>();
    const apply = vi.fn();
    queue.request("channel", () => pending.promise);
    current = false;
    pending.resolve(apply);
    await drain();
    expect(apply).not.toHaveBeenCalled();
  });
});
