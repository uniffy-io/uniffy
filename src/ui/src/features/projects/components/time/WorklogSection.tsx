import { useEffect, useMemo, useState } from "react";
import { Clock, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import type { Task } from "@/features/projects/types";
import type { Worklog } from "@/features/projects/types/time";
import { selectTimePolicy, selectWorklogsForTask } from "@/features/projects/store/timeSlice";
import {
  deleteWorklog,
  fetchTaskWorklogs,
  fetchTimePolicy,
} from "@/features/projects/store/timeThunks";
import { LogTimeModal } from "./LogTimeModal";

const SOURCE_LABEL: Record<Worklog["source"], string | null> = {
  manual: null,
  timer: "timer",
  import: "imported",
  agent: "agent",
};

export function WorklogSection({ task }: { task: Task }) {
  const dispatch = useAppDispatch();
  const selectWorklogs = useMemo(() => selectWorklogsForTask(task.id), [task.id]);
  const worklogs = useAppSelector(selectWorklogs);
  const loading = useAppSelector((state) => state.time.loadingByTask[task.id] ?? false);
  const policy = useAppSelector(selectTimePolicy);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const [editor, setEditor] = useState<{ worklog?: Worklog } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Worklog | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void dispatch(fetchTaskWorklogs(task.id));
  }, [dispatch, task.id]);

  useEffect(() => {
    if (!policy) void dispatch(fetchTimePolicy());
  }, [dispatch, policy]);

  if (policy && !policy.enabled) return null;

  const total = worklogs.reduce((sum, entry) => sum + entry.durationMinutes, 0);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    await dispatch(deleteWorklog({ worklogId: pendingDelete.id, taskId: task.id }));
    setDeleting(false);
    setPendingDelete(null);
  };

  return (
    <div className="px-4 py-3 border-b border-border" data-testid="worklog-section">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Clock size={12} />
          Time entries ({worklogs.length})
          {total > 0 && (
            <span className="text-foreground font-semibold">{formatMinutes(total)}</span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setEditor({})}
          data-testid="log-time-open"
        >
          <Plus size={12} />
          Log time
        </Button>
      </div>

      {worklogs.length === 0 ? (
        <p className="text-xs text-subtle-foreground">
          {loading ? "Loading time entries" : "No time logged yet."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {worklogs.map((entry) => {
            const own = entry.userId === userId || entry.createdByUserId === userId;
            const sourceLabel = SOURCE_LABEL[entry.source];
            return (
              <li
                key={entry.id}
                className="group flex items-start gap-2 text-sm"
                data-testid="worklog-row"
              >
                <SubjectAvatarById userId={entry.userId} size="xs" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formatDateShort(entry.workDate)}</span>
                    <span className="font-medium">{formatMinutes(entry.durationMinutes)}</span>
                    {sourceLabel && (
                      <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">
                        {sourceLabel}
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                      {entry.description}
                    </p>
                  )}
                </div>
                {own && (
                  <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Edit entry"
                      onClick={() => setEditor({ worklog: entry })}
                    >
                      <PencilSimple size={12} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-muted"
                      title="Delete entry"
                      onClick={() => setPendingDelete(entry)}
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editor && (
        <LogTimeModal task={task} worklog={editor.worklog} onClose={() => setEditor(null)} />
      )}
      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Delete time entry"
        message={
          pendingDelete
            ? `Remove ${formatMinutes(pendingDelete.durationMinutes)} logged on ${formatDateShort(pendingDelete.workDate)}?`
            : ""
        }
        confirmLabel="Delete"
        loading={deleting}
      />
    </div>
  );
}
