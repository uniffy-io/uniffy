import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationInput } from "@/components/ui/duration-input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import type { Task } from "@/features/projects/types";
import type { Worklog } from "@/features/projects/types/time";
import { selectTimeSaving } from "@/features/projects/store/timeSlice";
import { createWorklog, updateWorklog } from "@/features/projects/store/timeThunks";

interface LogTimeModalProps {
  task: Task;
  /** Editing an existing entry; absent when logging a new one. */
  worklog?: Worklog;
  onClose: () => void;
}

export function LogTimeModal({ task, worklog, onClose }: LogTimeModalProps) {
  const dispatch = useAppDispatch();
  const saving = useAppSelector(selectTimeSaving);
  // The day is the person's own calendar day; the server never derives it from an instant.
  const [workDate, setWorkDate] = useState(worklog?.workDate ?? effectiveDayKey(new Date()));
  const [minutes, setMinutes] = useState<number | null>(worklog?.durationMinutes ?? null);
  const [description, setDescription] = useState(worklog?.description ?? "");
  const canSave = Boolean(workDate) && minutes !== null && minutes > 0 && !saving;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || minutes === null) return;
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
        <ModalHeader title={worklog ? "Edit time entry" : "Log time"} description={task.title} />
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
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSave} data-testid="log-time-submit">
            {worklog ? "Save" : "Log time"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
