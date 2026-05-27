import { GRID, LAYOUT, DISPLAY_HOURS } from '@/features/calendar/constants';

/** Top padding to keep the first hour label from clipping. */
export const TIME_COLUMN_TOP_PADDING = 8;

interface TimeColumnProps {
  hourHeight?: number;
}

export function TimeColumn({ hourHeight = GRID.HOUR_HEIGHT }: TimeColumnProps) {
  const visibleHours = DISPLAY_HOURS.filter(
    (h) => h.hour >= GRID.START_HOUR && h.hour <= GRID.END_HOUR
  );

  return (
    <div
      className="flex-shrink-0 bg-muted/50 border-r border-border"
      style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
    >
      <div className="relative" style={{ paddingTop: TIME_COLUMN_TOP_PADDING }}>
        {visibleHours.map((hour) => (
          <div
            key={hour.hour}
            className="flex items-start justify-end pr-2 text-xs text-muted-foreground"
            style={{ height: hourHeight }}
          >
            {/* Lift label by half its line-height so it centers on the hour gridline. */}
            <span style={{ marginTop: -6 }}>{hour.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
