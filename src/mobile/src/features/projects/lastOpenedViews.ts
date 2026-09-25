import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "uniffy_project_views:";

/** Per user: project id to the view last opened in it. */
const byUser = new Map<string, Record<string, string>>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function load(userId: string): Promise<void> {
  if (byUser.has(userId) || loading.has(userId)) return;
  loading.add(userId);
  let stored: Record<string, string> = {};
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + userId);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, string>;
    }
  } catch {
    // Nothing remembered; the project default view opens.
  }
  loading.delete(userId);
  byUser.set(userId, { ...stored, ...byUser.get(userId) });
  notify();
}

export function rememberOpenedView(userId: string, projectId: string, viewId: string): void {
  const current = byUser.get(userId) ?? {};
  if (current[projectId] === viewId) return;
  const next = { ...current, [projectId]: viewId };
  byUser.set(userId, next);
  notify();
  void AsyncStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(next)).catch(() => {});
}

/**
 * `ready` stays false until the stored choice is read, so the screen does not open the default
 * view and then jump to the remembered one.
 */
export function useLastOpenedView(
  userId: string | undefined,
  projectId: string | undefined,
): { viewId: string | undefined; ready: boolean } {
  useEffect(() => {
    if (userId) void load(userId);
  }, [userId]);
  const views = useSyncExternalStore(
    subscribe,
    () => (userId ? byUser.get(userId) : undefined),
    () => (userId ? byUser.get(userId) : undefined),
  );
  return { viewId: projectId ? views?.[projectId] : undefined, ready: views !== undefined };
}
