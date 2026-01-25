/**
 * TimeColumn - Left column showing time labels
 */

import { GRID, LAYOUT, DISPLAY_HOURS } from '../../constants';

// Top padding to prevent first time label from being cut off
export const TIME_COLUMN_TOP_PADDING = 8;

interface TimeColumnProps {
  hourHeight?: number;
}

export function TimeColumn({ hourHeight = GRID.HOUR_HEIGHT }: TimeColumnProps) {
  // Filter hours to display
  const visibleHours = DISPLAY_HOURS.filter(
    (h) => h.hour >= GRID.START_HOUR && h.hour <= GRID.END_HOUR
  );

  return (
    <div
      className="flex-shrink-0 bg-muted/50 border-r border-border"
      style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
    >
      {/* Time labels - each label is positioned at the top of its hour block */}
      <div className="relative" style={{ paddingTop: TIME_COLUMN_TOP_PADDING }}>
        {visibleHours.map((hour) => (
          <div
            key={hour.hour}
            className="flex items-start justify-end pr-2 text-xs text-muted-foreground"
            style={{ height: hourHeight }}
          >
            {/* Offset text up by half line-height to center on the hour line */}
            <span style={{ marginTop: -6 }}>{hour.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
