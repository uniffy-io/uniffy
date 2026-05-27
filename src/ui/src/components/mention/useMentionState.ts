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

export function useMentionDisplay(): MentionDisplayMode {
  return useContext(MentionStateContext).mentionDisplay;
}

/** Registers with the provider when present; otherwise resolves via the global batch resolver + module emitter (ProseMirror NodeViews). */
export function useMentionState(urn: string): MentionLiveState | null {
  const context = useContext(MentionStateContext);
  const hasProvider = context.register !== MENTION_NOOP;
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

  const [fallbackState, setFallbackState] = useState<MentionLiveState | null>(
    () => getMentionState(urn),
  );

  // Depend on stable callbacks, not the whole context — `states` mutates on every batch and would thrash register/unregister.
  const { register, unregister } = context;
  useEffect(() => {
    if (!urn) return;
    register(urn);
    return () => unregister(urn);
  }, [urn, register, unregister]);

  // Outside the provider, kick resolution through the global batch resolver; its flush broadcasts via publishMentionState.
  useEffect(() => {
    if (hasProvider || !urn || !organizationId) return;
    if (getMentionState(urn)) return;
    resolveUrnBatched(urn, organizationId).catch(() => {
      // Chip falls back to label-only render.
    });
  }, [urn, hasProvider, organizationId]);

  // Stream patches arrive snake_case; translate to camelCase before merging or deltas land on the wrong fields.
  useEffect(() => {
    if (hasProvider || !urn) return;

    // Resync to close the race between the useState initializer and the listener subscribing.
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
