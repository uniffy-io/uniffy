/**
 * EventBlock - Individual event block on the calendar grid
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '../../store';
import type { PositionedEvent } from '../../types';
import { getCategoryColor, getCategoryBackgroundColor } from '../../constants';
import { formatTimeRange } from '../../utils';
import { cn } from '@/utils/cn';

interface EventBlockProps {
  event: PositionedEvent;
  columnWidth: number;
}

export function EventBlock({ event, columnWidth }: EventBlockProps) {
  const dispatch = useAppDispatch();
  const selectedEventId = useAppSelector(
    (state) => state.calendarUi.selectedEventId
  );

  const isSelected = selectedEventId === event.id;
  const categoryColor = getCategoryColor(event.categoryId);
  const backgroundColor = getCategoryBackgroundColor(event.categoryId);

  const handleClick = () => {
    dispatch(selectEvent(event.id));
  };

  // Calculate position as percentages within the column
  const leftPercent = event.left * columnWidth;
  const widthPercent = event.width * columnWidth;

  // Check if event is short (less than 45 minutes display)
  const isShort = event.height < 45;

  return (
    <button
      onClick={handleClick}
      className={cn(
        'absolute rounded-md overflow-hidden text-left transition-all',
        'hover:shadow-md hover:z-10',
        isSelected && 'ring-2 ring-primary z-20'
      )}
      style={{
        top: event.top,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: event.height,
        backgroundColor,
      }}
    >
      {/* Left color bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
        style={{ backgroundColor: categoryColor }}
      />

      {/* Content */}
      <div className={cn('pl-2.5 pr-2', isShort ? 'py-0.5' : 'py-1.5')}>
        {/* Title */}
        <div
          className={cn(
            'font-semibold text-foreground truncate',
            isShort ? 'text-[10px]' : 'text-xs'
          )}
        >
          {event.title}
        </div>

        {/* Time (hide for short events) */}
        {!isShort && (
          <div className="text-[10px] text-muted-foreground truncate">
            {formatTimeRange(event.startTime, event.endTime)}
          </div>
        )}

        {/* Resource indicators (for taller events) */}
        {event.height > 60 && event.linkedResources.length > 0 && (
          <div className="absolute bottom-1 right-2 flex gap-0.5 text-[10px] text-muted-foreground">
            {event.linkedResources.slice(0, 3).map((resource) => (
              <span key={resource.id}>
                {resource.type === 'note'
                  ? '📄'
                  : resource.type === 'file'
                  ? '📁'
                  : '💬'}
              </span>
            ))}
          </div>
        )}

        {/* Attendee avatars (for taller events) */}
        {event.height > 80 && event.attendees.length > 0 && (
          <div className="mt-2 flex -space-x-1.5">
            {event.attendees.slice(0, 3).map((attendee, index) => (
              <div
                key={attendee.id}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-medium border-2 border-white"
                style={{
                  backgroundColor: ['#3B82F6', '#8B5CF6', '#10B981'][
                    index % 3
                  ],
                  zIndex: 3 - index,
                }}
              >
                {attendee.initials}
              </div>
            ))}
            {event.attendees.length > 3 && (
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-medium bg-gray-400 border-2 border-white">
                +{event.attendees.length - 3}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Focus time indicator */}
      {event.isFocusTime && (
        <div className="absolute top-1 right-1 text-[10px]">🔕</div>
      )}
    </button>
  );
}
