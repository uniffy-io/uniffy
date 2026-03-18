/**
 * EventBlock - Individual event block on the calendar grid
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent, startDrag, endDrag, openEditEvent } from '@/features/calendar/store';
import type { PositionedEvent } from '@/features/calendar/types';
import { hexToRgba, CATEGORY_COLORS } from '@/features/calendar/constants';
import { formatTimeRange } from '@/features/calendar/utils';
import { cn } from '@/shared/utils/cn';
import { Warning, Users, ArrowsClockwise } from '@phosphor-icons/react';

// Default color when category is not found
const DEFAULT_COLOR = CATEGORY_COLORS[0].value; // Blue

interface EventBlockProps {
  event: PositionedEvent;
  columnWidth: number;
}

export function EventBlock({ event, columnWidth }: EventBlockProps) {
  const dispatch = useAppDispatch();
  const selectedEventId = useAppSelector(
    (state) => state.calendarUi.selectedEventId
  );
  const categories = useAppSelector((state) => state.calendar.categories);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);

  const isSelected = selectedEventId === event.id;
  const isSharedEvent = event.organizerId !== currentUserId;
  const multiDayPosition = event.multiDayPosition ?? 'single';

  // Current user's RSVP status for this event
  const currentUserAttendee = currentUserId
    ? event.attendees.find((a) => a.id === currentUserId)
    : null;
  const isDeclined = currentUserAttendee?.status === 'declined';
  const isPendingOrTentative = currentUserAttendee != null
    && (currentUserAttendee.status === 'pending' || currentUserAttendee.status === 'tentative');

  // Determine if we should show content (only on start/single)
  const showContent = multiDayPosition === 'start' || multiDayPosition === 'single';

  // Look up category color from Redux state (real categories from backend)
  const category = event.categoryId ? categories[event.categoryId] : null;
  const categoryColor = category?.color ?? DEFAULT_COLOR;
  // Shared events have slightly more transparent background
  const backgroundColor = hexToRgba(categoryColor, isSharedEvent ? 0.07 : 0.1);

  const handleClick = () => {
    dispatch(selectEvent(event.id));
  };

  const handleDoubleClick = () => {
    dispatch(openEditEvent(event.id));
  };

  // Calculate position as percentages within the column
  const leftPercent = event.left * columnWidth;
  const widthPercent = event.width * columnWidth;

  // Check if event is short (less than 45 minutes display)
  const isShort = event.height < 45;

  // Determine border radius based on multi-day position
  const getBorderRadius = () => {
    switch (multiDayPosition) {
      case 'start':
        return '6px 0 0 6px'; // rounded left, flat right
      case 'middle':
        return '0'; // flat both sides
      case 'end':
        return '0 6px 6px 0'; // flat left, rounded right
      default:
        return '6px'; // rounded all (single day)
    }
  };

  // Get selection border styles based on multi-day position
  // Only show borders on outer edges, not between days
  const getSelectionBorderStyle = (): React.CSSProperties => {
    if (!isSelected) return {};

    const borderColor = 'hsl(var(--primary))';
    const borderWidth = '2px';

    switch (multiDayPosition) {
      case 'start':
        return {
          borderTop: `${borderWidth} solid ${borderColor}`,
          borderBottom: `${borderWidth} solid ${borderColor}`,
          borderLeft: `${borderWidth} solid ${borderColor}`,
          borderRight: 'none',
        };
      case 'middle':
        return {
          borderTop: `${borderWidth} solid ${borderColor}`,
          borderBottom: `${borderWidth} solid ${borderColor}`,
          borderLeft: 'none',
          borderRight: 'none',
        };
      case 'end':
        return {
          borderTop: `${borderWidth} solid ${borderColor}`,
          borderBottom: `${borderWidth} solid ${borderColor}`,
          borderLeft: 'none',
          borderRight: `${borderWidth} solid ${borderColor}`,
        };
      default: // single
        return {
          border: `${borderWidth} solid ${borderColor}`,
        };
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    // Only allow left click drag
    if (e.button !== 0) {
      e.preventDefault();
      return;
    }

    dispatch(startDrag(event.id));
    
    // Set ghost image effect
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', event.id); // Required for Firefox
    }
  };

  const handleDragEnd = () => {
    dispatch(endDrag());
  };

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={cn(
        'absolute overflow-hidden text-left transition-all',
        'hover:shadow-md hover:z-10 cursor-grab active:cursor-grabbing',
        isSelected && 'z-20'
      )}
      style={{
        top: event.top,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: event.height,
        backgroundColor,
        borderRadius: getBorderRadius(),
        opacity: isDeclined ? 0.35 : isPendingOrTentative ? 0.6 : 1,
        ...getSelectionBorderStyle(),
      }}
    >
      {/* Left color bar - only show on start/single */}
      {/* Shared events get a dashed pattern instead of solid */}
      {(multiDayPosition === 'start' || multiDayPosition === 'single') && (
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1',
            multiDayPosition === 'single' && 'rounded-l-md'
          )}
          style={{
            backgroundColor: isSharedEvent ? 'transparent' : categoryColor,
            backgroundImage: isSharedEvent
              ? `repeating-linear-gradient(to bottom, ${categoryColor} 0px, ${categoryColor} 4px, transparent 4px, transparent 8px)`
              : undefined,
          }}
        />
      )}

      {/* Content - only show on start/single */}
      {showContent && (
        <div className={cn('pl-2.5 pr-2', isShort ? 'py-0.5' : 'py-1.5')}>
          {/* Title with conflict and shared indicators */}
          <div
            className={cn(
              'font-semibold text-foreground truncate flex items-center gap-1',
              isShort ? 'text-[10px]' : 'text-xs'
            )}
          >
            {isSharedEvent && (
              <span title="Shared event">
                <Users
                  size={12}
                  weight="duotone"
                  className="text-muted-foreground flex-shrink-0"
                />
              </span>
            )}
            {(event.isRecurring || (event.recurrence && event.recurrence.pattern !== 'none')) && !event.recurrenceId && (
              <span title="Recurring event">
                <ArrowsClockwise
                  size={11}
                  weight="bold"
                  className="text-muted-foreground flex-shrink-0"
                />
              </span>
            )}
            {event.hasConflict && (
              <span title={`Conflicts with ${event.conflictingEvents?.length || 0} other event(s)`}>
                <Warning
                  size={12}
                  weight="duotone"
                  className="flex-shrink-0"
                  style={{ color: 'var(--status-warning)' }}
                />
              </span>
            )}
            <span className={cn('truncate', isDeclined && 'line-through')}>{event.title}</span>
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
      )}

      {/* Focus time indicator - only show on start/single */}
      {event.isFocusTime && showContent && (
        <div className="absolute top-1 right-1 text-[10px]">🔕</div>
      )}
    </button>
  );
}
