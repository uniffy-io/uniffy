/**
 * Batched URN resolver.
 *
 * Coalesces N concurrent URN-preview lookups into a single bulk
 * `resolveUrns` RPC. Pending URNs accumulate inside a microtask;
 * when the microtask flushes, one round-trip resolves every URN
 * collected since the last flush. The cache is process-wide so
 * remounting components does not re-fetch.
 */

import { useCallback } from 'react';
import { searchApi } from '@/features/search';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import { getContentTypeLabel } from '@/config/theme/contentTypes';
import { useAppSelector } from '@/app/hooks';
import { publishMentionState } from '@/components/mention/mentionStateEmitter';
import type { MentionLiveState } from '@/components/mention/types';

export interface UrnPreviewData {
  urn: string;
  title: string;
  description: string;
  type: UrnType;
  url?: string;
  updatedAt?: string;
  createdAt?: string;
  metadata?: Record<string, string>;
}

const previewCache = new Map<string, UrnPreviewData>();

let pendingByUrn = new Map<string, Array<(data: UrnPreviewData | null) => void>>();
let pendingOrgId: string | null = null;
let scheduled = false;

function searchResultTypeToUrnType(type: SearchResultType): UrnType {
  switch (type) {
    case SearchResultType.NOTE: return UrnType.NOTE;
    case SearchResultType.FILE: return UrnType.FILE;
    case SearchResultType.CHAT: return UrnType.CHAT;
    case SearchResultType.USER: return UrnType.USER;
    case SearchResultType.CALENDAR_EVENT: return UrnType.CALENDAR_EVENT;
    case SearchResultType.PROJECT: return UrnType.PROJECT;
    case SearchResultType.TASK: return UrnType.TASK;
    case SearchResultType.AGENT: return UrnType.AGENT;
    case SearchResultType.PROMPT: return UrnType.PROMPT;
    case SearchResultType.CHAT_MESSAGE: return UrnType.CHAT_MESSAGE;
    case SearchResultType.ROOM: return UrnType.ROOM;
    default: return UrnType.UNKNOWN;
  }
}

async function flush(): Promise<void> {
  scheduled = false;
  const consumers = pendingByUrn;
  const orgId = pendingOrgId;
  pendingByUrn = new Map();
  pendingOrgId = null;

  if (!orgId || consumers.size === 0) {
    for (const callbacks of consumers.values()) {
      for (const cb of callbacks) cb(null);
    }
    return;
  }

  const urns = Array.from(consumers.keys());
  let resolved: Record<string, {
    title?: string;
    description?: string;
    type: SearchResultType;
    url?: string;
    metadata?: Record<string, string>;
  }> | undefined;

  try {
    const resp = await searchApi.resolveUrns({ organizationId: orgId, urns });
    resolved = resp.resolved;
  } catch {
    resolved = undefined;
  }

  for (const [urn, callbacks] of consumers.entries()) {
    const r = resolved?.[urn];
    let data: UrnPreviewData | null = null;
    if (r) {
      const parsed = parseUrn(urn);
      data = {
        urn,
        title: r.title || getContentTypeLabel(parsed.type),
        description: r.description || '',
        type: searchResultTypeToUrnType(r.type),
        url: r.url,
        updatedAt: r.metadata?.['updated_at'] || undefined,
        metadata: r.metadata,
      };
      previewCache.set(urn, data);
      // Broadcast live state so chips that consume this URN through
      // the module-level emitter (editor NodeViews etc.) wake up.
      publishMentionState(urn, previewDataToLiveState(urn, data));
    } else {
      const parsed = parseUrn(urn);
      data = parsed.isValid
        ? {
            urn,
            title: getContentTypeLabel(parsed.type),
            description: `${parsed.type} content`,
            type: parsed.type,
          }
        : null;
    }
    for (const cb of callbacks) cb(data);
  }
}

/**
 * Convert a resolved ``UrnPreviewData`` into a typed
 * ``MentionLiveState`` patch. Mirrors the metadata-dict mapping in
 * ``MentionStateProvider`` so chip behaviour is identical whether the
 * state arrives via the React provider or the module-level emitter.
 */
