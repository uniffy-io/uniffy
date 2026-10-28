import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  CaretLeft,
  CaretRight,
  Clock,
  Copy,
  Lock,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { MentionChipCompact } from "@/components/mention";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DurationInput } from "@/components/ui/duration-input";
import { PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { popoverShellClass } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey, formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import {
  useAppearanceSettings,
  useSchedulingSettings,
} from "@/features/settings/hooks/useSettings";
import type { Timesheet, Worklog } from "@/features/projects/types/time";
import {
  selectSheetBusy,
  selectSheetsTouching,
  selectTimePolicy,
  selectWeekDays,
  selectWeekLoading,
  selectWeekWorklogs,
} from "@/features/projects/store/timeSlice";
import {
  createWorklog,
  deleteWorklog,
  fetchTimePolicy,
  fetchTimesheet,
  fetchUserWorklogs,
  recallTimesheet,
  submitTimesheet,
  updateWorklog,
} from "@/features/projects/store/timeThunks";
import {
  addDays,
  buildWeekRows,
  dayStatus,
  dayTotals,
  normalizeWeekStart,
  offLabel,
  requirementsFor,
  rowMinutes,
  rowsMissingFrom,
  sumMinutes,
  taskUrn,
  weekDays,
  weekdayShort,
  weekRangeKey,
  weekStartOf,
  type DayStatus,
  type WeekRow,
  type WeekRowRef,
} from "@/features/projects/utils/timeWeek";
import {
  LogTimeModal,
  type LogTimePrefill,
} from "@/features/projects/components/time/LogTimeModal";
import { PeriodStatus } from "@/features/projects/components/time/PeriodBanner";
import { TaskRail, type RailTask } from "@/features/projects/components/time/TaskRail";
import { TaskDetailModal } from "@/features/projects/components/detail/TaskDetailModal";
import { setCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  closeDetailPanel,
  openDetailPanel,
  selectIsDetailPanelOpen,
  selectSelectedTaskId,
  selectTask,
} from "@/features/projects/store/projectsUiSlice";
import { TimeCalendar, type EntryPatch } from "@/features/projects/components/time/TimeCalendar";
import { TimeList } from "@/features/projects/components/time/TimeList";
import { useTaskLabels } from "@/features/projects/components/time/useTaskLabels";

type WeekView = "calendar" | "list" | "timesheet";

function HeaderDivider() {
  return <div className="hidden h-5 w-px shrink-0 bg-border lg:block" aria-hidden />;
}

const VIEW_OPTIONS: { value: WeekView; content: ReactNode }[] = [
  {
    value: "calendar",
    content: <span className="flex h-3.5 items-center px-1 text-xs">Calendar</span>,
  },
  { value: "list", content: <span className="flex h-3.5 items-center px-1 text-xs">List</span> },
  {
    value: "timesheet",
    content: <span className="flex h-3.5 items-center px-1 text-xs">Timesheet</span>,
  },
];
const VIEW_KEY = "uniffy:time:view";

function storedView(): WeekView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw === "list" || raw === "timesheet" ? raw : "calendar";
  } catch {
    return "calendar";
  }
}

const STATUS_COLOR: Record<DayStatus, string | undefined> = {
  none: undefined,
  logged: undefined,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
};

interface CellEditor extends LogTimePrefill {
  /** Absent when the person picks the task inside the dialog. */
  taskId?: string;
  title?: string;
  worklog?: Worklog;
}

function EntriesPopover({
  entries,
  readOnly,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  entries: Worklog[];
  readOnly: boolean;
  onAdd: () => void;
  onEdit: (entry: Worklog) => void;
  onDelete: (entry: Worklog) => void;
  onClose: () => void;
}) {
  useOverlayEscape(onClose);
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div
        className={cn(popoverShellClass, "absolute right-0 top-full z-30 mt-1 w-64 p-2 text-left")}
        data-testid="cell-entries"
      >
        <ul className="space-y-1">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 text-xs">
              <span className="font-medium">{formatMinutes(entry.durationMinutes)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {entry.description || (entry.source === "timer" ? "timer" : "")}
              </span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    title="Edit entry"
                    onClick={() => onEdit(entry)}
                  >
                    <PencilSimple size={12} />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground hover:text-red-500"
                    title="Delete entry"
                    onClick={() => onDelete(entry)}
                  >
                    <Trash size={12} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {readOnly ? (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock size={10} />
            This day is locked
          </p>
        ) : (
          <Button type="button" variant="ghost" size="xs" className="mt-2 w-full" onClick={onAdd}>
            <Plus size={12} />
            Add entry
          </Button>
        )}
      </div>
    </>
  );
}

