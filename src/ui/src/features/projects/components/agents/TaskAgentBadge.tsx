import { SubjectAvatar, SUBJECT_TYPE } from "@/components/subject";
import { cn } from "@/shared/utils/cn";
import type { TaskAgentAssignment, TaskAgentRunStatus } from "@/features/projects/types/project";
import { agentRunStatusLabel } from "@/features/projects/utils/agentRuns";

const STATUS_DOT: Record<TaskAgentRunStatus, string> = {
  waiting: "bg-muted-foreground",
  pending: "bg-muted-foreground",
  running: "bg-primary animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
  stopped: "bg-muted-foreground",
  skipped: "bg-yellow-500",
  uncertain: "bg-yellow-500",
};

interface TaskAgentBadgeProps {
  assignment: TaskAgentAssignment;
  size?: "xs" | "sm";
  showLabel?: boolean;
  className?: string;
}

/** The agent working a task, with a dot for the state of its run. */
export function TaskAgentBadge({
  assignment,
  size = "xs",
  showLabel = false,
  className,
}: TaskAgentBadgeProps) {
  const label = `${assignment.agentName}: ${agentRunStatusLabel(assignment)}`;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 min-w-0", className)}
      title={label}
      data-testid="task-agent-badge"
      data-status={assignment.status}
    >
      <span className="relative inline-flex shrink-0">
        <SubjectAvatar
          subject={{
            id: assignment.agentId,
            type: SUBJECT_TYPE.AGENT,
            name: assignment.agentName,
            avatarEmoji: assignment.agentAvatarEmoji ?? undefined,
          }}
          size={size}
        />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-surface",
            STATUS_DOT[assignment.status],
          )}
        />
      </span>
      {showLabel && (
        <span className="truncate text-sm">
          <span className="text-foreground">{assignment.agentName}</span>
          <span className="text-muted-foreground"> · {agentRunStatusLabel(assignment)}</span>
        </span>
      )}
    </span>
  );
}
