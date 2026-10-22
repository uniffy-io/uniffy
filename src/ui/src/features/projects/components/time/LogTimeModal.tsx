import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationInput } from "@/components/ui/duration-input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import type { Task } from "@/features/projects/types";
import type { Timer, Worklog } from "@/features/projects/types/time";
import {
  selectTimePolicy,
  selectTimeSaving,
  selectTimerBusy,
} from "@/features/projects/store/timeSlice";
import { createWorklog, stopTimer, updateWorklog } from "@/features/projects/store/timeThunks";
import { roundTimerMinutes, timerElapsedSeconds } from "@/features/projects/utils/timerElapsed";

interface LogTimeModalProps {
  task: Pick<Task, "id" | "title">;
  /** Editing an existing entry; absent when logging a new one. */
  worklog?: Worklog;
  /** Stopping this timer: the rounded elapsed time is prefilled and Discard drops it. */
  timer?: Timer;
  /** The day a new entry starts on; today in the person's zone when absent. */
  workDate?: string;
  onClose: () => void;
}

export function LogTimeModal({
  task,
  worklog,
  timer,
  workDate: initialWorkDate,
  onClose,
}: LogTimeModalProps) {
  const dispatch = useAppDispatch();
  const policy = useAppSelector(selectTimePolicy);
  const savingEntry = useAppSelector(selectTimeSaving);
  const timerBusy = useAppSelector(selectTimerBusy);
  const saving = savingEntry || timerBusy;
  // The day is the person's own calendar day; the server never derives it from an instant.
  const [workDate, setWorkDate] = useState(
    worklog?.workDate ?? initialWorkDate ?? effectiveDayKey(new Date()),
  );
  const [minutes, setMinutes] = useState<number | null>(() => {
    if (timer) {
      const rounding = policy?.timerRoundingMinutes ?? 1;
      return roundTimerMinutes(timerElapsedSeconds(timer, Date.now()), rounding);
    }
    return worklog?.durationMinutes ?? null;
  });
  const [description, setDescription] = useState(timer?.description ?? worklog?.description ?? "");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const canSave = Boolean(workDate) && minutes !== null && minutes > 0 && !saving;

  const discard = async () => {
    setConfirmDiscard(false);
    const result = await dispatch(stopTimer({ discard: true }));
    if (stopTimer.fulfilled.match(result)) onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || minutes === null) return;
    if (timer) {
      const stopped = await dispatch(
        stopTimer({ workDate, durationMinutes: minutes, description }),
      );
      if (stopTimer.fulfilled.match(stopped)) onClose();
      return;
    }
    const result = await dispatch(
      worklog
        ? updateWorklog({
            id: worklog.id,
            taskId: task.id,
            workDate,
            durationMinutes: minutes,
            description,
          })
        : createWorklog({ taskId: task.id, workDate, durationMinutes: minutes, description }),
    );
    if (createWorklog.fulfilled.match(result) || updateWorklog.fulfilled.match(result)) {
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
      <form onSubmit={submit}>
        <ModalHeader
          title={timer ? "Stop timer" : worklog ? "Edit time entry" : "Log time"}
          description={task.title}
        />
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Day</label>
              <DatePicker value={workDate} onChange={setWorkDate} />
            </div>
            <div>
              <label
                className="block text-sm text-muted-foreground mb-1"
                htmlFor="log-time-duration"
              >
                Duration
              </label>
              <DurationInput
                id="log-time-duration"
                autoFocus
                minutes={minutes}
                onChange={setMinutes}
                data-testid="log-time-duration"
              />
              <p className="mt-1 text-xs text-subtle-foreground">
                Accepts 2h 30m, 1.5h or a plain number of minutes.
              </p>
            </div>
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
