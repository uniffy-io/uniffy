import { useCallback, useRef, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { SubjectAvatarStack, SubjectPicker } from "@/components/subject";
import { useAssigneePinnedOptions } from "@/features/projects/hooks/useAssigneePinnedOptions";
import { useAgentAssigneeSection } from "@/features/projects/hooks/useAgentAssigneeSection";
import { TaskAgentBadge } from "@/features/projects/components/agents/TaskAgentBadge";
import { assignTaskAgent } from "@/features/projects/store/taskAgentsThunks";
import { promptAgentStart } from "@/features/projects/store/taskAgentsSlice";
import type { Task } from "@/features/projects/types/project";
import { cn } from "@/shared/utils/cn";

interface AssigneeFieldProps {
  assigneeIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  triggerClassName?: string;
  /** When set, the picker also offers agents and the trigger shows the task's agent. */
  task?: Task;
}

export function AssigneeField({
  assigneeIds,
  onChange,
  disabled,
  triggerClassName,
  task,
}: AssigneeFieldProps) {
  const dispatch = useAppDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pinnedOptions = useAssigneePinnedOptions({
    value: assigneeIds,
    onChange,
    allowUnassigned: true,
  });
  const agent = task?.agentAssignment ?? null;
  const taskId = task?.id;
  const selectAgent = useCallback(
    (agentId: string | null) => {
      if (!taskId) return;
      if (agentId) {
        // The start prompt replaces the picker; leaving both open stacks the picker over it.
        setIsOpen(false);
        dispatch(promptAgentStart({ taskId, agentId }));
      } else void dispatch(assignTaskAgent({ taskId, agentId: null }));
    },
    [dispatch, taskId],
  );
  const sections = useAgentAssigneeSection({
    currentAgentId: agent?.agentId ?? null,
    onSelect: selectAgent,
    enabled: Boolean(task),
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-sm transition-colors",
          disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/50",
          triggerClassName,
        )}
        data-testid="task-assignee-field"
      >
        {assigneeIds.length > 0 && <SubjectAvatarStack subjectIds={assigneeIds} />}
        {agent && <TaskAgentBadge assignment={agent} size="xs" />}
        {assigneeIds.length === 0 && !agent && (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </button>
      {isOpen && (
        <SubjectPicker
          mode="multi"
          subjectTypes="all"
          value={assigneeIds}
          onChange={(ids) => onChange(ids)}
          pinnedOptions={pinnedOptions}
          sections={sections}
          portal
          align="left"
          dropdownWidth={320}
          placeholder="Search people and agents..."
          anchorRef={triggerRef}
          onClose={() => setIsOpen(false)}
          autoFocus
        />
      )}
    </>
  );
}
