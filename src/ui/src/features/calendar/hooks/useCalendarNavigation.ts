/**
 * Hook for calendar date navigation
 */

import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  setCurrentDate,
  setViewMode,
  goToToday,
} from '@/features/calendar/store/calendarUiSlice';
import type { ViewMode } from '@/features/calendar/types';
import {
  navigateDate,
  getWeekDates,
  getWeekColumns,
  getMonthColumns,
  formatMonthYear,
  getDateRangeLabel,
  parseISO,
} from '@/features/calendar/utils';

/**
 * Hook for managing calendar navigation
 */
export function useCalendarNavigation() {
  const dispatch = useAppDispatch();
  const { currentDate, viewMode } = useAppSelector((state) => state.calendarUi);

  const currentDateObj = useMemo(() => parseISO(currentDate), [currentDate]);

  /**
   * Navigate to the previous period (day/week/month based on view mode)
   */
  const goToPrevious = useCallback(() => {
    const newDate = navigateDate(currentDate, 'previous', viewMode);
    dispatch(setCurrentDate(newDate.toISOString().split('T')[0]));
  }, [currentDate, viewMode, dispatch]);

  /**
   * Navigate to the next period (day/week/month based on view mode)
   */
  const goToNext = useCallback(() => {
    const newDate = navigateDate(currentDate, 'next', viewMode);
    dispatch(setCurrentDate(newDate.toISOString().split('T')[0]));
  }, [currentDate, viewMode, dispatch]);

  /**
   * Navigate to today
   */
  const handleGoToToday = useCallback(() => {
    dispatch(goToToday());
  }, [dispatch]);

  /**
   * Navigate to a specific date
   */
  const goToDate = useCallback(
    (date: Date | string) => {
      const dateString =
        typeof date === 'string' ? date : date.toISOString().split('T')[0];
      dispatch(setCurrentDate(dateString));
    },
    [dispatch]
  );

  /**
   * Change the view mode
   */
  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      dispatch(setViewMode(mode));
    },
    [dispatch]
  );

  /**
   * Get the header title based on current view
   */
  const headerTitle = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return formatMonthYear(currentDate);
      case 'week': {
        const weekDates = getWeekDates(currentDate);
        return getDateRangeLabel(weekDates[0], weekDates[6]);
      }
      case 'month':
        return formatMonthYear(currentDate);
      default:
        return formatMonthYear(currentDate);
    }
  }, [currentDate, viewMode]);

  /**
   * Get week dates for the current week
   */
  const weekDates = useMemo(
    () => getWeekDates(currentDate),
    [currentDate]
  );

  /**
   * Get day columns for the current week
   */
  const weekColumns = useMemo(
    () => getWeekColumns(currentDate),
    [currentDate]
  );

  /**
   * Get day columns for the current month
   */
  const monthColumns = useMemo(
    () => getMonthColumns(currentDate),
    [currentDate]
  );

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
