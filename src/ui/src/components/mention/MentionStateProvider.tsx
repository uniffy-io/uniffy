/**
 * Mention State Provider
 *
 * React context that manages batch resolution and real-time updates for
 * all visible mention chips. Mounted in MainLayout so every domain page
 * gets live mention state automatically.
 *
 * How it works:
 * 1. MentionChip components register their URN via useMentionState(urn)
 * 2. Provider collects URNs, debounces 200ms, calls resolveUrns in batch
 * 3. Results stored in Map<string, MentionLiveState>
 * 4. Streaming events from useNotificationStream update individual URNs
 * 5. Only URNs currently registered (visible) are tracked
 */

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import {
  onMentionStateChange,
  setMentionState,
  clearMentionStates,
  setMentionUrl,
} from '@/components/mention/mentionStateEmitter';
import type { MentionLiveState } from '@/components/mention/types';
import type { UrnMetadata } from '@/gen/search/v1/search_pb';

// Debounce interval for batch resolution (ms)
const RESOLVE_DEBOUNCE = 200;

interface MentionStateContextValue {
  states: Map<string, MentionLiveState>;
  register: (urn: string) => void;
  unregister: (urn: string) => void;
}

/** Stable sentinel used to detect whether the provider is mounted */
export const MENTION_NOOP = () => {};

export const MentionStateContext = createContext<MentionStateContextValue>({
  states: new Map(),
  register: MENTION_NOOP,
  unregister: MENTION_NOOP,
});

/**
 * Convert UrnMetadata (from resolveUrns API) to MentionLiveState
 */
function metadataToLiveState(urn: string, meta: UrnMetadata): MentionLiveState {
  const parsed = parseUrn(urn);
  const m = meta.metadata ?? {};

  const state: MentionLiveState = {
    urn,
    title: meta.title || undefined,
    updatedAt: m.updated_at || undefined,
    updatedByName: m.updated_by_name || undefined,
  };

  switch (parsed.type) {
    case UrnType.TASK:
      if (m.status) state.taskStatus = m.status as MentionLiveState['taskStatus'];
      if (m.due_date) state.taskDueDate = m.due_date;
      if (m.assignee_name) state.taskAssignee = m.assignee_name;
      break;

    case UrnType.CALENDAR_EVENT:
      if (m.start_time) state.eventStartTime = m.start_time;
      if (m.end_time) state.eventEndTime = m.end_time;
      if (m.is_all_day) state.eventIsAllDay = m.is_all_day === 'true';
      break;

    case UrnType.FILE:
      if (m.processing_status) state.fileProcessingStatus = m.processing_status as MentionLiveState['fileProcessingStatus'];
      if (m.mime_type) state.fileMimeType = m.mime_type;
      if (m.size) state.fileSize = parseInt(m.size, 10) || undefined;
      break;

    case UrnType.PROJECT:
      if (m.completed_tasks) state.projectCompletedTasks = parseInt(m.completed_tasks, 10) || 0;
      if (m.total_tasks) state.projectTotalTasks = parseInt(m.total_tasks, 10) || 0;
      if (m.status) state.projectStatus = m.status;
      break;

    case UrnType.CHAT:
    case UrnType.UNKNOWN:
      if (m.member_count) state.memberCount = parseInt(m.member_count, 10) || 0;
      break;
  }

  return state;
}

interface MentionStateProviderProps {
  children: React.ReactNode;
}

export function MentionStateProvider({ children }: MentionStateProviderProps) {
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);

  // Registered URNs (currently visible in viewport)
  const registeredUrns = useRef(new Map<string, number>()); // urn -> refcount
  // Resolved states
  const [states, setStates] = useState<Map<string, MentionLiveState>>(new Map());
  // URNs pending resolution
  const pendingUrns = useRef(new Set<string>());
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch resolve pending URNs
  const flushPending = useCallback(async () => {
    resolveTimer.current = null;
    if (!organizationId || pendingUrns.current.size === 0) return;

    const urns = [...pendingUrns.current];
    pendingUrns.current.clear();

    try {
      const response = await searchApi.resolveUrns({
        organizationId,
        urns,
      });

      if (!response.resolved) return;

      setStates((prev) => {
        const next = new Map(prev);
        for (const [urn, metadata] of Object.entries(response.resolved)) {
          const meta = metadata as UrnMetadata;
          const liveState = metadataToLiveState(urn, meta);
          next.set(urn, liveState);
          // Also update the module-level store for ProseMirror access
          setMentionState(urn, liveState);
          // Store resolved URL for click navigation (handles nested routes like tasks)
          if (meta.url) {
            setMentionUrl(urn, meta.url);
          }
        }
        return next;
      });
    } catch {
      // Non-fatal - chips render without live state
    }
  }, [organizationId]);

  // Schedule batch resolution
  const scheduleBatch = useCallback(() => {
    if (resolveTimer.current) clearTimeout(resolveTimer.current);
    resolveTimer.current = setTimeout(flushPending, RESOLVE_DEBOUNCE);
  }, [flushPending]);

  // Register a URN for live state tracking
  const register = useCallback((urn: string) => {
    const count = registeredUrns.current.get(urn) ?? 0;
    registeredUrns.current.set(urn, count + 1);

    // Only fetch if this is a new URN (not already resolved)
    if (count === 0) {
      pendingUrns.current.add(urn);
      scheduleBatch();
    }
  }, [scheduleBatch]);

  // Unregister a URN (chip scrolled out of viewport or unmounted)
  const unregister = useCallback((urn: string) => {
    const count = registeredUrns.current.get(urn) ?? 0;
    if (count <= 1) {
      registeredUrns.current.delete(urn);
      // Don't remove from states - keeps cache warm if chip re-appears
    } else {
      registeredUrns.current.set(urn, count - 1);
    }
  }, []);

  // Listen for real-time state change events from the notification stream
  useEffect(() => {
    const unsubscribe = onMentionStateChange((urn, changes) => {
      // Only process if this URN is currently registered (visible)
      if (!registeredUrns.current.has(urn)) return;

      setStates((prev) => {
        const existing = prev.get(urn);
        const updated: MentionLiveState = { ...existing, urn, ...changes };
        const next = new Map(prev);
        next.set(urn, updated);
        setMentionState(urn, updated);
        return next;
      });
    });

    return unsubscribe;
  }, []);

  // Clean up on unmount (navigation)
  useEffect(() => {
    return () => {
      if (resolveTimer.current) clearTimeout(resolveTimer.current);
      clearMentionStates();
    };
  }, []);

  // Re-resolve all registered URNs when org changes
  useEffect(() => {
    if (!organizationId) return;

    setStates(new Map());
    clearMentionStates();

    // Queue all currently registered URNs for re-resolution
    for (const urn of registeredUrns.current.keys()) {
      pendingUrns.current.add(urn);
    }
    if (pendingUrns.current.size > 0) {
      scheduleBatch();
    }
  }, [organizationId, scheduleBatch]);

  return (
    <MentionStateContext.Provider value={{ states, register, unregister }}>
      {children}
    </MentionStateContext.Provider>
  );
}
