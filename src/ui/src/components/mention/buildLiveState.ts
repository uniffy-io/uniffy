import type { MentionLiveState } from '@/components/mention/types';

export function buildLiveStateFromMetadata(
  urn: string,
  title: string | undefined,
  metadata: Record<string, string>,
): MentionLiveState {
  const state: MentionLiveState = {
    urn,
    title: title || undefined,
    updatedAt: metadata.updated_at || undefined,
    updatedByName: metadata.updated_by_name || undefined,
  };

  if (metadata.status) state.taskStatus = metadata.status;
  if (metadata.due_date) state.taskDueDate = metadata.due_date;
  if (metadata.assignee_name) state.taskAssignee = metadata.assignee_name;
  if (metadata.priority) state.taskPriority = metadata.priority;
  if (metadata.priority_label) state.taskPriorityLabel = metadata.priority_label;
  if (metadata.priority_color) state.taskPriorityColor = metadata.priority_color;
  if (metadata.status_label) state.taskStatusLabel = metadata.status_label;
  if (metadata.status_color) state.taskStatusColor = metadata.status_color;
  if (metadata.task_type) state.taskType = metadata.task_type;
  if (metadata.task_number) state.taskNumber = parseInt(metadata.task_number, 10) || undefined;
  if (metadata.project_name) state.taskProjectName = metadata.project_name;
  if (metadata.project_slug) state.taskProjectSlug = metadata.project_slug;
  if (metadata.project_color) state.taskProjectColor = metadata.project_color;
  if (metadata.subtask_completed) state.taskSubtaskCompleted = parseInt(metadata.subtask_completed, 10) || 0;
  if (metadata.subtask_total) state.taskSubtaskTotal = parseInt(metadata.subtask_total, 10) || 0;
  if (metadata.blocked_by_count) state.taskBlockedByCount = parseInt(metadata.blocked_by_count, 10) || 0;
  if (metadata.assignee_ids) state.taskAssigneeIds = metadata.assignee_ids.split(',').filter(Boolean);

  if (metadata.start_time) state.eventStartTime = metadata.start_time;
  if (metadata.end_time) state.eventEndTime = metadata.end_time;
  if (metadata.is_all_day) state.eventIsAllDay = metadata.is_all_day === 'true';
  if (metadata.location) state.eventLocation = metadata.location;
  if (metadata.meeting_url) state.eventMeetingUrl = metadata.meeting_url;

  if (metadata.processing_status) state.fileProcessingStatus = metadata.processing_status as MentionLiveState['fileProcessingStatus'];
  if (metadata.mime_type) state.fileMimeType = metadata.mime_type;
  if (metadata.file_size) state.fileSize = parseInt(metadata.file_size, 10) || undefined;

  if (metadata.node_type) state.noteNodeType = metadata.node_type;

  if (metadata.parent_label) state.parentLabel = metadata.parent_label;

  if (metadata.channel_type) state.channelType = metadata.channel_type;
  if (metadata.member_count) {
    state.memberCount = parseInt(metadata.member_count, 10) || 0;
    state.teamMemberCount = parseInt(metadata.member_count, 10) || 0;
  }

  if (metadata.agent_emoji) state.agentEmoji = metadata.agent_emoji;
  if (metadata.agent_theme_color) state.agentThemeColor = metadata.agent_theme_color;

  if (metadata.user_avatar_url) state.userAvatarUrl = metadata.user_avatar_url;
  if (metadata.user_email) state.userEmail = metadata.user_email;
  if (metadata.job_title) state.userJobTitle = metadata.job_title;
  if (metadata.department) state.userDepartment = metadata.department;
  if (metadata.team_name) state.userTeamName = metadata.team_name;

  if (metadata.completed_tasks) state.projectCompletedTasks = parseInt(metadata.completed_tasks, 10) || 0;
  if (metadata.total_tasks) state.projectTotalTasks = parseInt(metadata.total_tasks, 10) || 0;
  if (metadata.status && !metadata.task_type) state.projectStatus = metadata.status;

  return state;
}
