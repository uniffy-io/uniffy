import { useSyncExternalStore } from "react";
import type { Timer } from "@/features/projects/types/time";
import { timerElapsedSeconds } from "@/features/projects/utils/timerElapsed";

// One shared second ticker for every mounted clock; it runs only while someone listens.
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  interval ??= setInterval(() => listeners.forEach((fn) => fn()), 1000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const frozen = () => 0;
const subscribeNever = () => () => {};

/** Elapsed seconds of a timer, ticking once a second while it runs and frozen while paused. */
export function useTimerElapsed(timer: Timer | null): number {
  const running = Boolean(timer?.startedAt);
  const nowSec = useSyncExternalStore(
    running ? subscribe : subscribeNever,
    running ? nowSeconds : frozen,
    frozen,
  );
  if (!timer) return 0;
  return timerElapsedSeconds(timer, running ? nowSec * 1000 : 0);
}
