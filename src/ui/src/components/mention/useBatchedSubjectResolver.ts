/** Coalesces concurrent URN-preview lookups into a single bulk `resolveUrns` RPC, flushed on the next microtask. Cache is process-wide. */

import { useCallback } from "react";
import { searchApi } from "@/features/search";
import { membersApi } from "@/features/permissions/api/membersApi";
import { parseUrn, UrnType } from "@/shared/utils/urn";
import {
  SearchResultType,
  UrnAvailability as ProtoUrnAvailability,
} from "@uniffy/proto/search/v1/search_pb";
import { getContentTypeLabel } from "@/config/theme/contentTypes";
import { useAppSelector } from "@/app/hooks";
import {
  onMentionStateChange,
  publishMentionState,
} from "@/components/mention/mentionStateEmitter";
import {
  MentionAvailability,
  type MentionAccessRequestStatus,
  type MentionLiveState,
} from "@/components/mention/types";
import { accessRequestStatusToLiveState } from "@/components/mention/accessRequestState";

export interface UrnPreviewData {
  urn: string;
  title: string;
  description: string;
  type: UrnType;
  url?: string;
  updatedAt?: string;
  createdAt?: string;
  metadata?: Record<string, string>;
  availability: MentionAvailability;
  canRequestAccess: boolean;
  accessRequestId?: string;
  accessRequestStatus?: MentionAccessRequestStatus;
  canRequestAgainAt?: string;
}

const previewCache = new Map<string, UrnPreviewData>();

/**
 * Returns a fresh entry when the patch carries renamed copy, `null` when nothing
 * relevant changed. Stream payloads (snake_case) and emitter payloads (camelCase)
 * both spell these two fields the same way, so one merge serves both.
 */
function mergePreviewChanges(
  cached: UrnPreviewData,
  changes: Partial<MentionLiveState>,
): UrnPreviewData | null {
  const title = typeof changes.title === "string" ? changes.title : undefined;
  const description = typeof changes.description === "string" ? changes.description : undefined;
  const hasAccessRequestId = Object.hasOwn(changes, "accessRequestId");
  const hasAccessRequestStatus = Object.hasOwn(changes, "accessRequestStatus");
  const hasCanRequestAgainAt = Object.hasOwn(changes, "canRequestAgainAt");
  if (
    title === undefined &&
    description === undefined &&
    !hasAccessRequestId &&
    !hasAccessRequestStatus &&
    !hasCanRequestAgainAt
  ) {
    return null;
  }

  const next: UrnPreviewData = {
    ...cached,
    title: title || cached.title,
    description: description ?? cached.description,
    accessRequestId: hasAccessRequestId ? changes.accessRequestId : cached.accessRequestId,
    accessRequestStatus: hasAccessRequestStatus
      ? changes.accessRequestStatus
      : cached.accessRequestStatus,
    canRequestAgainAt: hasCanRequestAgainAt ? changes.canRequestAgainAt : cached.canRequestAgainAt,
  };
  if (
    next.title === cached.title &&
    next.description === cached.description &&
    next.accessRequestId === cached.accessRequestId &&
    next.accessRequestStatus === cached.accessRequestStatus &&
    next.canRequestAgainAt === cached.canRequestAgainAt
  ) {
    return null;
  }
  return next;
}

// Live patches must reach the cache, not just the chips: the hover popover reads
// the cached entry, so an unpatched rename resurfaces on the next hover.
onMentionStateChange((urn, changes, operation) => {
  if (operation === "invalidate") {
    previewCache.delete(urn);
    return;
  }
  const cached = previewCache.get(urn);
  if (!cached) return;
  const next = mergePreviewChanges(cached, changes);
  if (next) previewCache.set(urn, next);
});

let pendingByUrn = new Map<string, Array<(data: UrnPreviewData | null) => void>>();
let pendingOrgId: string | null = null;
let scheduled = false;

