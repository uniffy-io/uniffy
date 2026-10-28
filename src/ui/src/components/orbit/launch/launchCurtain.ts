import { useSyncExternalStore } from "react";

export interface CurtainOrigin {
  x: number;
  y: number;
}

/** Hold on the flare, then the slow open; the keyframes in launchCurtain.css share this length. */
const CURTAIN_MS = 1700;
/** The orbit folds into its hub for this long before the curtain takes over from the flare. */
const COLLAPSE_MS = 480;
const ARRIVING_ATTRIBUTE = "data-orbit-arriving";

let origin: CurtainOrigin | null = null;
let closeTimer = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function close() {
  origin = null;
  document.documentElement.removeAttribute(ARRIVING_ATTRIBUTE);
  emit();
}

function openLaunchCurtain(next: CurtainOrigin) {
  window.clearTimeout(closeTimer);
  origin = next;
  const root = document.documentElement;
  root.style.setProperty("--orbit-x", `${next.x}px`);
  root.style.setProperty("--orbit-y", `${next.y}px`);
  root.setAttribute(ARRIVING_ATTRIBUTE, "");
  emit();
  closeTimer = window.setTimeout(close, CURTAIN_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLaunchCurtain(): CurtainOrigin | null {
  return useSyncExternalStore(subscribe, () => origin);
}

/**
 * Plays the hand-off from an orbit page into the app: the caller has already flagged its orbit
 * as launching, this waits out the collapse and opens the curtain from the orbit's center.
 * Navigate once it resolves. Reduced motion resolves at once and skips the curtain.
 */
export async function enterThroughPortal(orbit: HTMLElement | null): Promise<void> {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  await new Promise((resolve) => window.setTimeout(resolve, COLLAPSE_MS));
  const rect = orbit?.getBoundingClientRect();
  openLaunchCurtain(
    rect && rect.width > 0
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  );
}
