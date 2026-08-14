import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingHysteresis } from "@/features/realtime/pendingHysteresis";

const DELAY = 1000;
const MIN_VISIBLE = 500;

describe("createPendingHysteresis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet while pending flips faster than the delay", () => {
    const changes: boolean[] = [];
    const h = createPendingHysteresis((v) => changes.push(v), DELAY, MIN_VISIBLE);

    for (let i = 0; i < 20; i += 1) {
      h.setPending(true);
      vi.advanceTimersByTime(250);
      h.setPending(false);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(DELAY * 2);

    expect(changes).toEqual([]);
    h.destroy();
  });

  it("surfaces a backlog that outlives the delay", () => {
    const changes: boolean[] = [];
    const h = createPendingHysteresis((v) => changes.push(v), DELAY, MIN_VISIBLE);

    h.setPending(true);
    vi.advanceTimersByTime(DELAY - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);

    h.destroy();
  });

  it("holds visible for the minimum window after the backlog clears", () => {
    const changes: boolean[] = [];
    const h = createPendingHysteresis((v) => changes.push(v), DELAY, MIN_VISIBLE);

    h.setPending(true);
    vi.advanceTimersByTime(DELAY);
    h.setPending(false);
    vi.advanceTimersByTime(MIN_VISIBLE - 1);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);

    h.destroy();
  });

  it("keeps showing when the backlog returns inside the minimum window", () => {
    const changes: boolean[] = [];
    const h = createPendingHysteresis((v) => changes.push(v), DELAY, MIN_VISIBLE);

    h.setPending(true);
    vi.advanceTimersByTime(DELAY);
    h.setPending(false);
    vi.advanceTimersByTime(MIN_VISIBLE / 2);
    h.setPending(true);
    vi.advanceTimersByTime(DELAY * 2);

    expect(changes).toEqual([true]);
    h.destroy();
  });

  it("emits nothing after destroy", () => {
    const changes: boolean[] = [];
    const h = createPendingHysteresis((v) => changes.push(v), DELAY, MIN_VISIBLE);

    h.setPending(true);
    h.destroy();
    vi.advanceTimersByTime(DELAY * 2);

    expect(changes).toEqual([]);
  });
});
