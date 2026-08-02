import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent, startDrag, endDrag } from '@/features/calendar/store';
import type { PositionedEvent } from '@/features/calendar/types';
import { ACCENT_EVENT_COLOR, eventTint } from '@/features/calendar/constants';
import { formatTimeRange } from '@/features/calendar/utils';
import { cn } from '@/shared/utils/cn';
import { Warning, Users, ArrowsClockwise } from '@phosphor-icons/react';
import { SubjectAvatar, SUBJECT_TYPE } from '@/components/subject';

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

  const currentUserAttendee = currentUserId
    ? event.attendees.find((a) => a.id === currentUserId)
    : null;
  const isDeclined = currentUserAttendee?.status === 'declined';
  const isPendingOrTentative = currentUserAttendee != null
    && (currentUserAttendee.status === 'pending' || currentUserAttendee.status === 'tentative');

  // Middle/end day segments of a multi-day event hide the label.
  const showContent = multiDayPosition === 'start' || multiDayPosition === 'single';

  const category = event.categoryId ? categories[event.categoryId] : null;
  const categoryColor = category?.color ?? ACCENT_EVENT_COLOR;
  const backgroundColor = eventTint(categoryColor, isSharedEvent ? 7 : 10);

  const handleClick = () => {
    dispatch(selectEvent(event.id));
  };

  const leftPercent = event.left * columnWidth;
  const widthPercent = event.width * columnWidth;

  const isShort = event.height < 45;

  // Multi-day spans round only on outer edges so adjacent day segments visually connect.
  const getBorderRadius = () => {
    switch (multiDayPosition) {
      case 'start':
        return '6px 0 0 6px';
      case 'middle':
        return '0';
      case 'end':
        return '0 6px 6px 0';
      default:
        return '6px';
    }
  };

  // Selection borders skip the seams between day segments.
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
      default:
        return {
          border: `${borderWidth} solid ${borderColor}`,
        };
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (e.button !== 0) {
      e.preventDefault();
      return;
    }

    dispatch(startDrag(event.id));

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Firefox requires non-empty dataTransfer data to fire drag events.
      e.dataTransfer.setData('text/plain', event.id);
    }
  };

  const handleDragEnd = () => {
    dispatch(endDrag());
  };

  return (
    <button
      onClick={handleClick}
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
        boxShadow: event.hasConflict && !isSelected
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--status-warning) 50%, transparent)'
          : undefined,
        ...getSelectionBorderStyle(),
      }}
    >
      {/* Shared events render the color bar as a dashed pattern. */}
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

      {showContent && (
        <div className={cn('pl-2.5 pr-2', isShort ? 'py-0.5' : 'py-1.5')}>
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

          {!isShort && (
            <div className="text-[10px] text-muted-foreground truncate">
              {formatTimeRange(event.startTime, event.endTime)}
            </div>
          )}

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

          {event.height > 80 && event.attendees.length > 0 && (
            <div className="mt-2 flex -space-x-1.5">
              {event.attendees.slice(0, 3).map((attendee) => (
                <SubjectAvatar
                  key={attendee.id}
                  subject={{
                    id: attendee.id,
                    type: SUBJECT_TYPE.USER,
                    name: attendee.name,
                    email: attendee.email,
                    avatarUrl: attendee.avatarUrl,
                  }}
                  size="xs"
                  bordered
                />
              ))}
              {event.attendees.length > 3 && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium bg-muted text-muted-foreground border-2 border-card">
                  +{event.attendees.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {event.isFocusTime && showContent && (
        <div className="absolute top-1 right-1 text-[10px]">🔕</div>
      )}
    </button>
  );
}
