// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  CalendarDots,
  Warning,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatRelativeTime, formatDateShort, isOverdue } from '@/shared/utils/dateFormatting';
import { getTaskTypeConfig } from '@/features/projects/utils/taskTypes';
import { isTaskDoneStatus } from '@/components/mention/types';
import { SubjectAvatarStack } from '@/components/subject';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import type { MentionLiveState } from '@/components/mention/types';

interface TaskMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function TaskMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: TaskMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const isDone = isTaskDoneStatus(liveState.taskStatus);
  const taskTypeConfig = getTaskTypeConfig(liveState.taskType || 'task');
  const TaskTypeIcon = taskTypeConfig.icon;
  const hasSubtasks = (liveState.taskSubtaskTotal ?? 0) > 0;
  const subtaskPct = hasSubtasks
    ? Math.round(((liveState.taskSubtaskCompleted ?? 0) / liveState.taskSubtaskTotal!) * 100)
    : 0;
  const isBlocked = (liveState.taskBlockedByCount ?? 0) > 0;
  const dueDateOverdue = liveState.taskDueDate ? isOverdue(liveState.taskDueDate) : false;

  const { subjects: assigneeSubjects } = useSubjectResolver(liveState.taskAssigneeIds ?? []);

  const statusColor = liveState.taskStatusColor || '#6b7280';
  const priorityColor = liveState.taskPriorityColor;

  const taskId = liveState.taskProjectSlug && liveState.taskNumber
    ? `${liveState.taskProjectSlug}-${liveState.taskNumber}`
    : null;

  return (
    <>
      {/* Task identifier row */}
      <span className="block relative px-4 pr-10 pt-3 pb-1.5 pl-5">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-muted-foreground min-w-0">
            <TaskTypeIcon size={13} weight="duotone" className="shrink-0" />
            {taskId && (
              <span className="text-[11px] font-mono font-medium tracking-wide">
                {taskId}
              </span>
            )}
          </span>

          {/* Status badge */}
          {liveState.taskStatusLabel && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0"
              style={{
                backgroundColor: `${statusColor}20`,
                color: statusColor,
              }}
            >
              {isDone && <Check size={9} weight="bold" className="shrink-0" />}
              {liveState.taskStatusLabel}
            </span>
          )}
        </span>
      </span>

      {/* Title */}
      <span className="block px-4 pb-2 pl-5">
        <span className={cn(
          'block font-semibold text-sm leading-snug line-clamp-2',
          isDone && 'line-through text-muted-foreground',
        )}>
          {title}
        </span>
      </span>

      {/* Description preview */}
      {description && !isDone && (
        <span className="block px-4 pb-2 pl-5">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {description}
          </span>
        </span>
      )}

      {/* Metadata grid */}
      <span className="grid px-4 pb-2.5 pl-5 grid-cols-2 gap-x-4 gap-y-1.5">
        {/* Priority */}
        {liveState.taskPriorityLabel && priorityColor && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: priorityColor }}
            />
            <span className="text-xs text-muted-foreground truncate">
              {liveState.taskPriorityLabel}
            </span>
          </span>
        )}

        {/* Due date */}
        {liveState.taskDueDate && (
          <span className="flex items-center gap-1.5">
            <CalendarDots
              size={12}
              weight="duotone"
              className={cn(
                'shrink-0',
                dueDateOverdue && !isDone ? 'text-red-500' : 'text-muted-foreground',
              )}
            />
            <span className={cn(
              'text-xs truncate',
              dueDateOverdue && !isDone
                ? 'text-red-600 dark:text-red-400 font-medium'
                : 'text-muted-foreground',
            )}>
              {formatDateShort(liveState.taskDueDate)}
            </span>
          </span>
        )}

        {/* Assignees */}
        {assigneeSubjects.length > 0 && (
          <span className="flex items-center gap-1.5">
            <SubjectAvatarStack subjectIds={liveState.taskAssigneeIds ?? []} maxDisplay={3} size="xs" />
            {assigneeSubjects.length === 1 && (
              <span className="text-xs text-muted-foreground truncate">
                {assigneeSubjects[0].name}
              </span>
            )}
          </span>
        )}

        {/* Project */}
        {liveState.taskProjectName && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: liveState.taskProjectColor || '#3b82f6' }}
            />
            <span className="text-xs text-muted-foreground truncate">
              {liveState.taskProjectName}
            </span>
          </span>
        )}
      </span>

      {/* Progress indicators */}
      {(hasSubtasks || isBlocked) && (
        <span className="flex px-4 pb-2.5 pl-5 items-center gap-3">
          {/* Subtask progress bar */}
          {hasSubtasks && (
            <span className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="block flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <span
                  className="block h-full rounded-full bg-teal-500 transition-all duration-500 ease-out"
                  style={{ width: `${subtaskPct}%` }}
                />
              </span>
              <span className="text-[10px] text-muted-foreground font-medium tabular-nums shrink-0">
                {liveState.taskSubtaskCompleted}/{liveState.taskSubtaskTotal}
              </span>
            </span>
          )}

          {/* Blocked badge */}
          {isBlocked && (
            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-px bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-medium shrink-0">
              <Warning size={10} weight="fill" className="shrink-0" />
              Blocked by {liveState.taskBlockedByCount}
            </span>
          )}
        </span>
      )}

      {/* Footer */}
      <span className="flex px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(liveState.updatedAt) || 'No date'}</span>
          {liveState.updatedByName && (
            <>
              <span className="text-muted-foreground/40">.</span>
              <span className="truncate max-w-[80px]">{liveState.updatedByName}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy URN"
          >
            {copied ? (
              <Check size={12} weight="bold" className="text-green-500" />
            ) : (
              <CopySimple size={12} weight="bold" />
            )}
          </button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </span>
        </span>
      </span>
    </>
  );
}
