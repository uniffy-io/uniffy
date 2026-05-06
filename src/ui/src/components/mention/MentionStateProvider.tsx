/* eslint-disable react-refresh/only-export-components */
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
  useMemo,
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
import type { UrnMetadata } from '@uniffy/proto/search/v1/search_pb';
import { useAppearanceSettings } from '@/features/settings/hooks/useSettings';

export type MentionDisplayMode = 'expanded' | 'compact';

// Debounce interval for batch resolution (ms)
const RESOLVE_DEBOUNCE = 200;

interface MentionStateContextValue {
  states: Map<string, MentionLiveState>;
  register: (urn: string) => void;
  unregister: (urn: string) => void;
  mentionDisplay: MentionDisplayMode;
}

/** Stable sentinel used to detect whether the provider is mounted */
export const MENTION_NOOP = () => {};

export const MentionStateContext = createContext<MentionStateContextValue>({
  states: new Map(),
  register: MENTION_NOOP,
  unregister: MENTION_NOOP,
  mentionDisplay: 'expanded',
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
    description: meta.description || undefined,
    updatedAt: m.updated_at || undefined,
    updatedByName: m.updated_by_name || undefined,
    parentLabel: m.parent_label || undefined,
    status: m.urn_status === 'DELETED' ? 'deleted' : 'ok',
  };

  // Shared tags
  if (meta.contentTags?.length) state.contentTags = [...meta.contentTags];

  switch (parsed.type) {
    case UrnType.TASK:
      if (m.status || meta.status) state.taskStatus = (meta.status || m.status) as MentionLiveState['taskStatus'];
      if (m.due_date || meta.dueDate) state.taskDueDate = meta.dueDate || m.due_date;
      if (m.assignee_name || meta.assigneeName) state.taskAssignee = meta.assigneeName || m.assignee_name;
      state.taskPriority = meta.priority || m.priority || undefined;
      state.taskPriorityLabel = meta.priorityLabel || m.priority_label || undefined;
      state.taskPriorityColor = meta.priorityColor || m.priority_color || undefined;
      state.taskStatusLabel = meta.statusLabel || m.status_label || undefined;
      state.taskStatusColor = meta.statusColor || m.status_color || undefined;
      state.taskType = meta.taskType || m.task_type || undefined;
      if (meta.taskNumber) state.taskNumber = meta.taskNumber;
      state.taskProjectName = meta.projectName || m.project_name || undefined;
      state.taskProjectSlug = meta.projectSlug || m.project_slug || undefined;
      state.taskProjectColor = meta.projectColor || m.project_color || undefined;
      if (meta.subtaskCompleted) state.taskSubtaskCompleted = meta.subtaskCompleted;
      if (meta.subtaskTotal) state.taskSubtaskTotal = meta.subtaskTotal;
      if (meta.blockedByCount) state.taskBlockedByCount = meta.blockedByCount;
      if (meta.assigneeIds?.length) state.taskAssigneeIds = [...meta.assigneeIds];
      break;

    case UrnType.CALENDAR_EVENT:
      state.eventStartTime = meta.eventStartTime || m.start_time || undefined;
      state.eventEndTime = meta.eventEndTime || m.end_time || undefined;
      state.eventIsAllDay = meta.eventIsAllDay || m.is_all_day === 'true';
      state.eventLocation = meta.eventLocation || undefined;
      state.eventMeetingUrl = meta.eventMeetingUrl || undefined;
      break;

    case UrnType.FILE:
      if (m.processing_status || meta.processingStatus) state.fileProcessingStatus = (meta.processingStatus || m.processing_status) as MentionLiveState['fileProcessingStatus'];
      state.fileMimeType = meta.fileMimeType || m.mime_type || undefined;
      if (meta.fileSize) state.fileSize = Number(meta.fileSize) || undefined;
      else if (m.size) state.fileSize = parseInt(m.size, 10) || undefined;
      break;

    case UrnType.NOTE:
      state.noteNodeType = meta.noteNodeType || undefined;
      break;

    case UrnType.PROJECT:
      if (meta.completedTasks || m.completed_tasks) state.projectCompletedTasks = meta.completedTasks || parseInt(m.completed_tasks, 10) || 0;
      if (meta.totalTasks || m.total_tasks) state.projectTotalTasks = meta.totalTasks || parseInt(m.total_tasks, 10) || 0;
      if (meta.status || m.status) state.projectStatus = meta.status || m.status;
      break;

    case UrnType.CHAT:
      state.channelType = meta.channelType || undefined;
      if (meta.memberCount || m.member_count) state.memberCount = meta.memberCount || parseInt(m.member_count, 10) || 0;
      break;

    case UrnType.CHAT_MESSAGE:
      state.channelType = meta.channelType || m.channel_type || undefined;
      state.chatSenderName = m.sender_name || undefined;
      state.chatChannelId = m.channel_id || undefined;
      break;

    case UrnType.AGENT:
      state.agentEmoji = meta.agentEmoji || undefined;
      state.agentThemeColor = meta.agentThemeColor || undefined;
      break;

    case UrnType.USER:
      state.userAvatarUrl = meta.userAvatarUrl || undefined;
      state.userEmail = meta.userEmail || undefined;
      break;
  }

  return state;
}

