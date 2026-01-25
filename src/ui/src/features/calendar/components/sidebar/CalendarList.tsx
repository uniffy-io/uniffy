/**
 * CalendarList - List of user's calendars with visibility toggles
 */

import { useState, useRef, useEffect } from 'react';
import { PencilIcon, PlusIcon, TrashIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
  toggleCalendarVisibility,
  openAddCalendarModal,
  updateCalendarThunk,
  deleteCalendar,
} from '../../store';
import { SidebarSection } from './SidebarSection';
import { cn } from '@/utils/cn';

export function CalendarList() {
  const dispatch = useAppDispatch();
  const calendars = useAppSelector((state) => state.calendar.calendars);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleToggle = (calendarId: string) => {
    dispatch(toggleCalendarVisibility(calendarId));
  };

  const handleStartEdit = (calendarId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(calendarId);
    setEditName(currentName);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) {
      handleCancelEdit();
      return;
    }

    try {
      await dispatch(updateCalendarThunk({
        calendarId: editingId,
        name: editName.trim(),
      })).unwrap();
      handleCancelEdit();
    } catch (error) {
      console.error('Failed to update calendar:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
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
          <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      }
    >
      <div className="space-y-1">
        {calendarArray.map((calendar) => (
          <div
            key={calendar.id}
            className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {editingId === calendar.id ? (
              // Edit mode
              <>
                <div
                  className={cn(
                    'w-3.5 h-3.5 rounded border transition-colors flex items-center justify-center flex-shrink-0',
                    'border-transparent'
                  )}
                  style={{ backgroundColor: calendar.color }}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSaveEdit}
                  className="flex-1 bg-transparent border-b border-primary outline-none text-foreground text-sm min-w-0"
                />
                <div className="flex items-center gap-0.5">
                  <span
                    onClick={handleSaveEdit}
                    className="p-0.5 rounded hover:bg-muted cursor-pointer"
                    title="Save"
                  >
                    <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                  </span>
                  <span
                    onClick={handleCancelEdit}
                    className="p-0.5 rounded hover:bg-muted cursor-pointer"
                    title="Cancel"
                  >
                    <XMarkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </div>
              </>
            ) : (
              // View mode
              <>
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
                    onClick={(e) => handleStartEdit(calendar.id, calendar.name, e)}
                    className="p-0.5 rounded hover:bg-muted cursor-pointer"
                    title="Edit"
                  >
                    <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <span
                    onClick={(e) => handleDelete(calendar.id, calendar.name, e)}
                    className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer"
                    title="Delete"
                  >
                    <TrashIcon className="h-3.5 w-3.5 text-destructive" />
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </SidebarSection>
  );
}