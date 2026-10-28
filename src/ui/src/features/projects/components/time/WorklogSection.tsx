import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatarById } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
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
import { TASK_WORKLOG_PAGE_SIZE } from "@/features/projects/api/timeApi";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { endOf, wallTimeOf } from "@/features/projects/utils/timeClock";
import { LogTimeModal } from "@/features/projects/components/time/LogTimeModal";

/** "09:30 to 10:15" when the entry sits on the day's timeline. */
function clockOf(entry: Worklog): string | null {
  if (!entry.startedAt) return null;
  const placed = wallTimeOf(entry.startedAt, getEffectiveTimeZone());
  if (placed.day !== entry.workDate) return null;
  return `${placed.wall} to ${endOf(placed.wall, entry.durationMinutes)}`;
}

const SOURCE_LABEL: Record<Worklog["source"], string | null> = {
  manual: null,
  timer: "timer",
  import: "imported",
  agent: "agent",
};

export function WorklogSection({ task }: { task: Task }) {
  return <TaskWorklogs key={task.id} task={task} />;
}

function TaskWorklogs({ task }: { task: Task }) {
  const dispatch = useAppDispatch();
  const selectWorklogs = useMemo(() => selectWorklogsForTask(task.id), [task.id]);
  const worklogs = useAppSelector(selectWorklogs);
  const nextPageToken = useAppSelector((state) => state.time.taskPageTokens[task.id] ?? "");
  const historyVersion = useAppSelector((state) => state.time.taskHistoryVersions[task.id] ?? 0);
  const loadedVersion = useAppSelector((state) => state.time.taskLoadedVersions[task.id] ?? 0);
  const historyDirty = historyVersion !== loadedVersion;
  const writesPending = useAppSelector(
    (state) => state.time.saving || state.time.timerBusy || state.time.rangeSaving,
  );
  const attemptedRefresh = useRef(-1);
  const [page, setPage] = useState(0);
  const loading = useAppSelector((state) => state.time.loadingByTask[task.id] ?? false);
  const policy = useAppSelector(selectTimePolicy);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const authorIds = useMemo(() => [...new Set(worklogs.map((entry) => entry.userId))], [worklogs]);
  const { subjects: authors } = useSubjectResolver(authorIds);
  const authorNames = useMemo(
    // An id the directory has not loaded resolves to a placeholder name; leave those out so the
    // avatar keeps its own fallback rather than drawing initials from the placeholder.
    () =>
      Object.fromEntries(
        authors
          .filter((subject) => subject.name !== subject.id.slice(-6))
          .map((subject) => [subject.id, subject.name]),
      ),
    [authors],
  );
  const [editor, setEditor] = useState<{ worklog?: Worklog } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Worklog | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void dispatch(fetchTaskWorklogs(task.id));
  }, [dispatch, task.id]);

  useEffect(() => {
    if (
      !historyDirty ||
      writesPending ||
      loading ||
      editor ||
      pendingDelete ||
      attemptedRefresh.current === historyVersion
    )
      return;
    attemptedRefresh.current = historyVersion;
    void dispatch(fetchTaskWorklogs(task.id)).then((result) => {
      if (fetchTaskWorklogs.fulfilled.match(result)) setPage(0);
    });
  }, [
    dispatch,
    task.id,
    historyDirty,
    historyVersion,
    writesPending,
    loading,
    editor,
    pendingDelete,
  ]);

  useEffect(() => {
    if (!policy) void dispatch(fetchTimePolicy());
  }, [dispatch, policy]);

  if (policy && !policy.enabled) return null;

  const total = task.timeSpentMinutes ?? 0;
  const lastPage = Math.max(0, Math.ceil(worklogs.length / TASK_WORKLOG_PAGE_SIZE) - 1);
  const shownPage = Math.min(page, lastPage);
  const shown = worklogs.slice(
    shownPage * TASK_WORKLOG_PAGE_SIZE,
    (shownPage + 1) * TASK_WORKLOG_PAGE_SIZE,
  );
  const loadMore = async () => {
    const result = await dispatch(fetchTaskWorklogs({ taskId: task.id, pageToken: nextPageToken }));
    if (fetchTaskWorklogs.fulfilled.match(result))
      setPage(result.payload.replace ? 0 : shownPage + 1);
  };

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
          Time entries
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
          {shown.map((entry) => {
            const own = entry.userId === userId || entry.createdByUserId === userId;
            const sourceLabel = SOURCE_LABEL[entry.source];
            return (
              <li
                key={entry.id}
                className="group flex items-start gap-2 text-sm"
                data-testid="worklog-row"
              >
                <SubjectAvatarById
                  userId={entry.userId}
                  displayName={authorNames[entry.userId]}
                  size="xs"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {formatDateShort(entry.workDate)}
                      {clockOf(entry) && <span className="tabular-nums"> {clockOf(entry)}</span>}
                    </span>
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

      {(lastPage > 0 || nextPageToken || historyDirty) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={shownPage === 0 || loading}
            onClick={() => setPage(shownPage - 1)}
          >
            Newer entries
          </Button>
          <span className="text-xs text-muted-foreground">Page {shownPage + 1}</span>
          {shownPage < lastPage && !historyDirty ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={loading}
              onClick={() => setPage(shownPage + 1)}
            >
              Older entries
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              disabled={(!nextPageToken && !historyDirty) || loading || writesPending}
              onClick={() => void loadMore()}
            >
              {loading ? "Loading" : historyDirty ? "Refresh entries" : "Load more"}
            </Button>
          )}
        </div>
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
