/**
 * GridLines - Horizontal and vertical grid lines for the calendar
 */

import { GRID } from '../../constants';

interface GridLinesProps {
  columnCount: number;
  hourCount: number;
  topOffset?: number;
  hourHeight?: number;
}

export function GridLines({ columnCount, hourCount, topOffset = 0, hourHeight = GRID.HOUR_HEIGHT }: GridLinesProps) {
  const halfHourHeight = hourHeight / 2;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Horizontal lines (hours) */}
      {Array.from({ length: hourCount + 1 }).map((_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 right-0 border-t border-border/50"
          style={{ top: topOffset + i * hourHeight }}
        />
      ))}

      {/* Half-hour lines (subtle) */}
      {Array.from({ length: hourCount }).map((_, i) => (
        <div
          key={`hh-${i}`}
          className="absolute left-0 right-0 border-t border-border/30 border-dashed"
          style={{ top: topOffset + i * hourHeight + halfHourHeight }}
        />
      ))}

      {/* Vertical lines (day separators) */}
      {Array.from({ length: columnCount - 1 }).map((_, i) => (
        <div
          key={`v-${i}`}
          className="absolute border-l border-border"
          style={{
            left: `${((i + 1) / columnCount) * 100}%`,
            top: topOffset,
            bottom: 0,
          }}
        />
      ))}
    </div>
  );
}
