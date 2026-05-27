import { useState, useMemo, useEffect } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCurrentDate } from '@/features/calendar/store';
import {
  getMonthColumns,
  formatMonthYear,
  addMonths,
  parseISO,
  isDateToday,
  areSameDay,
} from '@/features/calendar/utils';
import { cn } from '@/shared/utils/cn';

const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function MiniCalendar() {
  const dispatch = useAppDispatch();
  const currentDate = useAppSelector((state) => state.calendarUi.currentDate);

  const [displayMonth, setDisplayMonth] = useState(() => parseISO(currentDate));

  // Track main calendar's month so navigation in either view stays in sync.
  useEffect(() => {
    const newDate = parseISO(currentDate);
    if (
      newDate.getMonth() !== displayMonth.getMonth() ||
      newDate.getFullYear() !== displayMonth.getFullYear()
    ) {
       
      setDisplayMonth(newDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  const monthColumns = useMemo(
    () => getMonthColumns(displayMonth),
    [displayMonth]
  );

  const monthTitle = formatMonthYear(displayMonth);

  const handlePreviousMonth = () => {
    setDisplayMonth((prev) => addMonths(prev, -1));
  };

  const handleNextMonth = () => {
    setDisplayMonth((prev) => addMonths(prev, 1));
  };

  const handleDateClick = (dateString: string) => {
    dispatch(setCurrentDate(dateString));
  };

  const weeks = useMemo(() => {
    const result: typeof monthColumns[] = [];
    for (let i = 0; i < monthColumns.length; i += 7) {
      result.push(monthColumns.slice(i, i + 7));
    }
    return result;
  }, [monthColumns]);

  return (
    <div className="bg-muted rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">{monthTitle}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handlePreviousMonth}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Previous month"
          >
            <CaretLeft size={12} weight="bold" className="text-muted-foreground" />
          </button>
          <button
            onClick={handleNextMonth}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Next month"
          >
            <CaretRight size={12} weight="bold" className="text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_HEADERS.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] text-muted-foreground py-1"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-1">
            {week.map((day) => {
              const isToday = isDateToday(day.date);
              const isSelected = areSameDay(day.date, currentDate);

              return (
                <button
                  key={day.dateString}
                  onClick={() => handleDateClick(day.dateString)}
                  className={cn(
                    'w-7 h-7 text-[11px] rounded-full flex items-center justify-center transition-colors',
                    !day.isCurrentMonth && 'text-muted-foreground/50',
                    day.isCurrentMonth && !isToday && !isSelected && 'text-muted-foreground hover:bg-muted-foreground/20',
                    day.isWeekend && day.isCurrentMonth && !isToday && !isSelected && 'text-muted-foreground/60',
                    isToday && !isSelected && 'bg-primary text-primary-foreground font-semibold',
                    isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                    isSelected && isToday && 'bg-primary text-primary-foreground font-semibold'
                  )}
                >
                  {day.dayNumber}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
