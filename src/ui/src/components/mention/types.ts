import type { UrnMetadata } from "@uniffy/proto/search/v1/search_pb";

/** Task status IDs come from the project's configurable status field (e.g. "status_todo"). */
export type TaskStatus = string;

export type FileProcessingStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

export enum MentionAvailability {
  Available = "available",
  Restricted = "restricted",
  Deleted = "deleted",
  Unavailable = "unavailable",
}

export enum MentionAccessRequestStatus {
  Pending = "pending",
  Approved = "approved",
  Denied = "denied",
  Canceled = "canceled",
}

export interface MentionLiveState {
  urn: string;
  title?: string;
  /** Stripped, indexed snippet (~200 chars). Source of truth for the
   *  expanded card body so chips do not need a second hover-fetch. */
  description?: string;
  updatedAt?: string;
  updatedByName?: string;

  availability?: MentionAvailability;
  canRequestAccess?: boolean;
  accessRequestId?: string;
  accessRequestStatus?: MentionAccessRequestStatus;
  canRequestAgainAt?: string;

  // TASK
  taskStatus?: TaskStatus;
  taskDueDate?: string;
  taskAssignee?: string;
  taskPriority?: string;
  taskPriorityLabel?: string;
  taskPriorityColor?: string;
  taskStatusLabel?: string;
  taskStatusColor?: string;
  taskType?: string;
  taskNumber?: number;
  taskProjectName?: string;
  taskProjectSlug?: string;
  taskProjectColor?: string;
  taskSubtaskCompleted?: number;
  taskSubtaskTotal?: number;
  taskBlockedByCount?: number;
  taskAssigneeIds?: string[];

  // CALENDAR_EVENT
  eventStartTime?: string;
  eventEndTime?: string;
  eventIsAllDay?: boolean;
  eventLocation?: string;
  eventMeetingUrl?: string;
  eventChannelId?: string;

  // FILE
  fileProcessingStatus?: FileProcessingStatus;
  fileMimeType?: string;
  fileSize?: number;

  // NOTE
  noteIsBeingEdited?: boolean;
  noteEditorName?: string;
  noteNodeType?: string;
  /** Direct child notes; only present for FOLDER node_type notes. */
  noteChildCount?: number;

  // FOLDER (direct-children stats, denormalized at index time)
  folderFileCount?: number;
  folderSubfolderCount?: number;
  folderTotalSize?: number;

  // ROOM
  roomType?: string;
  roomCapacity?: number;
  roomBuilding?: string;
  roomFloor?: string;
  roomLocation?: string;
  /** Pre-joined display string, capped server-side. */
  roomAmenities?: string;

  // PROJECT
  projectCompletedTasks?: number;
  projectTotalTasks?: number;
  projectStatus?: string;

  // GROUP / CHAT
  memberCount?: number;
  unreadCount?: number;
  channelType?: string;

  // CHAT_MESSAGE -- message author + parent channel (channel name lives
  // in `parentLabel`, channel id in `chatChannelId` for navigation).
  chatSenderName?: string;
  chatChannelId?: string;

  /** Parent container name -- chat category, file folder, note folder.
   *  Rendered as a breadcrumb in the expanded card's meta row. */
  parentLabel?: string;

  // AGENT
  agentEmoji?: string;
  agentThemeColor?: string;

  // TEAM (parent team name rides the generic parentLabel)
  teamMemberCount?: number;

  // USER
  userAvatarUrl?: string;
  userEmail?: string;
  userJobTitle?: string;
  userDepartment?: string;
  userTeamName?: string;
  /** IANA zone from the people profile; drives the "It's 07:13 for Maria" hover row. */
  userTimezone?: string;

  // TAG
  /** Hex / palette slug used for the tag chip swatch (already stored on tag). */
  tagColor?: string;
  /** Tag slug, used for the "Open in /tags" deep link. */
  tagSlug?: string;
  /** Org-wide assignment count denormalized at index time. */
  tagUsageCount?: number;
  /** Per-domain breakdown -- ContentType.value -> count. */
  tagUsageByDomain?: Record<string, number>;
  /** Top recent assignment URNs (capped at 5 server-side, newest first). */
  tagRecentAssignmentUrns?: string[];
  /** Parallel to tagRecentAssignmentUrns -- ISO timestamps. */
  tagRecentAssignmentAt?: string[];
  /** "You tagged N of these" -- per-user, computed at resolve time. */
  tagUserAssignmentCount?: number;

  /**
   * Transient delta for content URN events. Carries the tag IDs that
   * were just added / removed on a piece of content via the realtime
   * stream. Subscribers (the tags slice realtime hook) read these to
   * patch ``state.tags.assignmentsByUrn``; nothing reads them on the
   * chip preview side. Not denormalized, never persisted in the index.
   */
  tagAssignmentsAdded?: string[];
  tagAssignmentsRemoved?: string[];

  // Shared
  contentTags?: string[];
}

export interface MentionStateChangeEvent {
  urn: string;
  changes: Partial<MentionLiveState>;
}

export interface MentionChipBaseProps {
  urn: string;
  label: string;
  selected?: boolean;
}

export interface MentionChipProps extends MentionChipBaseProps {
  onClick?: (e?: React.MouseEvent) => void;
  onReplaceWithMedia?: (mediaType: "image" | "video" | "audio", url: string, title: string) => void;
  liveState?: MentionLiveState | null;
  resolvedMetadata?: UrnMetadata;
  /** Always render the expanded card, ignoring the mentionDisplay setting and per-chip toggles. */
  forceExpanded?: boolean;
}

export interface MentionChipCompactProps extends MentionChipBaseProps {
  onClick?: (e?: React.MouseEvent) => void;
  liveState?: MentionLiveState | null;
}

function isCompletedStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return lower.includes("done") || lower.includes("complete") || lower.includes("closed");
}

export function isTaskDoneStatus(status: string | undefined): boolean {
  if (!status) return false;
  return isCompletedStatus(status);
}
