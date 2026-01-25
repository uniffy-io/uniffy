/**
 * Hook for tracking current time for the time indicator
 */

import { useState, useEffect, useMemo } from 'react';
import { getCurrentTimeInfo, isDateToday } from '../utils';
import { GRID } from '../constants';

interface CurrentTimeInfo {
  hour: number;
  minutes: number;
  percentOfHour: number;
  position: number;
  formattedTime: string;
}

/**
 * Hook that tracks the current time and updates every minute
 * Used for the red current time indicator line
 */
export function useCurrentTime(
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT
): CurrentTimeInfo {
  const [timeInfo, setTimeInfo] = useState(() => getCurrentTimeInfo());

  useEffect(() => {
    // Update immediately - this is intentional for syncing with external time
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeInfo(getCurrentTimeInfo());

    // Calculate delay until the next minute
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    // Set up first timeout to sync to minute boundary
    const syncTimeout = setTimeout(() => {
      setTimeInfo(getCurrentTimeInfo());

      // Then set up interval for every minute
      const interval = setInterval(() => {
        setTimeInfo(getCurrentTimeInfo());
      }, 60000);

      return () => clearInterval(interval);
    }, msUntilNextMinute);

    return () => clearTimeout(syncTimeout);
  }, []);

  // Calculate position based on current time
  const position = useMemo(() => {
    // Use timeInfo values to calculate position
    const totalMinutes = (timeInfo.hour - startHour) * 60 + timeInfo.minutes;
    return (totalMinutes / 60) * hourHeight;
  }, [timeInfo.hour, timeInfo.minutes, hourHeight, startHour]);

  // Format time for display
  const formattedTime = useMemo(() => {
    const { hour, minutes } = timeInfo;
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const period = hour < 12 ? 'AM' : 'PM';
    const minuteStr = minutes.toString().padStart(2, '0');
    return `${displayHour}:${minuteStr} ${period}`;
  }, [timeInfo]);

  return {
    ...timeInfo,
    position,
    formattedTime,
  };
}

/**
 * Hook to check if a given date is today
 * Used to show/hide the current time indicator
 */
export function useIsToday(date: Date | string): boolean {
  const [today, setToday] = useState(() => isDateToday(date));

  useEffect(() => {
    // Check every minute in case we cross midnight
    const interval = setInterval(() => {
      setToday(isDateToday(date));
    }, 60000);

    return () => clearInterval(interval);
  }, [date]);

  return today;
}
