import { useEffect } from "react";
import { isDocumentVisible } from "@/shared/utils/documentVisibility";

/** Coming back fires focus and visibilitychange together; one refresh answers both. */
const RETURN_COALESCE_MS = 1_000;

/** Calls `refresh` each time the user comes back to this tab or window. Returns the unsubscribe. */
export function listenForReturn(refresh: () => void): () => void {
  let lastRefresh = Number.NEGATIVE_INFINITY;
  const onReturn = () => {
    if (!isDocumentVisible()) return;
    const now = Date.now();
    if (now - lastRefresh < RETURN_COALESCE_MS) return;
    lastRefresh = now;
    refresh();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  return () => {
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}

/**
 * Reloads data that other sessions and other people change with no push to this tab, whenever the
 * user comes back to it. Pass a stable `refresh`; a new one resubscribes.
 */
export function useRefreshOnReturn(refresh: () => void, enabled = true): void {
  useEffect(() => (enabled ? listenForReturn(refresh) : undefined), [enabled, refresh]);
}
