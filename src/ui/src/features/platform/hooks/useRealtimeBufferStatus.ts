import { useState, useSyncExternalStore } from "react";
import type { RealtimeBufferStatus } from "@uniffy/proto/superadmin/v1/system_config_pb";
import { systemConfigApi } from "@/features/platform/api/systemConfigApi";

/** Operators watch the buffer for trends, so a slow poll keeps the read cheap. */
export const REALTIME_BUFFER_POLL_MS = 15_000;

export interface RealtimeBufferReading {
  status: RealtimeBufferStatus | null;
  /** The latest poll failed; `status` still holds the reading before it. */
  stale: boolean;
}

export interface RealtimeBufferPoll {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RealtimeBufferReading;
}

const NO_READING: RealtimeBufferReading = { status: null, stale: false };

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

/** Polls while subscribed and the tab is visible; the last unsubscribe drops the reading. */
export function createRealtimeBufferPoll(
  load: () => Promise<RealtimeBufferStatus | undefined>,
  intervalMs: number = REALTIME_BUFFER_POLL_MS,
): RealtimeBufferPoll {
  let reading = NO_READING;
  let timer: ReturnType<typeof setInterval> | null = null;
  // A reply that outlives its subscription never lands in a later one.
  let run = 0;
  const listeners = new Set<() => void>();

  const publish = (next: RealtimeBufferReading) => {
    reading = next;
    for (const listener of listeners) listener();
  };

  const poll = async () => {
    const current = run;
    try {
      const status = (await load()) ?? null;
      if (current === run) publish({ status, stale: false });
    } catch {
      if (current === run) publish({ status: reading.status, stale: true });
    }
  };

  const pollIfVisible = () => {
    if (!tabHidden()) void poll();
  };

  const start = () => {
    run += 1;
    void poll();
    timer = setInterval(pollIfVisible, intervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", pollIfVisible);
    }
  };

  const stop = () => {
    run += 1;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", pollIfVisible);
    }
    reading = NO_READING;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => reading,
  };
}

async function loadStatus(): Promise<RealtimeBufferStatus | undefined> {
  return (await systemConfigApi.getRealtimeBufferStatus()).status;
}

export function useRealtimeBufferStatus(): RealtimeBufferReading {
  const [poll] = useState(() => createRealtimeBufferPoll(loadStatus));
  return useSyncExternalStore(poll.subscribe, poll.getSnapshot);
}
