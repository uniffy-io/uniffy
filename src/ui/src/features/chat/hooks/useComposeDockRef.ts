import { useCallback } from "react";

/**
 * Ref for a floating composer dock. Publishes the dock's live height (plus a
 * small gap) to its parent as `--chat-compose-reserve`, so the scrolling
 * content underneath can reserve that room and the last message stays
 * reachable. A ref callback rather than an effect: docks mount after early
 * returns in their views, with no state change an effect could key on.
 */
export function useComposeDockRef() {
  return useCallback((dock: HTMLDivElement | null) => {
    const stream = dock?.parentElement;
    if (!dock || !stream) return;
    const apply = () =>
      stream.style.setProperty("--chat-compose-reserve", `${dock.offsetHeight + 8}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      stream.style.removeProperty("--chat-compose-reserve");
    };
  }, []);
}
