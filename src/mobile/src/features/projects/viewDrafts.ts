import { useCallback, useSyncExternalStore } from "react";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { definitionsEqual } from "@features/projects/viewDefinition";

/** Scoped drafts survive navigation while pending saves preserve subsequent edits. */
const drafts = new Map<string, ViewDefinition>();
const saves = new Map<string, ViewSave>();
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

interface ViewSave {
  key: string;
  definition: ViewDefinition;
}

export function getViewDraft(scope: DraftScope, viewId: string): ViewDefinition | undefined {
  return drafts.get(draftKey(scope, viewId));
}

export function isViewSaving(scope: DraftScope, viewId: string): boolean {
  return saves.has(draftKey(scope, viewId));
}

export function beginViewSave(
  scope: DraftScope,
  viewId: string,
  definition: ViewDefinition,
): ViewSave | null {
  const key = draftKey(scope, viewId);
  if (saves.has(key)) return null;
  const save = { key, definition };
  saves.set(key, save);
  return save;
}

export function finishViewSave(save: ViewSave, succeeded: boolean): void {
  if (saves.get(save.key) !== save) return;
  saves.delete(save.key);
  const current = drafts.get(save.key);
  if (succeeded && current && definitionsEqual(current, save.definition)) {
    drafts.delete(save.key);
    notify();
  }
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

export function editViewDraft(
  scope: DraftScope,
  viewId: string,
  next: ViewDefinition,
  saved: ViewDefinition,
): void {
  const unchanged = definitionsEqual(next, saved) && !isViewSaving(scope, viewId);
  setViewDraft(scope, viewId, unchanged ? null : next);
}

export function useViewDraft(
  scope: DraftScope | null,
  viewId: string | undefined,
): ViewDefinition | undefined {
  const read = useCallback(
    () => (scope && viewId ? getViewDraft(scope, viewId) : undefined),
    [scope, viewId],
  );
  return useSyncExternalStore(subscribe, read, read);
}
