import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import {
  timerElapsedSeconds,
  timerToPlain,
  type SerializedTimer,
} from "@features/projects/timeSerializer";

export function timerQueryKey(organizationId: string | null) {
  return ["timer", organizationId] as const;
}

/** The person's one timer in the organization; the notification stream invalidates it on change. */
export function useActiveTimer() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: timerQueryKey(organizationId),
    queryFn: async () => {
      const response = await projectsApi.getActiveTimer({ organizationId: organizationId! });
      return response.timer ? timerToPlain(response.timer) : null;
    },
    enabled: !!organizationId,
    staleTime: 15_000,
  });
}

// One shared second ticker for every mounted clock; it runs only while someone listens.
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  interval ??= setInterval(() => listeners.forEach((fn) => fn()), 1000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const frozen = () => 0;
const subscribeNever = () => () => {};

/** Elapsed seconds, ticking while the timer runs and frozen while it is paused. */
export function useTimerElapsed(timer: SerializedTimer | null | undefined): number {
  const running = Boolean(timer?.startedAt);
  const nowSec = useSyncExternalStore(
    running ? subscribe : subscribeNever,
    running ? nowSeconds : frozen,
    frozen,
  );
  if (!timer) return 0;
  return timerElapsedSeconds(timer, running ? nowSec * 1000 : 0);
}
