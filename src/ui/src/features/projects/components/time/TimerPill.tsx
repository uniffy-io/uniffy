import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pause, Play, Stop, Timer as TimerIcon } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import {
  selectActiveTimer,
  selectTimePolicy,
  selectTimerBusy,
} from "@/features/projects/store/timeSlice";
import {
  fetchActiveTimer,
  fetchTimePolicy,
  pauseTimer,
  resumeTimer,
} from "@/features/projects/store/timeThunks";
import { formatClock } from "@/features/projects/utils/timerElapsed";
import { LogTimeModal } from "@/features/projects/components/time/LogTimeModal";
import { useTimerElapsed } from "@/features/projects/components/time/useTimerElapsed";

/** The running or paused timer in the top nav; below md it collapses to the icon and the clock. */
export function TimerPill() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const timer = useAppSelector(selectActiveTimer);
  const busy = useAppSelector(selectTimerBusy);
  const policy = useAppSelector(selectTimePolicy);
  const elapsed = useTimerElapsed(timer);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    void dispatch(fetchActiveTimer());
  }, [dispatch, organizationId]);

  useEffect(() => {
    if (timer && !policy) void dispatch(fetchTimePolicy());
  }, [dispatch, timer, policy]);

  if (!timer) return null;

  const running = Boolean(timer.startedAt);
  const limitPaused = !running && timer.pauseReason === "limit";
  const label = `${timer.projectSlug.toUpperCase()}-${timer.taskNumber}`;
  const title = limitPaused
    ? `${timer.taskTitle} (paused: the timer limit was reached)`
    : timer.taskTitle;

  return (
    <>
      <div className="flex items-center gap-0.5" data-testid="timer-pill">
        <button
          type="button"
          onClick={() => navigate(`/projects/${timer.projectId}/tasks/${timer.taskId}`)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md border px-1.5 transition-colors",
            running && "border-primary/30 bg-primary/10 hover:bg-primary/15",
            !running && !limitPaused && "border-border bg-muted/40 hover:bg-muted",
            limitPaused && "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15",
          )}
          title={title}
          aria-label={`Open ${label}, ${running ? "timer running" : "timer paused"}`}
          data-testid="timer-pill-open"
        >
          <TimerIcon
            size={14}
            weight={running ? "fill" : "regular"}
            className={cn(running ? "text-primary" : "text-muted-foreground")}
          />
          <span
            className="text-[11px] font-mono tabular-nums text-foreground"
            data-testid="timer-pill-clock"
          >
            {formatClock(elapsed)}
          </span>
          <span className="hidden md:inline text-[11px] text-muted-foreground">{label}</span>
          {limitPaused && (
            <span className="hidden md:inline text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              limit
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void dispatch(running ? pauseTimer() : resumeTimer())}
          disabled={busy}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          aria-label={running ? "Pause timer" : "Resume timer"}
          title={running ? "Pause timer" : "Resume timer"}
          data-testid="timer-pill-toggle"
        >
          {running ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
        </button>
        <button
          type="button"
          onClick={() => setStopping(true)}
          disabled={busy}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-red-500 disabled:opacity-50"
          aria-label="Stop timer"
          title="Stop timer"
          data-testid="timer-pill-stop"
        >
          <Stop size={14} weight="fill" />
        </button>
      </div>
      {stopping && (
        <LogTimeModal
          task={{ id: timer.taskId, title: timer.taskTitle }}
          timer={timer}
          onClose={() => setStopping(false)}
        />
      )}
    </>
  );
}
