/**
 * Live Mention State Types
 *
 * Type definitions for the live mention system. Each content type
 * carries its own state shape that drives inline status indicators.
 */


/** Task status - uses the project's status field IDs (e.g. "status_todo", "status_done") */
export type TaskStatus = string;

/** File processing status */
export type FileProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

/** Live state payload - type-specific fields that update in real-time */
export interface MentionLiveState {
  urn: string;
  title?: string;
  updatedAt?: string;
  updatedByName?: string;

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

  // FILE
  fileProcessingStatus?: FileProcessingStatus;
  fileMimeType?: string;
  fileSize?: number;

  // NOTE
  noteIsBeingEdited?: boolean;
  noteEditorName?: string;
  noteNodeType?: string;

  // PROJECT
  projectCompletedTasks?: number;
  projectTotalTasks?: number;
  projectStatus?: string;

  // GROUP / CHAT
  memberCount?: number;
  unreadCount?: number;
  channelType?: string;

  // AGENT
  agentEmoji?: string;
  agentThemeColor?: string;

  // USER
  userAvatarUrl?: string;
  userEmail?: string;

  // Shared
  contentTags?: string[];
}

/** State change event from the streaming system */
export interface MentionStateChangeEvent {
  urn: string;
  changes: Partial<MentionLiveState>;
}

/** Props shared by all chip variants */
export interface MentionChipBaseProps {
  urn: string;
  label: string;
  selected?: boolean;
}

/** Full chip props (with click, embed, live state) */
export interface MentionChipProps extends MentionChipBaseProps {
  onClick?: (e?: React.MouseEvent) => void;
  onReplaceWithMedia?: (mediaType: 'image' | 'video' | 'audio', url: string, title: string) => void;
  liveState?: MentionLiveState | null;
}

/** Basic chip props (no Redux, no live state) */
export type MentionChipBasicProps = MentionChipBaseProps;

/** Compact chip props */
export interface MentionChipCompactProps extends MentionChipBaseProps {
  onClick?: (e?: React.MouseEvent) => void;
  liveState?: MentionLiveState | null;
}

/** Check if a task status represents completion */
function isCompletedStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return lower.includes('done') || lower.includes('complete') || lower.includes('closed');
}

/** Check if a status represents completion - used in MentionChip for strikethrough */
export function isTaskDoneStatus(status: string | undefined): boolean {
  if (!status) return false;
  return isCompletedStatus(status);
}
