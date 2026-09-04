import { parseUrn, UrnType } from "@/shared/utils/urn";
import { MentionAvailability, type MentionLiveState } from "@/components/mention/types";
import {
  UrnAvailability as ProtoUrnAvailability,
  type UrnMetadata,
} from "@uniffy/proto/search/v1/search_pb";

export function metadataToLiveState(urn: string, meta: UrnMetadata): MentionLiveState {
  const parsed = parseUrn(urn);
  const m = meta.metadata ?? {};

  const state: MentionLiveState = {
    urn,
    title: meta.title || undefined,
    description: meta.description || undefined,
    updatedAt: m.updated_at || undefined,
    updatedByName: m.updated_by_name || undefined,
    parentLabel: m.parent_label || undefined,
    availability: mentionAvailabilityFromProto(meta.availability, meta.urnStatus || m.urn_status),
    canRequestAccess: meta.canRequestAccess,
  };

  if (meta.contentTags?.length) state.contentTags = [...meta.contentTags];

  switch (parsed.type) {
    case UrnType.TASK:
      if (m.status || meta.status)
        state.taskStatus = (meta.status || m.status) as MentionLiveState["taskStatus"];
      if (m.due_date || meta.dueDate) state.taskDueDate = meta.dueDate || m.due_date;
      if (m.assignee_name || meta.assigneeName)
        state.taskAssignee = meta.assigneeName || m.assignee_name;
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
      state.eventIsAllDay = meta.eventIsAllDay || m.is_all_day === "true";
      state.eventLocation = meta.eventLocation || undefined;
      state.eventMeetingUrl = meta.eventMeetingUrl || undefined;
      state.eventChannelId = meta.eventChannelId || undefined;
      state.eventStatus = meta.eventStatus || m.event_status || undefined;
      break;

    case UrnType.FILE:
      if (m.processing_status || meta.processingStatus)
        state.fileProcessingStatus = (meta.processingStatus ||
          m.processing_status) as MentionLiveState["fileProcessingStatus"];
      state.fileMimeType = meta.fileMimeType || m.mime_type || undefined;
      if (meta.fileSize) state.fileSize = Number(meta.fileSize) || undefined;
      else if (m.size) state.fileSize = parseInt(m.size, 10) || undefined;
      break;

    case UrnType.NOTE:
      state.noteNodeType = meta.noteNodeType || undefined;
      if (m.child_count) state.noteChildCount = parseInt(m.child_count, 10) || 0;
      break;

    case UrnType.FOLDER:
      if (m.file_count) state.folderFileCount = parseInt(m.file_count, 10) || 0;
      if (m.folder_count) state.folderSubfolderCount = parseInt(m.folder_count, 10) || 0;
      if (m.total_size) state.folderTotalSize = parseInt(m.total_size, 10) || 0;
      break;

    case UrnType.ROOM:
      state.roomType = m.room_type || undefined;
      if (m.capacity) state.roomCapacity = parseInt(m.capacity, 10) || 0;
      state.roomBuilding = m.building || undefined;
      state.roomFloor = m.floor || undefined;
      state.roomLocation = m.location || undefined;
      state.roomAmenities = m.amenities || undefined;
      break;

    case UrnType.PROJECT:
      if (meta.completedTasks || m.completed_tasks)
        state.projectCompletedTasks = meta.completedTasks || parseInt(m.completed_tasks, 10) || 0;
      if (meta.totalTasks || m.total_tasks)
        state.projectTotalTasks = meta.totalTasks || parseInt(m.total_tasks, 10) || 0;
      if (meta.status || m.status) state.projectStatus = meta.status || m.status;
      break;

    case UrnType.CHAT:
      state.channelType = meta.channelType || undefined;
      if (meta.memberCount || m.member_count)
        state.memberCount = meta.memberCount || parseInt(m.member_count, 10) || 0;
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

    case UrnType.TEAM:
      if (m.member_count) state.teamMemberCount = parseInt(m.member_count, 10) || 0;
      break;

    case UrnType.USER:
      state.userAvatarUrl = meta.userAvatarUrl || undefined;
      state.userEmail = meta.userEmail || undefined;
      state.userJobTitle = m.job_title || undefined;
      state.userDepartment = m.department || undefined;
      state.userTeamName = m.team_name || undefined;
      state.userTimezone = m.timezone || undefined;
      break;

    case UrnType.TAG:
      state.tagColor = m.color || undefined;
      state.tagSlug = m.slug || undefined;
      if (m.usage_count) state.tagUsageCount = parseInt(m.usage_count, 10) || 0;
      if (m.usage_count_by_domain)
        state.tagUsageByDomain = parseTagDomainBreakdown(m.usage_count_by_domain);
      if (m.recent_assignment_urns)
        state.tagRecentAssignmentUrns = m.recent_assignment_urns.split("|").filter(Boolean);
      if (m.recent_assignment_at) state.tagRecentAssignmentAt = m.recent_assignment_at.split("|");
      if (m.user_assignment_count)
        state.tagUserAssignmentCount = parseInt(m.user_assignment_count, 10) || 0;
      break;
  }

  return state;
}

