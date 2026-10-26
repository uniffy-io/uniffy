import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationInput } from "@/components/ui/duration-input";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { popoverShellClass } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { useSchedulingSettings } from "@/features/settings/hooks/useSettings";
import { useTaskSearch, type TaskHit } from "@/features/projects/hooks/useTaskSearch";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import type { Task } from "@/features/projects/types";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import type { Timer, Worklog } from "@/features/projects/types/time";
import {
  selectTimePolicy,
  selectTimeSaving,
  selectTimerBusy,
} from "@/features/projects/store/timeSlice";
import {
  createWorklog,
  createWorklogRange,
  stopTimer,
  updateWorklog,
} from "@/features/projects/store/timeThunks";
import {
  endOf,
  endSlots,
  instantOf,
  minutesOfDay,
  periodDays,
  startSlots,
  wallTimeOf,
} from "@/features/projects/utils/timeClock";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { requiredMinutesOn } from "@/features/projects/utils/timeWeek";
import { roundTimerMinutes, timerElapsedSeconds } from "@/features/projects/utils/timerElapsed";

type DateMode = "day" | "period";

const MODE_OPTIONS: { value: DateMode; content: ReactNode }[] = [
  { value: "day", content: <span className="flex h-3.5 items-center px-1 text-xs">Day</span> },
  {
    value: "period",
    content: <span className="flex h-3.5 items-center px-1 text-xs">Period</span>,
  },
];

export interface LogTimePrefill {
  workDate?: string;
  durationMinutes?: number;
  description?: string;
  /** "HH:mm" in the person's zone. */
  startTime?: string;
}

interface LogTimeModalProps extends LogTimePrefill {
  /** The task the entry is for; absent when the person picks one in the dialog. */
  task?: Pick<Task, "id" | "title">;
  /** Editing an existing entry; absent when logging a new one. */
  worklog?: Worklog;
  /** Stopping this timer: the rounded elapsed time is prefilled and Discard drops it. */
  timer?: Timer;
  onClose: () => void;
}

