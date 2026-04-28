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
import { MentionStateContext, MENTION_NOOP, type MentionDisplayMode } from '@/components/mention/MentionStateProvider';
import {
  getMentionState,
  onMentionStateChange,
} from '@/components/mention/mentionStateEmitter';
import type { MentionLiveState } from '@/components/mention/types';

/**
 * Resolved mention display mode from the provider. Falls back to `'expanded'`
 * when no provider is mounted (default context value), keeping standalone
 * renders sane.
 */
export function useMentionDisplay(): MentionDisplayMode {
  return useContext(MentionStateContext).mentionDisplay;
}

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

  // Register/unregister with provider. Depend on the stable callbacks, not
  // the whole context object - the context's `states` field changes on
  // every batch resolve, which would otherwise re-fire this effect and
  // cause register/unregister to thrash, retriggering resolution forever.
  const { register, unregister } = context;
  useEffect(() => {
    if (!urn) return;
    register(urn);
    return () => unregister(urn);
  }, [urn, register, unregister]);

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
