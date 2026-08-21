import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const LAYOUT_KEY = "uniffy_chat_layout";

/**
 * How a transcript arranges its messages. "compact" is the single column every
 * sender shares; "bubbles" pulls the reader's own messages to the right.
 */
export type ChatLayout = "compact" | "bubbles";

// Held in a module store rather than per-hook state because the preference is
// changed on one screen and read on another that is still mounted behind it -
// a plain useState copy in each consumer would leave the transcript on the old
// layout until it remounted.
let layout: ChatLayout = "compact";
let loaded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ChatLayout {
  return layout;
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const stored = await AsyncStorage.getItem(LAYOUT_KEY);
    if (stored === "bubbles" || stored === "compact") {
      layout = stored;
      for (const listener of listeners) listener();
    }
  } catch {
    // Preference survives only the session; the default still applies.
  }
}

export function setChatLayout(next: ChatLayout): void {
  if (next === layout) return;
  layout = next;
  for (const listener of listeners) listener();
  void AsyncStorage.setItem(LAYOUT_KEY, next).catch(() => {});
}

export function useChatLayout(): ChatLayout {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