function TaskSearch({ onPick }: { onPick: (task: TaskHit) => void }) {
  const [query, setQuery] = useState("");
  const { hits, loading } = useTaskSearch(query);
  const [active, setActive] = useState(0);
  return (
    <div className="relative">
      <Input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(hits.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && hits[active]) {
            event.preventDefault();
            onPick(hits[active]);
          }
        }}
        placeholder="Search tasks"
        className="pl-9"
        aria-label="Task"
        data-testid="log-time-task-search"
      />
      <MagnifyingGlass
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground"
      />
      {query.trim() && (
        // Floats over the fields below so the dialog keeps its size while the person types.
        <ul
          className={cn(
            popoverShellClass,
            "absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto border border-border/60 py-1 text-sm",
          )}
          role="listbox"
          data-testid="log-time-task-hits"
        >
          {hits.length === 0 && (
            <li className="px-3 py-2 text-xs text-subtle-foreground">
              {loading ? "Searching" : "No tasks match"}
            </li>
          )}
          {hits.map((hit, index) => (
            <li key={hit.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60",
                  index === active && "bg-muted/60",
                )}
                onMouseEnter={() => setActive(index)}
                onClick={() => onPick(hit)}
              >
                <TaskTypeIcon type={hit.type} className="text-muted-foreground" />
                {hit.code && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {hit.code}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {getTaskTypeConfig(hit.type).label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Log, edit or stop into an entry; the task, the day and the clock times can all be chosen here. */
export function LogTimeModal({
  task: givenTask,
  worklog,
  timer,
  workDate: initialWorkDate,
  durationMinutes: initialMinutes,
  description: initialDescription,
  startTime: initialStart,
  onClose,
}: LogTimeModalProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector(selectTimePolicy);
  const { workdays } = useSchedulingSettings();
  const savingEntry = useAppSelector(selectTimeSaving);
  const timerBusy = useAppSelector(selectTimerBusy);
  const saving = savingEntry || timerBusy;
  const zone = getEffectiveTimeZone();
  const editing = Boolean(worklog);
  const existingStart = worklog?.startedAt ? wallTimeOf(worklog.startedAt, zone) : null;

  const [task, setTask] = useState<Pick<Task, "id" | "title"> | null>(givenTask ?? null);
  const [mode, setMode] = useState<DateMode>("day");
  // The day is the person's own calendar day; the server never derives it from an instant.
  const [workDate, setWorkDate] = useState(
    worklog?.workDate ?? initialWorkDate ?? effectiveDayKey(new Date()),
  );
  const [periodEnd, setPeriodEnd] = useState(workDate);
  const [includeDaysOff, setIncludeDaysOff] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(() => {
    if (timer) {
      const rounding = policy?.timerRoundingMinutes ?? 1;
      return roundTimerMinutes(timerElapsedSeconds(timer, Date.now()), rounding);
    }
    return worklog?.durationMinutes ?? initialMinutes ?? null;
  });
  const [start, setStart] = useState<string>(() => {
    if (existingStart && existingStart.day === worklog?.workDate) return existingStart.wall;
    if (timer?.startedAt) return wallTimeOf(timer.startedAt, zone).wall;
    return initialStart ?? "";
  });
  const [description, setDescription] = useState(
    timer?.description ?? worklog?.description ?? initialDescription ?? "",
  );
  const [logAnother, setLogAnother] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const end = start && minutes ? endOf(start, minutes) : "";
  const rule = useMemo(
    () => ({
      requiredMinutesPerDay: policy?.requiredMinutesPerDay ?? 0,
      workdays,
      holidays: policy?.holidays ?? [],
    }),
    [policy, workdays],
  );
  const days = useMemo(
    () => (mode === "period" ? periodDays(workDate, periodEnd, includeDaysOff, rule) : [workDate]),
    [mode, workDate, periodEnd, includeDaysOff, rule],
  );
  const periodInvalid = mode === "period" && days.length === 0;
  const dayRequired = requiredMinutesOn(workDate, rule);
  const dayExpectation =
    dayRequired > 0
      ? `This day expects ${formatMinutes(dayRequired)}`
      : "A day off, no hours expected";
  const canSave =
    Boolean(task) &&
    Boolean(workDate) &&
    minutes !== null &&
    minutes > 0 &&
    !saving &&
    !periodInvalid;

  const startOptions = useMemo(
    () => startSlots().map((slot) => ({ value: slot, label: slot })),
    [],
  );
  const endOptions = useMemo(
    () =>
      endSlots()
        .filter((slot) => !start || minutesOfDay(slot) > minutesOfDay(start))
        .map((slot) => ({
          value: slot,
          label: start
            ? `${slot}, ${formatMinutes(minutesOfDay(slot) - minutesOfDay(start))}`
            : slot,
        })),
    [start],
  );

  const pickEnd = (slot: string) => {
    if (!start) {
      // An end without a start fixes the length from the typed minutes, if any.
      if (minutes) setStart(endOf(slot, -minutes));
      return;
    }
    setMinutes(minutesOfDay(slot) - minutesOfDay(start));
  };

  // Ctrl+Enter submits from any field, the note included.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    form.addEventListener("keydown", onKey);
    return () => form.removeEventListener("keydown", onKey);
  }, []);

  const discard = async () => {
    setConfirmDiscard(false);
    const result = await dispatch(stopTimer({ discard: true }));
    if (stopTimer.fulfilled.match(result)) onClose();
  };

  const resetForAnother = () => {
    setMinutes(null);
    setStart("");
    setDescription("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || minutes === null || !task) return;
    const startedAt = start ? instantOf(workDate, start, zone) : undefined;
    if (timer) {
      const stopped = await dispatch(
        stopTimer({ workDate, durationMinutes: minutes, description }),
      );
      if (stopTimer.fulfilled.match(stopped)) onClose();
      return;
    }
    if (worklog) {
      const result = await dispatch(
        updateWorklog({
          id: worklog.id,
          taskId: task.id,
          workDate,
          durationMinutes: minutes,
          description,
          startedAt: startedAt ?? null,
        }),
      );
      if (updateWorklog.fulfilled.match(result)) onClose();
      return;
    }
    if (mode === "period") {
      const result = await dispatch(
        createWorklogRange({
          taskId: task.id,
          days,
          durationMinutes: minutes,
          description,
          ...(start ? { startedAt } : {}),
        }),
      );
      if (!createWorklogRange.fulfilled.match(result)) return;
      const { created, failed } = result.payload;
      if (failed) {
        toast.warning(
          `${created} of ${days.length} days logged; stopped at ${formatDateShort(failed)}`,
        );
        return;
      }
      toast.success(`${formatMinutes(minutes)} logged on ${created} days`);
      if (logAnother) resetForAnother();
      else onClose();
      return;
    }
    const result = await dispatch(
      createWorklog({
        taskId: task.id,
        workDate,
        durationMinutes: minutes,
        description,
        startedAt,
      }),
    );
    if (!createWorklog.fulfilled.match(result)) return;
    if (logAnother) {
      toast.success(`${formatMinutes(minutes)} logged on ${task.title}`);
      resetForAnother();
    } else {
      onClose();
    }
  };

  const title = timer ? "Stop timer" : worklog ? "Edit time entry" : "Log time";

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-lg">
      <form onSubmit={submit} ref={formRef}>
        <ModalHeader title={title} description={task?.title} />
        <ModalBody>
          <div className="space-y-4">
            {!givenTask && !worklog && !timer && (
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Task</label>
                {task ? (
                  <div
                    className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
                    data-testid="log-time-task"
                  >
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setTask(null)}
                      aria-label="Change task"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <TaskSearch onPick={(hit) => setTask({ id: hit.id, title: hit.title })} />
                )}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <label className="block text-sm text-muted-foreground mb-1">
                  {mode === "period" ? "From" : "Day"}
                </label>
                <DatePicker
                  value={workDate}
                  onChange={setWorkDate}
                  size="sm"
                  triggerClassName="h-7"
                />
              </div>
              {mode === "period" && (
                <div className="min-w-0 flex-1">
                  <label className="block text-sm text-muted-foreground mb-1">To</label>
                  <DatePicker
                    value={periodEnd}
                    onChange={setPeriodEnd}
                    size="sm"
                    triggerClassName="h-7"
                  />
                </div>
              )}
              {!editing && !timer && (
                <SegmentedControl
                  value={mode}
                  onChange={setMode}
                  options={MODE_OPTIONS}
                  ariaLabel="One day or a period"
                  className="h-7"
                />
              )}
            </div>
            {/* Always rendered so the dialog keeps its height when the mode changes. */}
            <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
              <span data-testid="log-time-period-days">
                {mode === "period"
                  ? periodInvalid
                    ? "Pick an end on or after the start, at most 62 days away."
                    : `${days.length} day${days.length === 1 ? "" : "s"} get this entry`
                  : dayExpectation}
              </span>
              {mode === "period" && (
                <Checkbox
                  size="sm"
                  label="Include days off"
                  checked={includeDaysOff}
                  onChange={(event) => setIncludeDaysOff(event.target.checked)}
                />
              )}
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
              <div>
                <label
                  className="block text-sm text-muted-foreground mb-1"
                  htmlFor="log-time-duration"
                >
                  Time spent
                </label>
                <DurationInput
                  id="log-time-duration"
                  autoFocus={Boolean(givenTask) || editing || Boolean(timer)}
                  minutes={minutes}
                  onChange={setMinutes}
                  className="h-7 py-1 text-xs"
                  data-testid="log-time-duration"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Start</label>
                <Select
                  value={start || undefined}
                  onChange={setStart}
                  options={startOptions}
                  placeholder="--:--"
                  searchable
                  searchPlaceholder="09:00"
                  ariaLabel="Start time"
                  size="sm"
                  triggerClassName="h-7 w-24 tabular-nums"
                  menuMinWidth={120}
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">End</label>
                <Select
                  value={end || undefined}
                  onChange={pickEnd}
                  options={endOptions}
                  placeholder="--:--"
                  searchable
                  searchPlaceholder="17:00"
                  ariaLabel="End time"
                  size="sm"
                  triggerClassName="h-7 w-36 tabular-nums"
                  menuMinWidth={160}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setStart("")}
                disabled={!start}
                aria-label="Clear the clock times"
                title="Keep only the day"
              >
                <X size={14} />
              </Button>
            </div>
            <p className="-mt-2 text-xs text-subtle-foreground">
              Accepts 2h 30m, 1.5h or a plain number of minutes. Times are optional and place the
              entry on the calendar.
            </p>
            <div>
              <label className="block text-sm text-muted-foreground mb-1" htmlFor="log-time-note">
                Note (optional)
              </label>
              <Textarea
                id="log-time-note"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What did you work on?"
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          {timer && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-red-500 hover:text-red-600"
              onClick={() => setConfirmDiscard(true)}
              disabled={saving}
              data-testid="log-time-discard"
            >
              Discard
            </Button>
          )}
          {!timer && !editing && (
            <Checkbox
              size="sm"
              label="Log another"
              className="mr-auto"
              checked={logAnother}
              onChange={(event) => setLogAnother(event.target.checked)}
              data-testid="log-time-another"
            />
          )}
          <span className="hidden text-[11px] text-subtle-foreground sm:inline">Ctrl+Enter</span>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave} data-testid="log-time-submit">
            {worklog ? "Save" : "Log time"}
          </Button>
        </ModalFooter>
      </form>
      <ConfirmDialog
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        title="Discard timer"
        message="Drop the tracked time without logging it?"
        confirmLabel="Discard time"
        loading={saving}
      />
    </Modal>
  );
}
