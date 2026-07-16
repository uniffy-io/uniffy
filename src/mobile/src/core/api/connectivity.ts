import { AppState } from "react-native";
import { focusManager, onlineManager } from "@tanstack/react-query";

type NetInfoState = { isConnected: boolean | null };
type NetInfoModule = { addEventListener: (cb: (state: NetInfoState) => void) => () => void };

// NetInfo is a native module; a dev client built before it was added lacks the
// binary. Degrade to TanStack's always-online default instead of crashing.
function loadNetInfo(): NetInfoModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-community/netinfo") as { default: NetInfoModule };
    return mod.default ?? null;
  } catch {
    return null;
  }
}

const onlineListeners = new Set<(online: boolean) => void>();

/** Runs the callback when connectivity returns. No-op without NetInfo. */
export function addOnlineListener(callback: (online: boolean) => void): () => void {
  onlineListeners.add(callback);
  return () => onlineListeners.delete(callback);
}

/**
 * Feeds TanStack Query's focus and online managers from AppState and NetInfo
 * so foregrounding refetches stale queries and reconnects resume paused ones.
 * Called once at app start.
 */
export function installConnectivityHooks(): void {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (state) => {
      handleFocus(state === "active");
    });
    return () => subscription.remove();
  });

  const netInfo = loadNetInfo();
  if (!netInfo) return;
  try {
    netInfo.addEventListener((state) => {
      // Only a definitive false is offline: null means "unknown", and marking
      // unknown as offline would pause every query on startup.
      const online = state.isConnected !== false;
      onlineManager.setOnline(online);
      for (const listener of onlineListeners) listener(online);
    });
  } catch {
    // Stale dev client without the native module; stay always-online.
  }
}