/**
 * Convert a snake_case proto map payload from the notification stream
 * into a typed ``Partial<MentionLiveState>`` patch. Mirrors the field
 * mapping in ``metadataToLiveState`` so live updates land on the same
 * camelCase keys the chip components read.
 */
function streamChangesToLiveState(changes: Record<string, string>): Partial<MentionLiveState> {
  const patch: Partial<MentionLiveState> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const value = raw ?? '';
    switch (key) {
      case 'title':
        patch.title = value || undefined; break;
      case 'description':
        patch.description = value || undefined; break;
      case 'updated_at':
        patch.updatedAt = value || undefined; break;
      case 'updated_by_name':
        patch.updatedByName = value || undefined; break;
      case 'urn_status':
        patch.status = value === 'DELETED' ? 'deleted' : 'ok'; break;
      case 'parent_label':
        patch.parentLabel = value || undefined; break;

      // TASK
      case 'status':
        patch.taskStatus = value || undefined;
        patch.projectStatus = value || undefined;
        break;
      case 'due_date':
        patch.taskDueDate = value || undefined; break;
      case 'assignee_name':
        patch.taskAssignee = value || undefined; break;
      case 'priority':
        patch.taskPriority = value || undefined; break;
      case 'priority_label':
        patch.taskPriorityLabel = value || undefined; break;
      case 'priority_color':
        patch.taskPriorityColor = value || undefined; break;
      case 'status_label':
        patch.taskStatusLabel = value || undefined; break;
      case 'status_color':
        patch.taskStatusColor = value || undefined; break;
      case 'task_type':
        patch.taskType = value || undefined; break;
      case 'project_name':
        patch.taskProjectName = value || undefined; break;
      case 'project_slug':
        patch.taskProjectSlug = value || undefined; break;
      case 'project_color':
        patch.taskProjectColor = value || undefined; break;
      case 'assignee_ids':
        patch.taskAssigneeIds = value ? value.split(',').filter(Boolean) : undefined;
        break;

      // CALENDAR_EVENT
      case 'start_time':
        patch.eventStartTime = value || undefined; break;
      case 'end_time':
        patch.eventEndTime = value || undefined; break;
      case 'is_all_day':
        patch.eventIsAllDay = value === 'true'; break;
      case 'location':
        patch.eventLocation = value || undefined; break;
      case 'meeting_url':
        patch.eventMeetingUrl = value || undefined; break;

      // FILE
      case 'processing_status':
        patch.fileProcessingStatus = (value || undefined) as MentionLiveState['fileProcessingStatus'];
        break;
      case 'mime_type':
        patch.fileMimeType = value || undefined; break;
      case 'file_size':
        patch.fileSize = value ? parseInt(value, 10) || undefined : undefined; break;

      // NOTE
      case 'node_type':
        patch.noteNodeType = value || undefined; break;

      // PROJECT
      case 'completed_tasks':
        patch.projectCompletedTasks = value ? parseInt(value, 10) || 0 : 0; break;
      case 'total_tasks':
        patch.projectTotalTasks = value ? parseInt(value, 10) || 0 : 0; break;

      // CHAT
      case 'channel_type':
        patch.channelType = value || undefined; break;
      case 'member_count':
        patch.memberCount = value ? parseInt(value, 10) || 0 : 0; break;

      // CHAT_MESSAGE
      case 'sender_name':
        patch.chatSenderName = value || undefined; break;
      case 'channel_id':
        patch.chatChannelId = value || undefined; break;

      default:
        break;
    }
  }
  return patch;
}

interface MentionStateProviderProps {
  children: React.ReactNode;
}

export function MentionStateProvider({ children }: MentionStateProviderProps) {
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const mentionDisplay = useAppearanceSettings().mentionDisplay as MentionDisplayMode;

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
        // Stream payloads are proto map<string,string> with snake_case
        // keys. Translate to the typed MentionLiveState shape before
        // merging so consumers (which read camelCase fields) see the
        // update. Unknown keys are ignored.
        const patch = streamChangesToLiveState(changes as Record<string, string>);
        const updated: MentionLiveState = { ...existing, urn, ...patch };
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

    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state when organizationId changes is valid
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

  // Stable context value - identity only changes when one of the tracked
  // values changes. Without this every provider render creates a fresh
  // object, which would re-fire every consumer's `useEffect([context])`
  // and trigger an infinite register/unregister/resolve loop.
  const value = useMemo<MentionStateContextValue>(
    () => ({ states, register, unregister, mentionDisplay }),
    [states, register, unregister, mentionDisplay],
  );

  return (
    <MentionStateContext.Provider value={value}>
      {children}
    </MentionStateContext.Provider>
  );
}

const EMPTY_STATES: Map<string, MentionLiveState> = new Map();

/**
 * Lightweight bridge for React roots mounted outside the main app tree (e.g.
 * the editor's per-chip ProseMirror NodeView roots). Supplies only
 * `mentionDisplay` via context; live-state delivery falls back to the
 * module-level emitter inside `useMentionState`.
 *
 * Use this when you cannot mount the full `MentionStateProvider` (which would
 * spin up a redundant batch resolver and own the global state lifecycle).
 */
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
  return (
    <MentionStateContext.Provider value={value}>
      {children}
    </MentionStateContext.Provider>
  );
}