function previewDataToLiveState(urn: string, data: UrnPreviewData): MentionLiveState {
  const m = data.metadata ?? {};
  const parsed = parseUrn(urn);
  const state: MentionLiveState = {
    urn,
    title: data.title || undefined,
    description: data.description || undefined,
    updatedAt: m['updated_at'] || undefined,
    updatedByName: m['updated_by_name'] || undefined,
    parentLabel: m['parent_label'] || undefined,
    status: m['urn_status'] === 'DELETED' ? 'deleted' : 'ok',
  };
  if (m['content_tags']) state.contentTags = m['content_tags'].split(',').filter(Boolean);

  switch (parsed.type) {
    case UrnType.TASK:
      state.taskStatus = m['status'] || undefined;
      state.taskDueDate = m['due_date'] || undefined;
      state.taskAssignee = m['assignee_name'] || undefined;
      state.taskPriority = m['priority'] || undefined;
      state.taskPriorityLabel = m['priority_label'] || undefined;
      state.taskPriorityColor = m['priority_color'] || undefined;
      state.taskStatusLabel = m['status_label'] || undefined;
      state.taskStatusColor = m['status_color'] || undefined;
      state.taskType = m['task_type'] || undefined;
      if (m['task_number']) state.taskNumber = parseInt(m['task_number'], 10) || 0;
      state.taskProjectName = m['project_name'] || undefined;
      state.taskProjectSlug = m['project_slug'] || undefined;
      state.taskProjectColor = m['project_color'] || undefined;
      if (m['subtask_completed']) state.taskSubtaskCompleted = parseInt(m['subtask_completed'], 10) || 0;
      if (m['subtask_total']) state.taskSubtaskTotal = parseInt(m['subtask_total'], 10) || 0;
      if (m['blocked_by_count']) state.taskBlockedByCount = parseInt(m['blocked_by_count'], 10) || 0;
      if (m['assignee_ids']) state.taskAssigneeIds = m['assignee_ids'].split(',').filter(Boolean);
      break;
    case UrnType.CALENDAR_EVENT:
      state.eventStartTime = m['start_time'] || undefined;
      state.eventEndTime = m['end_time'] || undefined;
      state.eventIsAllDay = m['is_all_day'] === 'true';
      state.eventLocation = m['location'] || undefined;
      state.eventMeetingUrl = m['meeting_url'] || undefined;
      break;
    case UrnType.FILE:
      state.fileProcessingStatus = (m['processing_status'] || undefined) as MentionLiveState['fileProcessingStatus'];
      state.fileMimeType = m['mime_type'] || undefined;
      if (m['file_size']) state.fileSize = parseInt(m['file_size'], 10) || undefined;
      break;
    case UrnType.NOTE:
      state.noteNodeType = m['node_type'] || undefined;
      break;
    case UrnType.PROJECT:
      if (m['completed_tasks']) state.projectCompletedTasks = parseInt(m['completed_tasks'], 10) || 0;
      if (m['total_tasks']) state.projectTotalTasks = parseInt(m['total_tasks'], 10) || 0;
      if (m['status']) state.projectStatus = m['status'];
      break;
    case UrnType.CHAT:
      state.channelType = m['channel_type'] || undefined;
      if (m['member_count']) state.memberCount = parseInt(m['member_count'], 10) || 0;
      break;
    case UrnType.CHAT_MESSAGE:
      state.channelType = m['channel_type'] || undefined;
      state.chatSenderName = m['sender_name'] || undefined;
      state.chatChannelId = m['channel_id'] || undefined;
      break;
    case UrnType.AGENT:
      state.agentEmoji = m['agent_emoji'] || undefined;
      state.agentThemeColor = m['agent_theme_color'] || undefined;
      break;
    case UrnType.USER:
      state.userAvatarUrl = m['user_avatar_url'] || undefined;
      state.userEmail = m['user_email'] || undefined;
      break;
  }
  return state;
}

export function resolveUrnBatched(
  urn: string,
  organizationId: string,
): Promise<UrnPreviewData | null> {
  const cached = previewCache.get(urn);
  if (cached) return Promise.resolve(cached);

  return new Promise<UrnPreviewData | null>((resolve) => {
    let bucket = pendingByUrn.get(urn);
    if (!bucket) {
      bucket = [];
      pendingByUrn.set(urn, bucket);
    }
    bucket.push(resolve);
    pendingOrgId = organizationId;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
}

export function useBatchedSubjectResolver(): (urn: string) => Promise<UrnPreviewData | null> {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  return useCallback(
    (urn: string) =>
      organizationId ? resolveUrnBatched(urn, organizationId) : Promise.resolve(null),
    [organizationId],
  );
}

export function getCachedPreview(urn: string): UrnPreviewData | undefined {
  return previewCache.get(urn);
}

export function clearPreviewCache(): void {
  previewCache.clear();
}

export function invalidatePreviewCache(urn: string): void {
  previewCache.delete(urn);
}

export function invalidateNotePreviewCache(noteId: string): void {
  previewCache.delete(`urn:uniffy:content:NOTE:${noteId}`);
}

export function getResolvedUrl(urn: string): string | null {
  return previewCache.get(urn)?.url ?? null;
}
