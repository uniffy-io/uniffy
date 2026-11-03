import { LockSimple, Trash, WarningCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch } from "@/app/hooks";
import { PageLoader } from "@/components/feedback/PageLoader";
import { mentionStatusToAccessRequestState } from "@/components/mention/accessRequestState";
import { MentionAvailability } from "@/components/mention/types";
import { useMentionState } from "@/components/mention/useMentionState";
import { Button } from "@/components/ui/button";
import { openRequestAccessDialog } from "@/features/permissions/store/accessRequestsSlice";
import { taskUrn } from "@/features/projects/utils/taskPath";

/** What a task host shows once the task will not load: deleted, or no access with a request. */
export function TaskUnavailable({ taskId }: { taskId: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const live = useMentionState(taskUrn(taskId));
  const availability = live?.availability;

  if (availability === MentionAvailability.Deleted) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-24 text-center"
        data-testid="task-page-deleted"
      >
        <Trash size={28} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">This task was deleted</p>
        <Button variant="ghost" onClick={() => navigate("/projects")}>
          Go to projects
        </Button>
      </div>
    );
  }

  if (availability !== MentionAvailability.Restricted) return <PageLoader />;

  return (
    <div
      className="flex flex-col items-center gap-3 py-24 text-center"
      data-testid="task-page-restricted"
    >
      <LockSimple size={28} className="text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">You don&apos;t have access to this task</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Ask someone who can share its project for access.
      </p>
      {live?.canRequestAccess && (
        <Button
          onClick={() =>
            dispatch(
              openRequestAccessDialog({
                urn: taskUrn(taskId),
                label: "Task",
                canRequestAccess: true,
                state: mentionStatusToAccessRequestState(live.accessRequestStatus),
                requestId: live.accessRequestId,
                canRequestAgainAt: live.canRequestAgainAt,
              }),
            )
          }
          data-testid="task-page-request-access"
        >
          Request access
        </Button>
      )}
    </div>
  );
}

/** A load that failed for a reason other than access, with nothing cached to show instead. */
export function TaskLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-24 text-center"
      data-testid="task-load-error"
    >
      <WarningCircle size={28} className="text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">This task could not be loaded</p>
      <Button variant="ghost" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
