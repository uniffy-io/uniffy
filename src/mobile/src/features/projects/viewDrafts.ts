import { useCallback, useSyncExternalStore } from "react";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";

/**
 * Unsaved view edits, held for the app session so opening a task and coming back, or leaving the
 * project for a while, keeps them; only Discard or a save drops one. Keys carry the user and the
 * organization, so an edit never shows up for another account signed in on the same device.
 */
const drafts = new Map<string, ViewDefinition>();
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

export interface DraftScope {
  userId: string;
  organizationId: string;
  projectId: string;
}

function draftKey(scope: DraftScope, viewId: string): string {
  return `${scope.userId}:${scope.organizationId}:${scope.projectId}:${viewId}`;
}

export function setViewDraft(
  scope: DraftScope,
  viewId: string,
  definition: ViewDefinition | null,
): void {
  const key = draftKey(scope, viewId);
  if (definition) drafts.set(key, definition);
  else if (!drafts.delete(key)) return;
  notify();
}

export function useViewDraft(
  scope: DraftScope | null,
  viewId: string | undefined,
): ViewDefinition | undefined {
  const read = useCallback(
    () => (scope && viewId ? drafts.get(draftKey(scope, viewId)) : undefined),
    [scope, viewId],
  );
  return useSyncExternalStore(subscribe, read, read);
}
