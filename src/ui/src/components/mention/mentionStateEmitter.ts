/**
 * Mention State Event Emitter
 *
 * Module-level event bus for mention state changes from the notification stream.
 * Used by MentionStateProvider to receive real-time updates, and also accessible
 * outside React context (e.g., ProseMirror NodeViews) via the module-level API.
 *
 * Pattern mirrors storeRef.ts - a module-level singleton set at runtime.
 */

import type { MentionLiveState } from '@/components/mention/types';

type MentionStateListener = (urn: string, changes: Partial<MentionLiveState>) => void;

const listeners = new Set<MentionStateListener>();

/**
 * Subscribe to mention state change events.
 * Returns an unsubscribe function.
 */
export function onMentionStateChange(listener: MentionStateListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Emit a mention state change. Called from the notification stream handler
 * when a MENTION_STATE_CHANGED event arrives.
 */
export function emitMentionStateChange(urn: string, changes: Partial<MentionLiveState>): void {
  listeners.forEach((listener) => listener(urn, changes));
}

// Module-level state store for access outside React context (ProseMirror NodeViews)
const mentionStates = new Map<string, MentionLiveState>();

/**
 * Get the current live state for a URN. Works outside React context.
 * Returns null if no state has been resolved yet.
 */
export function getMentionState(urn: string): MentionLiveState | null {
  return mentionStates.get(urn) ?? null;
}

/**
 * Set the live state for a URN. Called by MentionStateProvider when
 * states are resolved or updated.
 */
export function setMentionState(urn: string, state: MentionLiveState): void {
  mentionStates.set(urn, state);
}

/**
 * Set + broadcast in one call. Use this from non-React resolution
 * paths (e.g. the global batch resolver) so chips listening via the
 * module-level emitter wake up with the new state -- ``setMentionState``
 * alone is silent and would leave outside-context chips stuck on a
 * stale snapshot.
 */
export function publishMentionState(urn: string, state: MentionLiveState): void {
  mentionStates.set(urn, state);
  listeners.forEach((listener) => listener(urn, state));
}

/**
 * Clear all stored states. Called on navigation/unmount.
 */
export function clearMentionStates(): void {
  mentionStates.clear();
  mentionUrls.clear();
}

// Module-level URL store for resolved navigation paths
// Handles nested routes like tasks (/projects/{pid}/tasks/{tid})
const mentionUrls = new Map<string, string>();

/**
 * Store the resolved URL path for a URN.
 * Called by MentionStateProvider after batch resolution.
 */
export function setMentionUrl(urn: string, url: string): void {
  mentionUrls.set(urn, url);
}

/**
 * Get the resolved URL path for a URN. Works outside React context.
 * Returns null if no URL has been resolved yet.
 */
export function getMentionUrl(urn: string): string | null {
  return mentionUrls.get(urn) ?? null;
}
