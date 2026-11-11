import type { TaskAgentAssignment, TaskAgentRunStatus } from "@/features/projects/types/project";

const STATUS_LABEL: Record<TaskAgentRunStatus, string> = {
  waiting: "Waiting to start",
  pending: "Starting",
  running: "Working",
  completed: "Finished",
  failed: "Could not finish",
  stopped: "Stopped",
  skipped: "Did not start",
  uncertain: "Interrupted",
};

const ENDED: ReadonlySet<TaskAgentRunStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "uncertain",
]);

export function agentRunStatusLabel(assignment: TaskAgentAssignment): string {
  if (isAgentRunScheduled(assignment)) return "Scheduled";
  return STATUS_LABEL[assignment.status];
}

/** Queued for a time that has not come yet. */
export function isAgentRunScheduled(assignment: TaskAgentAssignment | null | undefined): boolean {
  return assignment?.status === "pending" && assignment.startAt !== null;
}

/** Starting or working now: the run panel streams and the task refreshes while this holds. */
export function isAgentRunActive(assignment: TaskAgentAssignment | null | undefined): boolean {
  if (!assignment || isAgentRunScheduled(assignment)) return false;
  return assignment.status === "pending" || assignment.status === "running";
}

/** Not finished: waiting, scheduled, starting or working; Stop applies. */
export function isAgentRunOpen(assignment: TaskAgentAssignment | null | undefined): boolean {
  return (
    assignment?.status === "waiting" ||
    assignment?.status === "pending" ||
    assignment?.status === "running"
  );
}

/** Ended with a session its owner can send changes to. */
export function canRequestAgentChanges(
  assignment: TaskAgentAssignment | null | undefined,
): boolean {
  return (
    !!assignment &&
    ENDED.has(assignment.status) &&
    assignment.sessionId !== null &&
    !assignment.agentIsDeleted
  );
}
