import { useState } from "react";
import { ArrowClockwise, ChatText, Play, Robot, StopCircle } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TaskAgentBadge } from "@/features/projects/components/agents/TaskAgentBadge";
import {
  agentRunStatusLabel,
  canRequestAgentChanges,
  isAgentRunActive,
  isAgentRunOpen,
  isAgentRunScheduled,
} from "@/features/projects/utils/agentRuns";
import { AgentSessionPanel } from "@/features/agents/components/AgentSessionPanel";
import {
  assignTaskAgent,
  requestTaskAgentChanges,
  startTaskAgent,
  stopTaskAgent,
} from "@/features/projects/store/taskAgentsThunks";
import { promptAgentStart } from "@/features/projects/store/taskAgentsSlice";
import type { Task, TaskAgentAssignment } from "@/features/projects/types/project";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { formatSmartDateTime } from "@/shared/utils/dateFormatting";

/** Matches the server cap on a change request. */
const MAX_CHANGES_LENGTH = 4000;

interface TaskAgentSectionProps {
  task: Task;
  taskKey: string;
  canEdit: boolean;
}

function subtitle(assignment: TaskAgentAssignment, forName: string): string {
  if (assignment.status === "waiting") return `Waiting for Start, for ${forName}`;
  if (isAgentRunScheduled(assignment) && assignment.startAt) {
    return `Starts ${formatSmartDateTime(assignment.startAt)}, for ${forName}`;
  }
  if (!isAgentRunActive(assignment)) return `Assigned by ${forName}`;
  return assignment.reason === "project"
    ? `Picked up for ${forName} from the project`
    : `Working for ${forName}`;
}

/** The agent on this task: its state, its session for the assigner, and the run controls. */
export function TaskAgentSection({ task, taskKey, canEdit }: TaskAgentSectionProps) {
  const dispatch = useAppDispatch();
  const [panelOpen, setPanelOpen] = useState(false);
  const [changes, setChanges] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const assignment = task.agentAssignment;
  const { subjects } = useSubjectResolver(assignment ? [assignment.assignedById] : [], []);

  if (!assignment) return null;
  const active = isAgentRunActive(assignment);
  const open = isAgentRunOpen(assignment);
  const held = assignment.status === "waiting" || isAgentRunScheduled(assignment);
  const mine = assignment.assignedById === currentUserId;
  const forName = mine ? "you" : (subjects[0]?.name ?? "a teammate");
  const canSendChanges = canEdit && mine && canRequestAgentChanges(assignment);
  const trimmed = changes?.trim() ?? "";

  const sendChanges = async () => {
    if (!trimmed || sending) return;
    setSending(true);
    const result = await dispatch(requestTaskAgentChanges({ taskId: task.id, changes: trimmed }));
    setSending(false);
    if (requestTaskAgentChanges.fulfilled.match(result)) setChanges(null);
  };

  return (
    <div className="rounded-lg bg-card px-3 py-2 shadow-edge" data-testid="task-agent-section">
      <div className="flex flex-wrap items-center gap-3">
        <Robot size={16} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <TaskAgentBadge assignment={assignment} size="sm" showLabel />
          <p className="text-xs text-subtle-foreground">{subtitle(assignment, forName)}</p>
        </div>
        {mine && assignment.sessionId && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() => setPanelOpen(true)}
            data-testid="task-agent-view-session"
          >
            View session
          </Button>
        )}
        {held && canEdit && !assignment.agentIsDeleted && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() => void dispatch(startTaskAgent(task.id))}
            data-testid="task-agent-start"
          >
            <Play size={14} />
            {assignment.status === "waiting" ? "Start" : "Start now"}
          </Button>
        )}
        {open && assignment.status !== "waiting" && canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() => void dispatch(stopTaskAgent(task.id))}
            data-testid="task-agent-stop"
          >
            <StopCircle size={14} />
            Stop
          </Button>
        )}
        {canSendChanges && changes === null && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() => setChanges("")}
            data-testid="task-agent-request-changes"
          >
            <ChatText size={14} />
            Request changes
          </Button>
        )}
        {!open && canEdit && !assignment.agentIsDeleted && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() =>
              dispatch(promptAgentStart({ taskId: task.id, agentId: assignment.agentId }))
            }
            data-testid="task-agent-run-again"
          >
            <ArrowClockwise size={14} />
            Run again
          </Button>
        )}
        {!active && canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-0"
            onClick={() => void dispatch(assignTaskAgent({ taskId: task.id, agentId: null }))}
            data-testid="task-agent-remove"
          >
            Remove
          </Button>
        )}
      </div>
      {changes !== null && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendChanges();
          }}
        >
          <label htmlFor="task-agent-changes" className="block text-sm text-muted-foreground">
            What should {assignment.agentName} change?
          </label>
          <Textarea
            id="task-agent-changes"
            autoFocus
            rows={3}
            value={changes}
            maxLength={MAX_CHANGES_LENGTH}
            onChange={(event) => setChanges(event.target.value)}
            placeholder="It continues the same session, so it remembers what it did."
            data-testid="task-agent-changes-input"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setChanges(null)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!trimmed}
              loading={sending}
              data-testid="task-agent-changes-send"
            >
              Send changes
            </Button>
          </div>
        </form>
      )}
      {mine && (
        <AgentSessionPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          sessionId={assignment.sessionId}
          agentId={assignment.agentId}
          agentName={assignment.agentName}
          agentAvatarEmoji={assignment.agentAvatarEmoji}
          subject={`Task ${taskKey}`}
          live={active}
          status={agentRunStatusLabel(assignment)}
        />
      )}
    </div>
  );
}