export function mentionAvailabilityFromProto(
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

/** Decodes the pipe/colon serialised per-domain breakdown (e.g. `NOTE:12|FILE:3`). */
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

/** Translates snake_case stream payloads into the camelCase keys chip components read. */
export function streamChangesToLiveState(
  changes: Record<string, string>,
): Partial<MentionLiveState> {
  const patch: Partial<MentionLiveState> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const value = raw ?? "";
    switch (key) {
      case "title":
        patch.title = value || undefined;
        break;
      case "description":
        patch.description = value || undefined;
        break;
      case "updated_at":
        patch.updatedAt = value || undefined;
        break;
      case "updated_by_name":
        patch.updatedByName = value || undefined;
        break;
      case "urn_status":
        patch.availability =
          value === "DELETED" ? MentionAvailability.Deleted : MentionAvailability.Available;
        break;
      case "availability":
        patch.availability = mentionAvailabilityFromStream(value);
        break;
      case "parent_label":
        patch.parentLabel = value || undefined;
        break;

      case "status":
        patch.taskStatus = value || undefined;
        patch.projectStatus = value || undefined;
        break;
      case "due_date":
        patch.taskDueDate = value || undefined;
        break;
      case "assignee_name":
        patch.taskAssignee = value || undefined;
        break;
      case "priority":
        patch.taskPriority = value || undefined;
        break;
      case "priority_label":
        patch.taskPriorityLabel = value || undefined;
        break;
      case "priority_color":
        patch.taskPriorityColor = value || undefined;
        break;
      case "status_label":
        patch.taskStatusLabel = value || undefined;
        break;
      case "status_color":
        patch.taskStatusColor = value || undefined;
        break;
      case "task_type":
        patch.taskType = value || undefined;
        break;
      case "project_name":
        patch.taskProjectName = value || undefined;
        break;
      case "project_slug":
        patch.taskProjectSlug = value || undefined;
        break;
      case "project_color":
        patch.taskProjectColor = value || undefined;
        break;
      case "assignee_ids":
        patch.taskAssigneeIds = value ? value.split(",").filter(Boolean) : undefined;
        break;

      case "start_time":
        patch.eventStartTime = value || undefined;
        break;
      case "end_time":
        patch.eventEndTime = value || undefined;
        break;
      case "is_all_day":
        patch.eventIsAllDay = value === "true";
        break;
      // Shared by CALENDAR_EVENT and ROOM; each chip type reads only its own field.
      case "location":
        patch.eventLocation = value || undefined;
        patch.roomLocation = value || undefined;
        break;
      case "meeting_url":
        patch.eventMeetingUrl = value || undefined;
        break;
      case "event_status":
        patch.eventStatus = value || undefined;
        break;

      case "processing_status":
        patch.fileProcessingStatus = (value ||
          undefined) as MentionLiveState["fileProcessingStatus"];
        break;
      case "mime_type":
        patch.fileMimeType = value || undefined;
        break;
      case "file_size":
        patch.fileSize = value ? parseInt(value, 10) || undefined : undefined;
        break;

      case "node_type":
        patch.noteNodeType = value || undefined;
        break;
      case "child_count":
        patch.noteChildCount = value ? parseInt(value, 10) || 0 : 0;
        break;

      case "file_count":
        patch.folderFileCount = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "folder_count":
        patch.folderSubfolderCount = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "total_size":
        patch.folderTotalSize = value ? parseInt(value, 10) || 0 : 0;
        break;

      case "room_type":
        patch.roomType = value || undefined;
        break;
      case "capacity":
        patch.roomCapacity = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "building":
        patch.roomBuilding = value || undefined;
        break;
      case "floor":
        patch.roomFloor = value || undefined;
        break;
      case "amenities":
        patch.roomAmenities = value || undefined;
        break;

      case "completed_tasks":
        patch.projectCompletedTasks = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "total_tasks":
        patch.projectTotalTasks = value ? parseInt(value, 10) || 0 : 0;
        break;

      // CHAT + TEAM share the key; each chip type reads only its own field.
      case "channel_type":
        patch.channelType = value || undefined;
        break;
      case "member_count":
        patch.memberCount = value ? parseInt(value, 10) || 0 : 0;
        patch.teamMemberCount = value ? parseInt(value, 10) || 0 : 0;
        break;

      case "sender_name":
        patch.chatSenderName = value || undefined;
        break;
      case "channel_id":
        patch.chatChannelId = value || undefined;
        break;

      case "user_email":
        patch.userEmail = value || undefined;
        break;
      case "job_title":
        patch.userJobTitle = value || undefined;
        break;
      case "department":
        patch.userDepartment = value || undefined;
        break;
      case "team_name":
        patch.userTeamName = value || undefined;
        break;
      case "timezone":
        patch.userTimezone = value || undefined;
        break;

      case "slug":
        patch.tagSlug = value || undefined;
        break;
      case "color":
        patch.tagColor = value || undefined;
        break;
      case "usage_count":
        patch.tagUsageCount = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "usage_count_by_domain":
        patch.tagUsageByDomain = parseTagDomainBreakdown(value);
        break;
      case "recent_assignment_urns":
        patch.tagRecentAssignmentUrns = value ? value.split("|").filter(Boolean) : [];
        break;
      case "recent_assignment_at":
        patch.tagRecentAssignmentAt = value ? value.split("|") : [];
        break;
      case "user_assignment_count":
        patch.tagUserAssignmentCount = value ? parseInt(value, 10) || 0 : 0;
        break;
      case "tag_assignments_added":
        patch.tagAssignmentsAdded = value ? value.split(",").filter(Boolean) : [];
        break;
      case "tag_assignments_removed":
        patch.tagAssignmentsRemoved = value ? value.split(",").filter(Boolean) : [];
        break;

      default:
        break;
    }
  }
  return patch;
}

function mentionAvailabilityFromStream(value: string): MentionAvailability {
  switch (value) {
    case "RESTRICTED":
      return MentionAvailability.Restricted;
    case "DELETED":
      return MentionAvailability.Deleted;
    case "UNAVAILABLE":
      return MentionAvailability.Unavailable;
    default:
      return MentionAvailability.Available;
  }
}
