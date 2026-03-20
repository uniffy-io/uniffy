/**
 * useMentionState Hook
 *
 * Registers a URN with the MentionStateProvider and returns its live state.
 * Used by MentionChip components to automatically get real-time updates.
 *
 * When used inside MentionStateProvider context:
 *   - Registers URN on mount, unregisters on unmount
 *   - Returns live state from the provider's batch-resolved cache
 *   - Updates automatically when streaming events arrive
 *
 * When used outside context (e.g., ProseMirror NodeView):
 *   - Falls back to the module-level state store
 *   - Still gets updates when state changes are emitted
 */

import { useContext, useEffect, useState } from 'react';
import { MentionStateContext, MENTION_NOOP } from '@/components/mention/MentionStateProvider';
import {
  getMentionState,
  onMentionStateChange,
} from '@/components/mention/mentionStateEmitter';
import type { MentionLiveState } from '@/components/mention/types';

/**
 * Get live state for a URN. Automatically registers with the provider
 * for batch resolution and real-time streaming updates.
 */
export function useMentionState(urn: string): MentionLiveState | null {
  const context = useContext(MentionStateContext);
  const hasProvider = context.register !== MENTION_NOOP;

  // Track state from module-level store for outside-context usage
  const [fallbackState, setFallbackState] = useState<MentionLiveState | null>(
    () => getMentionState(urn),
  );

  // Register/unregister with provider
  useEffect(() => {
    if (!urn) return;
    context.register(urn);
    return () => context.unregister(urn);
  }, [urn, context]);

  // For outside-context usage: listen to emitter directly
  useEffect(() => {
    if (hasProvider || !urn) return;

    return onMentionStateChange((changedUrn, changes) => {
      if (changedUrn !== urn) return;
      setFallbackState((prev) => ({ ...prev, urn, ...changes }));
    });
  }, [urn, hasProvider]);

  // Provider state takes precedence
  const providerState = context.states.get(urn) ?? null;
  return providerState ?? fallbackState;
}
