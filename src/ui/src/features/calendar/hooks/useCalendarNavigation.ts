import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setCurrentDate, setViewMode, goToToday } from "@/features/calendar/store/calendarUiSlice";
import type { ViewMode } from "@/features/calendar/types";
import {
  navigateDate,
  getWeekDates,
  getWeekColumns,
  getMonthColumns,
  formatMonthYear,
  getDateRangeLabel,
  parseISO,
} from "@/features/calendar/utils";

export function useCalendarNavigation() {
  const dispatch = useAppDispatch();
  const { currentDate, viewMode } = useAppSelector((state) => state.calendarUi);

  const currentDateObj = useMemo(() => parseISO(currentDate), [currentDate]);

  const goToPrevious = useCallback(() => {
    const newDate = navigateDate(currentDate, "previous", viewMode);
    dispatch(setCurrentDate(newDate.toISOString().split("T")[0]));
  }, [currentDate, viewMode, dispatch]);

  const goToNext = useCallback(() => {
    const newDate = navigateDate(currentDate, "next", viewMode);
    dispatch(setCurrentDate(newDate.toISOString().split("T")[0]));
  }, [currentDate, viewMode, dispatch]);

  const handleGoToToday = useCallback(() => {
    dispatch(goToToday());
  }, [dispatch]);

  const goToDate = useCallback(
    (date: Date | string) => {
      const dateString = typeof date === "string" ? date : date.toISOString().split("T")[0];
      dispatch(setCurrentDate(dateString));
    },
    [dispatch],
  );

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      dispatch(setViewMode(mode));
    },
    [dispatch],
  );

  const headerTitle = useMemo(() => {
    switch (viewMode) {
      case "day":
        return formatMonthYear(currentDate);
      case "week": {
        const weekDates = getWeekDates(currentDate);
        return getDateRangeLabel(weekDates[0], weekDates[6]);
      }
      case "month":
        return formatMonthYear(currentDate);
      default:
        return formatMonthYear(currentDate);
    }
  }, [currentDate, viewMode]);

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  const weekColumns = useMemo(() => getWeekColumns(currentDate), [currentDate]);

  const monthColumns = useMemo(() => getMonthColumns(currentDate), [currentDate]);

  return {
    currentDate,
    currentDateObj,
    viewMode,
    headerTitle,
    weekDates,
    weekColumns,
    monthColumns,
    goToPrevious,
    goToNext,
    goToToday: handleGoToToday,
    goToDate,
    changeViewMode,
  };
}
