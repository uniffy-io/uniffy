/**
 * Live Mention System - Public API
 *
 * Shared mention components used across the entire app.
 * All mention rendering flows through these components.
 */

export { MentionChip, MentionChipCompact, MentionChipBasic } from '@/components/mention/MentionChip';
export { MentionPreview } from '@/components/mention/MentionPreview';
export {
  LiveIndicator,
  TaskStatusIndicator,
  CalendarTemporalIndicator,
  NoteEditingIndicator,
  FileProcessingIndicator,
  ProjectProgressIndicator,
} from '@/components/mention/LiveIndicators';
export { MentionStateProvider } from '@/components/mention/MentionStateProvider';
export { useMentionState } from '@/components/mention/useMentionState';
export {
  emitMentionStateChange,
  getMentionState,
} from '@/components/mention/mentionStateEmitter';
export { isTaskDoneStatus } from '@/components/mention/types';
export type {
  MentionLiveState,
  MentionStateChangeEvent,
  MentionChipProps,
  MentionChipBasicProps,
  MentionChipCompactProps,
  TaskStatus,
  FileProcessingStatus,
} from '@/components/mention/types';
