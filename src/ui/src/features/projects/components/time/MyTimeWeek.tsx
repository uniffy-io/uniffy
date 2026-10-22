import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CaretLeft,
  CaretRight,
  Clock,
  Copy,
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
import type { Worklog } from "@/features/projects/types/time";
import {
  selectTimePolicy,
  selectWeekLoading,
  selectWeekWorklogs,
} from "@/features/projects/store/timeSlice";
import {
  createWorklog,
  deleteWorklog,
  fetchTimePolicy,
  fetchUserWorklogs,
  updateWorklog,
} from "@/features/projects/store/timeThunks";
import {
  addDays,
  buildWeekRows,
  dayStatus,
  dayTotals,
  normalizeWeekStart,
  requiredMinutesOn,
  rowMinutes,
  rowsMissingFrom,
  sumMinutes,
  taskUrn,
  weekDays,
  weekRangeKey,
  weekStartOf,
  type DayStatus,
  type WeekRow,
  type WeekRowRef,
} from "@/features/projects/utils/timeWeek";
import { LogTimeModal } from "./LogTimeModal";
import { RecentTasksRail } from "./RecentTasksRail";
import { useTaskLabels } from "./useTaskLabels";

const STATUS_COLOR: Record<DayStatus, string | undefined> = {
  none: undefined,
  logged: undefined,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayShort(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

interface CellEditor {
  taskId: string;
  title: string;
  workDate: string;
  worklog?: Worklog;
}

function EntriesPopover({
  entries,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  entries: Worklog[];
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
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" size="xs" className="mt-2 w-full" onClick={onAdd}>
          <Plus size={12} />
          Add entry
        </Button>
      </div>
    </>
  );
}

/** The person's week, one row per task and one editable cell per day. */
export function MyTimeWeek() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobileOrTablet } = useBreakpoint();
  const policy = useAppSelector(selectTimePolicy);
  const { workdays } = useSchedulingSettings();
  const { weekStart: preferredWeekStart } = useAppearanceSettings();
  const weekStart = normalizeWeekStart(policy?.weekStart ?? preferredWeekStart);
  const today = effectiveDayKey(new Date());
  const [anchor, setAnchor] = useState(today);
  const days = useMemo(() => weekDays(weekStartOf(anchor, weekStart)), [anchor, weekStart]);
  const rangeKey = weekRangeKey(days[0], days[6]);
  const selectWorklogs = useMemo(() => selectWeekWorklogs(rangeKey), [rangeKey]);
  const worklogs = useAppSelector(selectWorklogs);
  const loading = useAppSelector(selectWeekLoading(rangeKey));
  // Empty rows added from the rail or copied from last week live only in this view of this week.
  const [extraRows, setExtraRows] = useState<Record<string, WeekRowRef[]>>({});
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

  const rows = useMemo(
    () => buildWeekRows(worklogs, days, extraRows[rangeKey] ?? []),
    [worklogs, days, extraRows, rangeKey],
  );
  const rowTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  const labels = useTaskLabels(rowTaskIds);
  const excluded = useMemo(() => new Set(rowTaskIds), [rowTaskIds]);
  const rule = useMemo(
    () => ({
      requiredMinutesPerDay: policy?.requiredMinutesPerDay ?? 0,
      workdays,
      holidays: policy?.holidays ?? [],
    }),
    [policy, workdays],
  );
  const totals = useMemo(() => dayTotals(rows, days), [rows, days]);
  const required = useMemo(
    () => Object.fromEntries(days.map((day) => [day, requiredMinutesOn(day, rule)])),
    [days, rule],
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

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="my-time-week">
      <PaneHeader>
        <PaneHeaderBar icon={Clock} title="My time" subtitle={rangeLabel}>
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
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void copyLastWeek()}
            data-testid="copy-last-week"
          >
            <Copy size={14} />
            <span className="hidden md:inline">Copy last week</span>
          </Button>
          <div className="text-xs tabular-nums" data-testid="week-total">
            <span className="font-semibold text-foreground">{formatMinutes(weekTotal)}</span>
            {weekRequired > 0 && (
              <span className="text-muted-foreground"> / {formatMinutes(weekRequired)}</span>
            )}
          </div>
        </PaneHeaderBar>
      </PaneHeader>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Table className="min-w-[720px]">
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
                    <div className="text-[10px] font-normal">{day.slice(5).replace("-", "/")}</div>
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
                      return (
                        <TableCell key={day} className="relative py-1 text-right">
                          {entries.length > 1 ? (
                            <button
                              type="button"
                              className="h-7 w-full rounded-md px-2 text-right text-xs tabular-nums hover:bg-muted"
                              onClick={() => setOpenCell({ taskId: row.taskId, day })}
                              title={`${entries.length} entries`}
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
                              data-testid="week-cell"
                            />
                          )}
                          {cellOpen && (
                            <EntriesPopover
                              entries={entries}
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
                      {totals[day] > 0 ? formatMinutes(totals[day]) : required[day] > 0 ? "0m" : ""}
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
        {!isMobileOrTablet && (
          <div className="w-60 shrink-0">
            <RecentTasksRail
              pinnedProjectId={policy?.internalProjectId ?? null}
              excludeTaskIds={excluded}
              onPick={(ref) => addRows([ref])}
            />
          </div>
        )}
      </div>

      {editor && (
        <LogTimeModal
          task={{ id: editor.taskId, title: editor.title }}
          worklog={editor.worklog}
          workDate={editor.workDate}
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
