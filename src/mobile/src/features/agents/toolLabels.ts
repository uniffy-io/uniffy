/**
 * Tool display names, filled from the shipped catalog by `useAgentTools`. Until
 * that lands - and for a tool the server no longer ships - the wire name is
 * title-cased instead.
 */

import { useSyncExternalStore } from "react";

const displayNames = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/**
 * Providers require `[a-zA-Z0-9_-]` tool names, so the wire replaces the
 * internal dots with hyphens (`notes.create_note` -> `notes-create_note`) and
 * chat rows persist that form. Internal names never contain hyphens, so the
 * reverse mapping is lossless.
 */
export function internalToolName(toolName: string): string {
  return toolName.replace(/-/g, ".");
}

export function rememberToolLabels(tools: { name: string; displayName: string }[]): void {
  let changed = false;
  for (const tool of tools) {
    if (tool.displayName && displayNames.get(tool.name) !== tool.displayName) {
      displayNames.set(tool.name, tool.displayName);
      changed = true;
    }
  }
  if (!changed) return;
  version++;
  for (const listener of listeners) listener();
}

/**
 * Re-renders the caller when the catalog lands. The query resolves after a
 * cached transcript has already rendered, and every pane reading these labels
 * sits inside a memoized row that no arriving message would invalidate - so
 * without this the fallbacks stay on screen until something else forces a
 * render.
 */
export function useToolLabels(): number {
  return useSyncExternalStore(subscribe, getVersion);
}

export function toolActionLabel(toolName: string): string {
  const internal = internalToolName(toolName);
  const known = displayNames.get(internal);
  if (known) return known;

  const parts = internal.split(".");
  const action = parts[parts.length - 1] ?? "";
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
