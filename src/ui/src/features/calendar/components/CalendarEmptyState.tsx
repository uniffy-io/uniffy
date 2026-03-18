import { CalendarDots } from '@phosphor-icons/react';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useAppDispatch } from '@/app/hooks';
import { openEventModal } from '@/features/calendar/store/calendarUiSlice';

export function CalendarEmptyState() {
  const dispatch = useAppDispatch();

  return (
    <EmptyState
      icon={CalendarDots}
      title="No events yet"
      description="Create your first event to start organizing your schedule. Events support attendees, categories, and recurring patterns."
      actionLabel="New Event"
      onAction={() => dispatch(openEventModal({ mode: 'create' }))}
      shortcutKey="calendar.newEvent"
      tips={[
        {
          color: 'primary',
          text: 'Click on any time slot to quickly create an event',
        },
        {
          color: 'emerald-500',
          text: 'Use categories to color-code your schedule',
        },
        {
          color: 'amber-500',
          text: 'Set up recurring events for regular meetings',
        },
      ]}
    />
  );
}
