// Raw outbound-pending goes true on nearly every keystroke (the socket reports
// a non-zero bufferedAmount right after send) and clears one drain poll later,
// so a status label bound straight to it strobes while the user types. Only a
// backlog that survives DELAY_MS is worth surfacing, and once surfaced it holds
// for MIN_VISIBLE_MS so the label cannot flicker back on the very next drain.
export const SYNCING_VISIBLE_DELAY_MS = 1200;
export const SYNCING_MIN_VISIBLE_MS = 800;

export interface PendingHysteresis {
  setPending(pending: boolean): void;
  destroy(): void;
}

export function createPendingHysteresis(
  onChange: (visible: boolean) => void,
  delayMs: number = SYNCING_VISIBLE_DELAY_MS,
  minVisibleMs: number = SYNCING_MIN_VISIBLE_MS,
): PendingHysteresis {
  let pending = false;
  let visible = false;
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const show = (): void => {
    timer = null;
    visible = true;
    shownAt = Date.now();
    onChange(true);
  };

  const hide = (): void => {
    timer = null;
    visible = false;
    onChange(false);
  };

  return {
    setPending(next: boolean): void {
      if (next === pending) return;
      pending = next;
      clearTimer();
      if (next) {
        // Already visible means we were inside the min-visible window; the
        // backlog came back, so just keep showing it.
        if (visible) return;
        timer = setTimeout(show, delayMs);
        return;
      }
      if (!visible) return;
      const remaining = Math.max(0, minVisibleMs - (Date.now() - shownAt));
      timer = setTimeout(hide, remaining);
    },
    destroy(): void {
      clearTimer();
    },
  };
}
