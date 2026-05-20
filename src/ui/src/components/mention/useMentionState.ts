/**
 * Subscribe a URN to the MentionStateProvider (or the module-level
 * emitter outside the provider tree) and return its live state.
 */

import { useContext, useEffect, useState } from 'react';
import { useAppSelector } from '@/app/hooks';
import {
  MentionStateContext,
  MENTION_NOOP,
  streamChangesToLiveState,
  type MentionDisplayMode,
} from '@/components/mention/MentionStateProvider';
import {
  getMentionState,
  onMentionStateChange,
} from '@/components/mention/mentionStateEmitter';
import { resolveUrnBatched } from '@/components/mention/useBatchedSubjectResolver';
import type { MentionLiveState } from '@/components/mention/types';

/**
 * Resolved mention display mode from the provider. Falls back to
 * `'expanded'` when no provider is mounted.
 */
export function useMentionDisplay(): MentionDisplayMode {
  return useContext(MentionStateContext).mentionDisplay;
}

/**
 * Live state for a URN. Registers with the provider for batch resolve
 * and streaming updates; falls back to the module-level emitter when
 * mounted outside the provider tree (e.g. ProseMirror NodeViews).
 */
export function useMentionState(urn: string): MentionLiveState | null {
  const context = useContext(MentionStateContext);
  const hasProvider = context.register !== MENTION_NOOP;
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

  const [fallbackState, setFallbackState] = useState<MentionLiveState | null>(
    () => getMentionState(urn),
  );

  // Depend on stable callbacks, not the whole context: ``states``
  // changes on every batch resolve and would thrash register /
  // unregister into an infinite resolution loop.
  const { register, unregister } = context;
  useEffect(() => {
    if (!urn) return;
    register(urn);
    return () => unregister(urn);
  }, [urn, register, unregister]);

  // Outside the provider, kick resolution through the global batch
  // resolver; its flush broadcasts via publishMentionState so the
  // listener below picks the state up.
  useEffect(() => {
    if (hasProvider || !urn || !organizationId) return;
    if (getMentionState(urn)) return;
    resolveUrnBatched(urn, organizationId).catch(() => {
      // Swallow: chip falls back to label-only render.
    });
  }, [urn, hasProvider, organizationId]);

  // Stream merge for outside-context chips. ``changes`` arrives in
  // mixed snake_case + typed shapes; spread both and overlay the
  // translated camelCase patch so deltas land on the right fields.
  useEffect(() => {
    if (hasProvider || !urn) return;

    // Resync against any publish that landed between the useState
    // initializer and the listener subscribing.
    const current = getMentionState(urn);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot resync to close the initializer-vs-subscribe race
    if (current) setFallbackState(current);

    return onMentionStateChange((changedUrn, changes) => {
      if (changedUrn !== urn) return;
      setFallbackState((prev) => {
        const patch = streamChangesToLiveState(
          changes as Record<string, string>,
        );
        if (!prev) {
          return { urn, ...changes, ...patch } as MentionLiveState;
        }
        return { ...prev, ...changes, ...patch };
      });
    });
  }, [urn, hasProvider]);

  const providerState = context.states.get(urn) ?? null;
  return providerState ?? fallbackState;
}
