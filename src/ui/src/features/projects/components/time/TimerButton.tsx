import { useState } from "react";
import { Pause, Play, Stop } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/shared/utils/cn";
import type { Task } from "@/features/projects/types";
import {
  selectActiveTimer,
  selectTimePolicy,
  selectTimerBusy,
} from "@/features/projects/store/timeSlice";
import { pauseTimer, resumeTimer, startTimer } from "@/features/projects/store/timeThunks";
import { formatClock } from "@/features/projects/utils/timerElapsed";
import { LogTimeModal } from "./LogTimeModal";
import { useTimerElapsed } from "./useTimerElapsed";

const ICON_BUTTON =
  "flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50";

/** Start, pause, resume and stop the person's timer from the task it belongs to. */
export function TimerButton({ task }: { task: Task }) {
  const dispatch = useAppDispatch();
  const timer = useAppSelector(selectActiveTimer);
  const busy = useAppSelector(selectTimerBusy);
  const policy = useAppSelector(selectTimePolicy);
  const onThisTask = timer?.taskId === task.id;
  const elapsed = useTimerElapsed(onThisTask ? timer : null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [stopping, setStopping] = useState(false);

  if (policy && !policy.enabled) return null;

  const start = () => void dispatch(startTimer({ taskId: task.id }));

  if (!timer || !onThisTask) {
    const otherLabel = timer ? `${timer.projectSlug.toUpperCase()}-${timer.taskNumber}` : "";
    return (
      <>
        <button
          type="button"
          onClick={() => (timer ? setConfirmSwitch(true) : start())}
          disabled={busy}
          className={ICON_BUTTON}
          aria-label="Start timer"
          title={timer ? `Stop the timer on ${otherLabel} and start one here` : "Start timer"}
          data-testid="timer-start"
        >
          <Play size={16} />
        </button>
        <ConfirmDialog
          isOpen={confirmSwitch}
          onClose={() => setConfirmSwitch(false)}
          onConfirm={() => {
            setConfirmSwitch(false);
            start();
          }}
          title="Switch timer"
          message={`Stop the timer on ${otherLabel}, log its time on today, and start one on this task?`}
          confirmLabel="Switch"
        />
      </>
    );
  }

  const running = Boolean(timer.startedAt);
  return (
    <>
      <div className="flex items-center gap-0.5" data-testid="timer-controls">
        <span
          className={cn(
            "px-1.5 text-xs font-mono tabular-nums",
            running ? "text-primary" : "text-muted-foreground",
          )}
          data-testid="timer-task-clock"
        >
          {formatClock(elapsed)}
        </span>
        <button
          type="button"
          onClick={() => void dispatch(running ? pauseTimer() : resumeTimer())}
          disabled={busy}
          className={ICON_BUTTON}
          aria-label={running ? "Pause timer" : "Resume timer"}
          title={running ? "Pause timer" : "Resume timer"}
          data-testid="timer-toggle"
        >
          {running ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </button>
        <button
          type="button"
          onClick={() => setStopping(true)}
          disabled={busy}
          className={cn(ICON_BUTTON, "hover:text-red-500")}
          aria-label="Stop timer"
          title="Stop timer"
          data-testid="timer-stop"
        >
          <Stop size={16} weight="fill" />
        </button>
      </div>
      {stopping && <LogTimeModal task={task} timer={timer} onClose={() => setStopping(false)} />}
    </>
  );
}
