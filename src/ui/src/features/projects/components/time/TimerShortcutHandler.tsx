import { useCallback } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useShortcutHandler } from "@/features/settings";
import { selectActiveTimer, selectTimerBusy } from "@/features/projects/store/timeSlice";
import { pauseTimer, resumeTimer, startTimer } from "@/features/projects/store/timeThunks";

const TASK_ROUTE = "/projects/:projectId/tasks/:taskId";

/** Renders nothing; the timer shortcut pauses or resumes the timer, or starts one on the open task. */
export function TimerShortcutHandler() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const timer = useAppSelector(selectActiveTimer);
  const busy = useAppSelector(selectTimerBusy);

  const handle = useCallback(() => {
    if (busy) return;
    if (timer) {
      void dispatch(timer.startedAt ? pauseTimer() : resumeTimer());
      return;
    }
    const taskId = matchPath(TASK_ROUTE, location.pathname)?.params.taskId;
    if (taskId) {
      void dispatch(startTimer({ taskId }));
      return;
    }
    toast.info("Open a task to start a timer");
  }, [busy, dispatch, location.pathname, timer]);

  useShortcutHandler("time.toggleTimer", handle);

  return null;
}
