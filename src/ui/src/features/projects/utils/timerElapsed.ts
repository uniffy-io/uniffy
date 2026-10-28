import type { Timer } from "@/features/projects/types/time";

/** Finished segments plus the running one; a clock behind the server never counts backwards. */
export function timerElapsedSeconds(timer: Timer, nowMs: number): number {
  const running = timer.startedAt ? Math.floor((nowMs - Date.parse(timer.startedAt)) / 1000) : 0;
  return timer.accumulatedSeconds + Math.max(0, running);
}

/** Mirrors the server: half up to the increment, never below one increment. */
export function roundTimerMinutes(seconds: number, increment: number): number {
  const step = Math.max(1, increment);
  const units = Math.floor((Math.max(0, seconds) + (step * 60) / 2) / (step * 60));
  return Math.max(step, units * step);
}

/** h:mm:ss once an hour is reached, mm:ss before. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
