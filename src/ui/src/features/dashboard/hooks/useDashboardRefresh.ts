// Auto-refresh is gated on document visibility - timers pause when the tab is hidden.

import { useCallback, useEffect, useRef, useState } from 'react';

const ACTIVITY_INTERVAL = 60_000;
const PRESENCE_INTERVAL = 30_000;

interface UseDashboardRefreshOptions {
  onRefreshActivity?: () => void;
  onRefreshPresence?: () => void;
}

export function useDashboardRefresh(options: UseDashboardRefreshOptions = {}) {
  const { onRefreshActivity, onRefreshPresence } = options;
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (activityTimerRef.current) {
      clearInterval(activityTimerRef.current);
      activityTimerRef.current = null;
    }
    if (presenceTimerRef.current) {
      clearInterval(presenceTimerRef.current);
      presenceTimerRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();

    if (onRefreshActivity) {
      activityTimerRef.current = setInterval(() => {
        onRefreshActivity();
        setLastRefreshed(new Date());
      }, ACTIVITY_INTERVAL);
    }

    if (onRefreshPresence) {
      presenceTimerRef.current = setInterval(() => {
        onRefreshPresence();
      }, PRESENCE_INTERVAL);
    }
  }, [clearTimers, onRefreshActivity, onRefreshPresence]);

  const manualRefresh = useCallback(() => {
    setIsRefreshing(true);
    onRefreshActivity?.();
    onRefreshPresence?.();
    setLastRefreshed(new Date());

    startTimers();

    setTimeout(() => {
      setIsRefreshing(false);
    }, 500);
  }, [onRefreshActivity, onRefreshPresence, startTimers]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimers();
      } else {
        onRefreshActivity?.();
        onRefreshPresence?.();
        setLastRefreshed(new Date());
        startTimers();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    startTimers();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimers();
    };
  }, [clearTimers, startTimers, onRefreshActivity, onRefreshPresence]);

  return {
    lastRefreshed,
    isRefreshing,
    manualRefresh,
  };
}
