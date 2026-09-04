import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MentionStateContext,
  MENTION_NOOP,
  type MentionDisplayMode,
  type MentionStateContextValue,
} from "@/components/mention/mentionStateContext";
import {
  mentionAvailabilityFromProto,
  metadataToLiveState,
  streamChangesToLiveState,
} from "@/components/mention/mentionLiveState";
import { useAppSelector } from "@/app/hooks";
import { searchApi } from "@/features/search/api/searchApi";
import { membersApi } from "@/features/permissions/api/membersApi";
import {
  onMentionStateChange,
  setMentionState,
  clearMentionStates,
  setMentionUrl,
} from "@/components/mention/mentionStateEmitter";
import { MentionAvailability, type MentionLiveState } from "@/components/mention/types";
import { type UrnMetadata } from "@uniffy/proto/search/v1/search_pb";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import { clearPreviewCache } from "@/components/mention/useBatchedSubjectResolver";
import { accessRequestStatusToLiveState } from "@/components/mention/accessRequestState";

interface MentionStateProviderProps {
  children: React.ReactNode;
}

export function MentionStateProvider({ children }: MentionStateProviderProps) {
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const mentionDisplay = useAppearanceSettings().mentionDisplay as MentionDisplayMode;

  const registeredUrns = useRef(new Map<string, number>());
  const [states, setStates] = useState<Map<string, MentionLiveState>>(new Map());
  const pendingUrns = useRef(new Set<string>());
  const flushScheduled = useRef(false);
  const disposed = useRef(false);
  const previousOrganizationId = useRef(organizationId);

  const flushPending = useCallback(async () => {
    if (!organizationId || pendingUrns.current.size === 0) return;

    const urns = [...pendingUrns.current];
    pendingUrns.current.clear();

    try {
      const response = await searchApi.resolveUrns({
        organizationId,
        urns,
      });

      if (!response.resolved) return;

      const restrictedUrns = Object.entries(response.resolved)
        .filter(([, metadata]) => {
          const meta = metadata as UrnMetadata;
          return (
            mentionAvailabilityFromProto(meta.availability, meta.urnStatus) ===
              MentionAvailability.Restricted && meta.canRequestAccess
          );
        })
        .map(([urn]) => urn);
      let requestStatusByUrn = new Map<
        string,
        Awaited<ReturnType<typeof membersApi.getMyAccessRequestStatuses>>["statuses"][number]
      >();
      if (restrictedUrns.length > 0) {
        try {
          const statusResponse = await membersApi.getMyAccessRequestStatuses({
            organizationId,
            requestedUrns: restrictedUrns,
          });
          requestStatusByUrn = new Map(
            statusResponse.statuses.map((status) => [status.requestedUrn, status]),
          );
        } catch {
          requestStatusByUrn = new Map();
        }
      }

      setStates((prev) => {
        const next = new Map(prev);
        for (const [urn, metadata] of Object.entries(response.resolved)) {
          const meta = metadata as UrnMetadata;
          const liveState = {
            ...metadataToLiveState(urn, meta),
            ...accessRequestStatusToLiveState(requestStatusByUrn.get(urn)),
          };
          next.set(urn, liveState);
          // Also publish to the module-level emitter so ProseMirror NodeView roots pick it up.
          setMentionState(urn, liveState);
          if (meta.url) {
            setMentionUrl(urn, meta.url);
          }
        }
        return next;
      });
    } catch {
      // Non-fatal — chips render without live state.
    }
  }, [organizationId]);

  // Every chip mounted by one commit registers inside the same effect flush, so a microtask
  // already coalesces them into one request. A timer here is a flat skeleton delay on every surface.
  const scheduleBatch = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    queueMicrotask(() => {
      flushScheduled.current = false;
      if (disposed.current) return;
      void flushPending();
    });
  }, [flushPending]);

  const register = useCallback(
    (urn: string, resolvedMetadata?: UrnMetadata) => {
      const count = registeredUrns.current.get(urn) ?? 0;
      registeredUrns.current.set(urn, count + 1);

      if (resolvedMetadata) {
        pendingUrns.current.delete(urn);
        const liveState = metadataToLiveState(urn, resolvedMetadata);
        setStates((prev) => {
          const next = new Map(prev);
          next.set(urn, liveState);
          return next;
        });
        setMentionState(urn, liveState);
        if (resolvedMetadata.url) {
          setMentionUrl(urn, resolvedMetadata.url);
        }
        return;
      }

      if (count === 0) {
        pendingUrns.current.add(urn);
        scheduleBatch();
      }
    },
    [scheduleBatch],
  );

  const unregister = useCallback((urn: string) => {
    const count = registeredUrns.current.get(urn) ?? 0;
    if (count <= 1) {
      registeredUrns.current.delete(urn);
      // Keep states warm so a re-appearing chip avoids a re-resolve.
    } else {
      registeredUrns.current.set(urn, count - 1);
    }
  }, []);

  // Stream patches arrive snake_case; spread both shapes then overlay the translated camelCase patch so deltas land on the right fields.
  useEffect(() => {
    const unsubscribe = onMentionStateChange((urn, changes, operation) => {
      setStates((prev) => {
        if (operation === "invalidate") {
          if (!prev.has(urn)) return prev;
          const next = new Map(prev);
          next.delete(urn);
          return next;
        }
        if (operation === "replace") {
          const replacement = changes as MentionLiveState;
          const next = new Map(prev);
          next.set(urn, replacement);
          setMentionState(urn, replacement);
          return next;
        }
        const existing = prev.get(urn);
        if (!existing) return prev;
        const patch = streamChangesToLiveState(changes as Record<string, string>);
        const updated: MentionLiveState = { ...existing, ...changes, ...patch };
        const next = new Map(prev);
        next.set(urn, updated);
        setMentionState(urn, updated);
        return next;
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    // Reset on every mount: StrictMode replays the cleanup once, and a stuck flag would swallow every batch.
    disposed.current = false;
    return () => {
      disposed.current = true;
      clearMentionStates();
      clearPreviewCache();
    };
  }, []);

  useEffect(() => {
    if (!organizationId) {
      previousOrganizationId.current = null;
      return;
    }
    if (organizationId === previousOrganizationId.current) return;
    previousOrganizationId.current = organizationId;

    // eslint-disable-next-line react/react-compiler -- an org switch must drop every resolved title before the refetch, or chips keep rendering the previous tenant's content
    setStates(new Map());
    clearMentionStates();
    clearPreviewCache();

    for (const urn of registeredUrns.current.keys()) {
      pendingUrns.current.add(urn);
    }
    if (pendingUrns.current.size > 0) {
      scheduleBatch();
    }
  }, [organizationId, scheduleBatch]);

  // Stable identity is mandatory — a fresh object every render would re-fire every consumer's `useEffect([context])` into an infinite loop.
  const value = useMemo<MentionStateContextValue>(
    () => ({ states, register, unregister, mentionDisplay }),
    [states, register, unregister, mentionDisplay],
  );

  return <MentionStateContext.Provider value={value}>{children}</MentionStateContext.Provider>;
}

const EMPTY_STATES: Map<string, MentionLiveState> = new Map();

/** Supplies only `mentionDisplay` for React roots mounted outside the main tree (ProseMirror NodeViews); state arrives via the module-level emitter. */
export function MentionDisplayBridge({ children }: MentionStateProviderProps) {
  const mentionDisplay = useAppearanceSettings().mentionDisplay as MentionDisplayMode;
  const value = useMemo<MentionStateContextValue>(
    () => ({
      states: EMPTY_STATES,
      register: MENTION_NOOP,
      unregister: MENTION_NOOP,
      mentionDisplay,
    }),
    [mentionDisplay],
  );
  return <MentionStateContext.Provider value={value}>{children}</MentionStateContext.Provider>;
}