function lockHint(sheet: Timesheet | undefined): string | undefined {
  if (!sheet?.locked) return undefined;
  if (sheet.periodClosed) return "This period is closed";
  if (sheet.status === "submitted") return "Submitted for review; recall it to edit";
  if (sheet.status === "approved") return "Approved; ask your reviewer to reopen it";
  return "This period has locked; ask your reviewer to reopen it";
}

interface MyTimeWeekProps {
  /** Day whose week opens first; today otherwise. */
  initialDay?: string;
  headerExtra?: ReactNode;
}

/** The person's week, one row per task and one editable cell per day. */
export function MyTimeWeek({ initialDay, headerExtra }: MyTimeWeekProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobileOrTablet } = useBreakpoint();
  const policy = useAppSelector(selectTimePolicy);
  const { workdays } = useSchedulingSettings();
  const { weekStart: preferredWeekStart } = useAppearanceSettings();
  const weekStart = normalizeWeekStart(policy?.weekStart ?? preferredWeekStart);
  const today = effectiveDayKey(new Date());
  const [anchor, setAnchor] = useState(initialDay ?? today);
  const days = useMemo(() => weekDays(weekStartOf(anchor, weekStart)), [anchor, weekStart]);
  const rangeKey = weekRangeKey(days[0], days[6]);
  const selectWorklogs = useMemo(() => selectWeekWorklogs(rangeKey), [rangeKey]);
  const worklogs = useAppSelector(selectWorklogs);
  const servedDays = useAppSelector(selectWeekDays(rangeKey));
  const loading = useAppSelector(selectWeekLoading(rangeKey));
  const selectSheets = useMemo(() => selectSheetsTouching(days[0], days[6]), [days]);
  const sheets = useAppSelector(selectSheets);
  const sheetBusy = useAppSelector(selectSheetBusy);
  const approvals = policy?.approvalsEnabled ?? false;
  // Empty rows added from the rail or copied from last week live only in this view of this week.
  const [extraRows, setExtraRows] = useState<Record<string, WeekRowRef[]>>({});
  const [view, setView] = useState<WeekView>(storedView);
  const [editor, setEditor] = useState<CellEditor | null>(null);
  const [openCell, setOpenCell] = useState<{ taskId: string; day: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Worklog | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!policy) void dispatch(fetchTimePolicy());
  }, [dispatch, policy]);

  useEffect(() => {
    void dispatch(fetchUserWorklogs({ from: days[0], to: days[6] }));
  }, [dispatch, days]);

  useEffect(() => {
    if (!approvals) return;
    void dispatch(fetchTimesheet({ day: days[0] }));
    // A monthly period can change inside the week; weekly periods share the week's bounds.
    if (policy?.periodType === "monthly") void dispatch(fetchTimesheet({ day: days[6] }));
  }, [dispatch, days, approvals, policy?.periodType]);

  const sheetFor = useCallback(
    (day: string) => sheets.find((sheet) => sheet.periodStart <= day && sheet.periodEnd >= day),
    [sheets],
  );
  const lockHintFor = useCallback((day: string) => lockHint(sheetFor(day)), [sheetFor]);

  const changeView = (next: WeekView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A blocked store only loses the preference for next time.
    }
  };

  const patchEntry = (entry: Worklog, patch: EntryPatch) => {
    void dispatch(updateWorklog({ id: entry.id, taskId: entry.taskId, ...patch }));
  };

  /** Opens the dialog on an entry's own task. */
  const editEntry = (entry: Worklog) =>
    setEditor({
      taskId: entry.taskId,
      title: labels[entry.taskId] || "Task",
      workDate: entry.workDate,
      worklog: entry,
    });

  const rows = useMemo(
    () => buildWeekRows(worklogs, days, extraRows[rangeKey] ?? []),
    [worklogs, days, extraRows, rangeKey],
  );
  const rowTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  const labels = useTaskLabels(rowTaskIds);
  const selectedTaskId = useAppSelector(selectSelectedTaskId);
  const detailOpen = useAppSelector(selectIsDetailPanelOpen);
  // Only a task opened from this page shows here, never one left open on a project page.
  const [railTaskId, setRailTaskId] = useState<string | null>(null);
  const openTaskId = detailOpen && selectedTaskId === railTaskId ? railTaskId : null;
  // The same full task view a project opens, as a dialog over the week.
  const openTask = (task: RailTask) => {
    setRailTaskId(task.taskId);
    dispatch(setCurrentProject(task.projectId));
    dispatch(selectTask(task.taskId));
    dispatch(openDetailPanel());
  };
  const closeTask = () => {
    setRailTaskId(null);
    dispatch(closeDetailPanel());
    dispatch(selectTask(null));
  };
  const rule = useMemo(
    () => ({
      requiredMinutesPerDay: policy?.requiredMinutesPerDay ?? 0,
      workdays,
      holidays: policy?.holidays ?? [],
    }),
    [policy, workdays],
  );
  const totals = useMemo(() => dayTotals(rows, days), [rows, days]);
  const requirements = useMemo(
    () => requirementsFor(days, servedDays, rule),
    [days, servedDays, rule],
  );
  const required = useMemo(
    () => Object.fromEntries(days.map((day) => [day, requirements[day].required])),
    [days, requirements],
  );
  const weekTotal = days.reduce((sum, day) => sum + totals[day], 0);
  const weekRequired = days.reduce((sum, day) => sum + required[day], 0);

  const addRows = useCallback(
    (refs: WeekRowRef[]) => {
      setExtraRows((previous) => {
        const current = previous[rangeKey] ?? [];
        const seen = new Set(current.map((row) => row.taskId));
        const added = refs.filter((ref) => !seen.has(ref.taskId));
        return added.length ? { ...previous, [rangeKey]: [...current, ...added] } : previous;
      });
    },
    [rangeKey],
  );

  const copyLastWeek = async () => {
    const previousDays = weekDays(addDays(days[0], -7));
    const result = await dispatch(
      fetchUserWorklogs({ from: previousDays[0], to: previousDays[6] }),
    );
    if (!fetchUserWorklogs.fulfilled.match(result)) return;
    const missing = rowsMissingFrom(rows, result.payload.worklogs);
    addRows(missing);
    toast.info(
      missing.length === 0
        ? "Every task from last week already has a row"
        : `${missing.length} row${missing.length === 1 ? "" : "s"} added from last week`,
    );
  };

  const commitCell = (row: WeekRow, day: string, minutes: number | null) => {
    if (sheetFor(day)?.locked) return;
    const entries = row.cells[day] ?? [];
    if (entries.length === 0) {
      if (minutes && minutes > 0) {
        void dispatch(
          createWorklog({ taskId: row.taskId, workDate: day, durationMinutes: minutes }),
        );
      }
      return;
    }
    const [entry] = entries;
    if (!minutes) {
      setPendingDelete(entry);
      return;
    }
    if (minutes !== entry.durationMinutes) {
      void dispatch(updateWorklog({ id: entry.id, taskId: row.taskId, durationMinutes: minutes }));
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    await dispatch(deleteWorklog({ worklogId: pendingDelete.id, taskId: pendingDelete.taskId }));
    setDeleting(false);
    setPendingDelete(null);
  };

  if (policy && !policy.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Clock size={40} className="text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          Time tracking is turned off for this organization.
        </p>
      </div>
    );
  }

  const rangeLabel = `${formatDateShort(days[0])} to ${formatDateShort(days[6])}`;
  const isCurrentWeek = days.includes(today);
  const defaultDay = isCurrentWeek ? today : days[0];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="my-time-week">
      <PaneHeader>
        <PaneHeaderBar icon={Clock} title="My time" subtitle={rangeLabel}>
          {/* Left to right: which page, which week, where that week stands, how to see it, add. */}
          {headerExtra}
          {headerExtra && <HeaderDivider />}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setAnchor(addDays(days[0], -7))}
              aria-label="Previous week"
              data-testid="week-previous"
            >
              <CaretLeft size={14} />
            </Button>
            <Button
              type="button"
              variant={isCurrentWeek ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setAnchor(today)}
              data-testid="week-today"
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setAnchor(addDays(days[0], 7))}
              aria-label="Next week"
              data-testid="week-next"
            >
              <CaretRight size={14} />
            </Button>
          </div>
          <HeaderDivider />
          {approvals && sheets.length > 0 ? (
            sheets.map((sheet) => (
              <PeriodStatus
                key={sheet.periodStart}
                sheet={sheet}
                busy={sheetBusy}
                onSubmit={(comment, reviewerUserId) =>
                  void dispatch(
                    submitTimesheet({ day: sheet.periodStart, comment, reviewerUserId }),
                  )
                }
                onRecall={() => void dispatch(recallTimesheet({ day: sheet.periodStart }))}
              />
            ))
          ) : (
            <div className="text-xs tabular-nums" data-testid="week-total">
              <span className="font-semibold text-foreground">{formatMinutes(weekTotal)}</span>
              {weekRequired > 0 && (
                <span className="text-muted-foreground"> / {formatMinutes(weekRequired)}</span>
              )}
            </div>
          )}
          <HeaderDivider />
          <SegmentedControl
            value={view}
            onChange={changeView}
            options={VIEW_OPTIONS}
            ariaLabel="Week view"
            className="h-7"
          />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void copyLastWeek()}
            title="Copy last week's tasks into this week"
            data-testid="copy-last-week"
          >
            <Copy size={14} />
            <span className="hidden xl:inline">Copy last week</span>
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => setEditor({ workDate: defaultDay })}
            data-testid="log-time-anywhere"
          >
            <Plus size={14} />
            <span className="hidden md:inline">Log time</span>
          </Button>
        </PaneHeaderBar>
      </PaneHeader>

      <div className="flex min-h-0 flex-1">
        {view === "calendar" && (
          <TimeCalendar
            days={days}
            today={today}
            worklogs={worklogs}
            totals={totals}
            requirements={requirements}
            labels={labels}
            lockHintFor={lockHintFor}
            onCreate={(day, startTime, durationMinutes) =>
              setEditor({ workDate: day, startTime, durationMinutes })
            }
            onEdit={editEntry}
            onChange={patchEntry}
          />
        )}
        {view === "list" && (
          <TimeList
            days={days}
            today={today}
            worklogs={worklogs}
            totals={totals}
            requirements={requirements}
            labels={labels}
            lockHintFor={lockHintFor}
            onAdd={(day) => setEditor({ workDate: day })}
            onEdit={editEntry}
            onDelete={setPendingDelete}
          />
        )}
        {view === "timesheet" && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Table className="min-w-[720px]" rounded={false}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%] min-w-[220px]">Task</TableHead>
                  {days.map((day) => (
                    <TableHead
                      key={day}
                      className={cn(
                        "w-[76px] text-right tabular-nums",
                        day === today && "text-primary",
                        required[day] === 0 && "text-subtle-foreground",
                      )}
                    >
                      <div>{weekdayShort(day)}</div>
                      <div className="text-[10px] font-normal">
                        {day.slice(5).replace("-", "/")}
                      </div>
                      {offLabel(required[day], requirements[day].off) && (
                        <div
                          className="whitespace-nowrap text-[9px] font-normal normal-case tracking-normal text-subtle-foreground"
                          data-testid="week-day-off"
                        >
                          {offLabel(required[day], requirements[day].off)}
                        </div>
                      )}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={days.length + 2}
                      className="py-8 text-center text-xs text-subtle-foreground"
                    >
                      {loading
                        ? "Loading your week"
                        : "No time logged this week. Pick a task on the right, or copy last week."}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => {
                  const urn = taskUrn(row.taskId);
                  const title = labels[row.taskId] || "Task";
                  return (
                    <TableRow key={row.taskId} data-testid="week-row">
                      <TableCell className="py-1">
                        <MentionChipCompact
                          urn={urn}
                          label={title}
                          onClick={() => navigate(`/projects/${row.projectId}/tasks/${row.taskId}`)}
                        />
                      </TableCell>
                      {days.map((day) => {
                        const entries = row.cells[day] ?? [];
                        const cellOpen = openCell?.taskId === row.taskId && openCell.day === day;
                        const hint = lockHint(sheetFor(day));
                        const locked = hint !== undefined;
                        return (
                          <TableCell
                            key={day}
                            className={cn("relative py-1 text-right", locked && "bg-muted/20")}
                            data-locked={locked ? "true" : undefined}
                          >
                            {entries.length > 1 ? (
                              <button
                                type="button"
                                className="h-7 w-full rounded-md px-2 text-right text-xs tabular-nums hover:bg-muted"
                                onClick={() => setOpenCell({ taskId: row.taskId, day })}
                                title={hint ?? `${entries.length} entries`}
                                data-testid="week-cell-multi"
                              >
                                {formatMinutes(sumMinutes(entries))}
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  ×{entries.length}
                                </span>
                              </button>
                            ) : (
                              <DurationInput
                                minutes={entries[0]?.durationMinutes ?? null}
                                onChange={(minutes) => commitCell(row, day, minutes)}
                                placeholder=""
                                className="h-7 w-full min-w-[68px] text-right text-xs"
                                aria-label={`${title} on ${day}`}
                                disabled={locked}
                                title={hint}
                                data-testid="week-cell"
                              />
                            )}
                            {cellOpen && (
                              <EntriesPopover
                                entries={entries}
                                readOnly={locked}
                                onClose={() => setOpenCell(null)}
                                onAdd={() => {
                                  setOpenCell(null);
                                  setEditor({ taskId: row.taskId, title, workDate: day });
                                }}
                                onEdit={(entry) => {
                                  setOpenCell(null);
                                  setEditor({
                                    taskId: row.taskId,
                                    title,
                                    workDate: day,
                                    worklog: entry,
                                  });
                                }}
                                onDelete={(entry) => {
                                  setOpenCell(null);
                                  setPendingDelete(entry);
                                }}
                              />
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="py-1 text-right text-xs font-medium tabular-nums">
                        {formatMinutes(rowMinutes(row, days))}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/30" data-testid="week-footer">
                  <TableCell className="text-xs text-muted-foreground">Total</TableCell>
                  {days.map((day) => {
                    const status = dayStatus(totals[day], required[day]);
                    return (
                      <TableCell
                        key={day}
                        className="text-right text-xs font-medium tabular-nums"
                        style={{ color: STATUS_COLOR[status] }}
                        title={
                          required[day] > 0 ? `${formatMinutes(required[day])} required` : undefined
                        }
                        data-testid="week-day-total"
                        data-status={status}
                      >
                        {totals[day] > 0
                          ? formatMinutes(totals[day])
                          : required[day] > 0
                            ? "0m"
                            : ""}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
                    {formatMinutes(weekTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        {!isMobileOrTablet && (
          <div className="w-72 shrink-0">
            <TaskRail
              days={days}
              pinnedProjectId={policy?.internalProjectId ?? null}
              worklogs={worklogs}
              onOpen={openTask}
              onLog={(ref) =>
                view === "timesheet"
                  ? addRows([ref])
                  : setEditor({ taskId: ref.taskId, title: ref.title, workDate: defaultDay })
              }
              onLogMeeting={(entry) => setEditor(entry)}
            />
          </div>
        )}
      </div>

      {openTaskId && <TaskDetailModal taskId={openTaskId} onClose={closeTask} />}

      {editor && (
        <LogTimeModal
          task={editor.taskId ? { id: editor.taskId, title: editor.title ?? "Task" } : undefined}
          worklog={editor.worklog}
          workDate={editor.workDate}
          durationMinutes={editor.durationMinutes}
          description={editor.description}
          startTime={editor.startTime}
          onClose={() => setEditor(null)}
        />
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
