import { useState, useEffect, useMemo } from "react";
import { getCurrentTimeInfo } from "@/features/calendar/utils";
import { GRID } from "@/features/calendar/constants";

interface CurrentTimeInfo {
  hour: number;
  minutes: number;
  percentOfHour: number;
  position: number;
  formattedTime: string;
}

export function useCurrentTime(
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT,
): CurrentTimeInfo {
  const [timeInfo, setTimeInfo] = useState(() => getCurrentTimeInfo());

  useEffect(() => {
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    // Align the first tick to the next minute boundary, then tick every minute.
    let interval: ReturnType<typeof setInterval> | null = null;
    const syncTimeout = setTimeout(() => {
      setTimeInfo(getCurrentTimeInfo());

      interval = setInterval(() => {
        setTimeInfo(getCurrentTimeInfo());
      }, 60000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(syncTimeout);
      if (interval !== null) clearInterval(interval);
    };
  }, []);

  const position = useMemo(() => {
    const totalMinutes = (timeInfo.hour - startHour) * 60 + timeInfo.minutes;
    return (totalMinutes / 60) * hourHeight;
  }, [timeInfo.hour, timeInfo.minutes, hourHeight, startHour]);

  const formattedTime = useMemo(() => {
    const { hour, minutes } = timeInfo;
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const period = hour < 12 ? "AM" : "PM";
    const minuteStr = minutes.toString().padStart(2, "0");
    return `${displayHour}:${minuteStr} ${period}`;
  }, [timeInfo]);

  return {
    ...timeInfo,
    position,
    formattedTime,
  };
}