function searchResultTypeToUrnType(type: SearchResultType): UrnType {
  switch (type) {
    case SearchResultType.NOTE:
      return UrnType.NOTE;
    case SearchResultType.FILE:
      return UrnType.FILE;
    case SearchResultType.CHAT:
      return UrnType.CHAT;
    case SearchResultType.USER:
      return UrnType.USER;
    case SearchResultType.TEAM:
      return UrnType.TEAM;
    case SearchResultType.CALENDAR_EVENT:
      return UrnType.CALENDAR_EVENT;
    case SearchResultType.PROJECT:
      return UrnType.PROJECT;
    case SearchResultType.TASK:
      return UrnType.TASK;
    case SearchResultType.AGENT:
      return UrnType.AGENT;
    case SearchResultType.CHAT_MESSAGE:
      return UrnType.CHAT_MESSAGE;
    case SearchResultType.ROOM:
      return UrnType.ROOM;
    default:
      return UrnType.UNKNOWN;
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
  let resolved:
    | Record<
        string,
        {
          title?: string;
          description?: string;
          type: SearchResultType;
          url?: string;
          metadata?: Record<string, string>;
          availability: ProtoUrnAvailability;
          canRequestAccess: boolean;
        }
      >
    | undefined;

  try {
    const resp = await searchApi.resolveUrns({ organizationId: orgId, urns });
    resolved = resp.resolved;
  } catch {
    resolved = undefined;
  }

  const restrictedUrns = Object.entries(resolved ?? {})
    .filter(([, result]) => {
      const availability = previewAvailability(
        result.availability,
        result.metadata?.["urn_status"],
      );
      return availability === MentionAvailability.Restricted && result.canRequestAccess;
    })
    .map(([urn]) => urn);
  let requestStatusByUrn = new Map<
    string,
    Awaited<ReturnType<typeof membersApi.getMyAccessRequestStatuses>>["statuses"][number]
  >();
  if (restrictedUrns.length > 0) {
    try {
      const statusResponse = await membersApi.getMyAccessRequestStatuses({
        organizationId: orgId,
        requestedUrns: restrictedUrns,
      });
      requestStatusByUrn = new Map(
        statusResponse.statuses.map((status) => [status.requestedUrn, status]),
      );
    } catch {
      requestStatusByUrn = new Map();
    }
  }

  for (const [urn, callbacks] of consumers.entries()) {
    const r = resolved?.[urn];
    let data: UrnPreviewData | null = null;
    if (r) {
      const parsed = parseUrn(urn);
      const availability = previewAvailability(r.availability, r.metadata?.["urn_status"]);
      const accessRequestState = accessRequestStatusToLiveState(requestStatusByUrn.get(urn));
      data = {
        urn,
        title:
          r.title ||
          (availability === MentionAvailability.Available ? getContentTypeLabel(parsed.type) : ""),
        description: r.description || "",
        type: searchResultTypeToUrnType(r.type),
        url: r.url,
        updatedAt: r.metadata?.["updated_at"] || undefined,
        metadata: r.metadata,
        availability,
        canRequestAccess: r.canRequestAccess,
        accessRequestId: accessRequestState.accessRequestId,
        accessRequestStatus: accessRequestState.accessRequestStatus,
        canRequestAgainAt: accessRequestState.canRequestAgainAt,
      };
      previewCache.set(urn, data);
      // Wake up chips that subscribe via the module-level emitter (e.g. editor NodeViews outside the React provider).
      publishMentionState(urn, previewDataToLiveState(urn, data));
    } else {
      const parsed = parseUrn(urn);
      data = parsed.isValid
        ? {
            urn,
            title: getContentTypeLabel(parsed.type),
            description: `${parsed.type} content`,
            type: parsed.type,
            availability: MentionAvailability.Unavailable,
            canRequestAccess: false,
          }
        : null;
    }
    for (const cb of callbacks) cb(data);
  }
}

/** Mirrors `metadataToLiveState` in MentionStateProvider so chips behave the same via React provider or module emitter. */
function previewDataToLiveState(urn: string, data: UrnPreviewData): MentionLiveState {
  const m = data.metadata ?? {};
  const parsed = parseUrn(urn);
  const state: MentionLiveState = {
    urn,
    title: data.title || undefined,
    description: data.description || undefined,
    updatedAt: m["updated_at"] || undefined,
    updatedByName: m["updated_by_name"] || undefined,
    parentLabel: m["parent_label"] || undefined,
    availability: data.availability,
    canRequestAccess: data.canRequestAccess,
    accessRequestId: data.accessRequestId,
    accessRequestStatus: data.accessRequestStatus,
    canRequestAgainAt: data.canRequestAgainAt,
  };
  if (m["content_tags"]) state.contentTags = m["content_tags"].split(",").filter(Boolean);

  switch (parsed.type) {
    case UrnType.TASK:
      state.taskStatus = m["status"] || undefined;
      state.taskDueDate = m["due_date"] || undefined;
      state.taskAssignee = m["assignee_name"] || undefined;
      state.taskPriority = m["priority"] || undefined;
      state.taskPriorityLabel = m["priority_label"] || undefined;
      state.taskPriorityColor = m["priority_color"] || undefined;
      state.taskStatusLabel = m["status_label"] || undefined;
      state.taskStatusColor = m["status_color"] || undefined;
      state.taskType = m["task_type"] || undefined;
      if (m["task_number"]) state.taskNumber = parseInt(m["task_number"], 10) || 0;
      state.taskProjectName = m["project_name"] || undefined;
      state.taskProjectSlug = m["project_slug"] || undefined;
      state.taskProjectColor = m["project_color"] || undefined;
      if (m["subtask_completed"])
        state.taskSubtaskCompleted = parseInt(m["subtask_completed"], 10) || 0;
      if (m["subtask_total"]) state.taskSubtaskTotal = parseInt(m["subtask_total"], 10) || 0;
      if (m["blocked_by_count"])
        state.taskBlockedByCount = parseInt(m["blocked_by_count"], 10) || 0;
      if (m["assignee_ids"]) state.taskAssigneeIds = m["assignee_ids"].split(",").filter(Boolean);
      break;
    case UrnType.CALENDAR_EVENT:
      state.eventStartTime = m["start_time"] || undefined;
      state.eventEndTime = m["end_time"] || undefined;
      state.eventIsAllDay = m["is_all_day"] === "true";
      state.eventLocation = m["location"] || undefined;
      state.eventMeetingUrl = m["meeting_url"] || undefined;
      state.eventChannelId = m["channel_id"] || undefined;
      state.eventStatus = m["event_status"] || undefined;
      break;
    case UrnType.FILE:
      state.fileProcessingStatus = (m["processing_status"] ||
        undefined) as MentionLiveState["fileProcessingStatus"];
      state.fileMimeType = m["mime_type"] || undefined;
      if (m["file_size"]) state.fileSize = parseInt(m["file_size"], 10) || undefined;
      break;
    case UrnType.NOTE:
      state.noteNodeType = m["node_type"] || undefined;
      if (m["child_count"]) state.noteChildCount = parseInt(m["child_count"], 10) || 0;
      break;
    case UrnType.FOLDER:
      if (m["file_count"]) state.folderFileCount = parseInt(m["file_count"], 10) || 0;
      if (m["folder_count"]) state.folderSubfolderCount = parseInt(m["folder_count"], 10) || 0;
      if (m["total_size"]) state.folderTotalSize = parseInt(m["total_size"], 10) || 0;
      break;
    case UrnType.ROOM:
      state.roomType = m["room_type"] || undefined;
      if (m["capacity"]) state.roomCapacity = parseInt(m["capacity"], 10) || 0;
      state.roomBuilding = m["building"] || undefined;
      state.roomFloor = m["floor"] || undefined;
      state.roomLocation = m["location"] || undefined;
      state.roomAmenities = m["amenities"] || undefined;
      break;
    case UrnType.PROJECT:
      if (m["completed_tasks"])
        state.projectCompletedTasks = parseInt(m["completed_tasks"], 10) || 0;
      if (m["total_tasks"]) state.projectTotalTasks = parseInt(m["total_tasks"], 10) || 0;
      if (m["status"]) state.projectStatus = m["status"];
      break;
    case UrnType.CHAT:
      state.channelType = m["channel_type"] || undefined;
      if (m["member_count"]) state.memberCount = parseInt(m["member_count"], 10) || 0;
      break;
    case UrnType.CHAT_MESSAGE:
      state.channelType = m["channel_type"] || undefined;
      state.chatSenderName = m["sender_name"] || undefined;
      state.chatChannelId = m["channel_id"] || undefined;
      break;
    case UrnType.AGENT:
      state.agentEmoji = m["agent_emoji"] || undefined;
      state.agentThemeColor = m["agent_theme_color"] || undefined;
      break;
    case UrnType.TEAM:
      if (m["member_count"]) state.teamMemberCount = parseInt(m["member_count"], 10) || 0;
      break;
    case UrnType.USER:
      state.userAvatarUrl = m["user_avatar_url"] || m["avatar_url"] || undefined;
      state.userEmail = m["user_email"] || undefined;
      state.userJobTitle = m["job_title"] || undefined;
      state.userDepartment = m["department"] || undefined;
      state.userTeamName = m["team_name"] || undefined;
      state.userTimezone = m["timezone"] || undefined;
      break;
    case UrnType.TAG:
      state.tagColor = m["color"] || undefined;
      state.tagSlug = m["slug"] || undefined;
      if (m["usage_count"]) state.tagUsageCount = parseInt(m["usage_count"], 10) || 0;
      if (m["usage_count_by_domain"])
        state.tagUsageByDomain = parseTagDomainBreakdown(m["usage_count_by_domain"]);
      if (m["recent_assignment_urns"])
        state.tagRecentAssignmentUrns = m["recent_assignment_urns"].split("|").filter(Boolean);
      if (m["recent_assignment_at"])
        state.tagRecentAssignmentAt = m["recent_assignment_at"].split("|");
      if (m["user_assignment_count"])
        state.tagUserAssignmentCount = parseInt(m["user_assignment_count"], 10) || 0;
      break;
  }
  return state;
}

function previewAvailability(
  availability: ProtoUrnAvailability,
  compatibilityStatus?: string,
): MentionAvailability {
  switch (availability) {
    case ProtoUrnAvailability.RESTRICTED:
      return MentionAvailability.Restricted;
    case ProtoUrnAvailability.DELETED:
      return MentionAvailability.Deleted;
    case ProtoUrnAvailability.UNAVAILABLE:
      return MentionAvailability.Unavailable;
    case ProtoUrnAvailability.AVAILABLE:
      return MentionAvailability.Available;
    default:
      return compatibilityStatus === "DELETED"
        ? MentionAvailability.Deleted
        : MentionAvailability.Available;
  }
}

function parseTagDomainBreakdown(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of raw.split("|")) {
    const [k, v] = pair.split(":");
    if (!k) continue;
    const n = parseInt(v ?? "", 10);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function resolveUrnBatched(
  urn: string,
  organizationId: string,
  options?: { force?: boolean },
): Promise<UrnPreviewData | null> {
  if (options?.force) previewCache.delete(urn);
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
