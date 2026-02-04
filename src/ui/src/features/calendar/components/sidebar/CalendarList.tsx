/**
 * CalendarList - List of user's calendars with visibility toggles
 */

import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  toggleCalendarVisibility,
  openAddCalendarModal,
  openEditCalendarModal,
  deleteCalendar,
} from '@/features/calendar/store';
import { SidebarSection } from '@/features/calendar/components/sidebar/SidebarSection';
import { cn } from '@/shared/utils/cn';

export function CalendarList() {
  const dispatch = useAppDispatch();
  const calendars = useAppSelector((state) => state.calendar.calendars);

  const handleToggle = (calendarId: string) => {
    dispatch(toggleCalendarVisibility(calendarId));
  };

  const handleEdit = (calendarId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch(openEditCalendarModal(calendarId));
  };

  const handleDelete = async (calendarId: string, calendarName: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.confirm(`Are you sure you want to delete "${calendarName}"? This will also delete all events in this calendar.`)) {
      return;
    }

    try {
      await dispatch(deleteCalendar(calendarId)).unwrap();
    } catch (error) {
      console.error('Failed to delete calendar:', error);
    }
  };

  const calendarArray = Object.values(calendars);

  return (
    <SidebarSection
      id="calendars"
      title="My Calendars"
      action={
        <span
          onClick={() => dispatch(openAddCalendarModal())}
          className="p-0.5 rounded hover:bg-muted cursor-pointer"
          title="Add Calendar"
        >
          <Plus size={14} weight="bold" className="text-muted-foreground" />
        </span>
      }
    >
      <div className="space-y-1">
        {calendarArray.map((calendar) => (
          <div
            key={calendar.id}
            className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {/* Custom checkbox - clickable to toggle visibility */}
            <button
              onClick={() => handleToggle(calendar.id)}
              className="flex items-center gap-2 flex-1 text-left min-w-0"
            >
              <div
                className={cn(
                  'w-3.5 h-3.5 rounded border transition-colors flex items-center justify-center flex-shrink-0',
                  calendar.isVisible
                    ? 'border-transparent'
                    : 'border-muted-foreground'
                )}
                style={{
                  backgroundColor: calendar.isVisible
                    ? calendar.color
                    : 'transparent',
                  borderColor: calendar.isVisible
                    ? calendar.color
                    : undefined,
                }}
              >
                {calendar.isVisible && (
                  <svg
                    className="w-2.5 h-2.5 text-primary-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <span className="truncate">{calendar.name}</span>
            </button>

            {/* Hover actions */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
              <span
                onClick={(e) => handleEdit(calendar.id, e)}
                className="p-0.5 rounded hover:bg-muted cursor-pointer"
                title="Edit"
              >
                <PencilSimple size={14} weight="duotone" className="text-muted-foreground" />
              </span>
              <span
                onClick={(e) => handleDelete(calendar.id, calendar.name, e)}
                className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                title="Delete"
              >
                <Trash size={14} weight="duotone" className="text-destructive" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </SidebarSection>
  );
}
