/**
 * Quick Event Creation Modal
 * Opens when user clicks on an empty time slot
 */

import { useState, useEffect, useMemo } from 'react';
import { X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '../../store/calendarUiSlice';
import { createEvent } from '../../store/calendarThunks';
import { cn } from '@/utils/cn';
import { MarkdownEditor } from '@/components/editor';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { MemberInfo } from '@/gen/common/v1/common_pb';
import { AttendeesSelector } from './AttendeesSelector';
import type { Attendee } from '../../types';

/**
 * Get date string (YYYY-MM-DD) from Date object
 */
function getDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date for display
 */
function formatDateLabel(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Generate date options for the next 60 days and past 7 days
 */
function generateDateOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const today = new Date();

  // Past 7 days
  for (let i = 7; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = getDateString(date);
    options.push({ value: dateString, label: formatDateLabel(dateString) });
  }

  // Today and next 60 days
  for (let i = 0; i <= 60; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateString = getDateString(date);
    const label = i === 0 ? `Today, ${formatDateLabel(dateString)}` : formatDateLabel(dateString);
    options.push({ value: dateString, label });
  }

  return options;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

interface QuickEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDate?: Date;
  initialStartHour?: number;
  initialEndHour?: number;
}

export function QuickEventModal({
  isOpen,
  onClose,
  initialDate,
  initialStartHour = 9,
  initialEndHour = 10,
}: QuickEventModalProps) {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [isAllDay, setIsAllDay] = useState(false);
  const [startDate, setStartDate] = useState(getDateString(initialDate || new Date()));
  const [endDate, setEndDate] = useState(getDateString(initialDate || new Date()));
  const [startHour, setStartHour] = useState(initialStartHour);
  const [endHour, setEndHour] = useState(initialEndHour);
  const [selectedCalendarId, setSelectedCalendarId] = useState('work');
  const [selectedCategoryId, setSelectedCategoryId] = useState('cat-meeting');
  const [attendees, setAttendees] = useState<Attendee[]>([]);

  const calendars = useAppSelector((state) => state.calendar.calendars);
  const categories = useAppSelector((state) => state.calendar.categories);

  // Date options for all-day events
  const dateOptions = useMemo(() => generateDateOptions(), []);

  // Build options for Select components
  const calendarOptions = useMemo(
    () =>
      Object.entries(calendars).map(([id, cal]) => ({
        value: id,
        label: cal.name,
      })),
    [calendars]
  );

  const categoryOptions = useMemo(
    () =>
      Object.entries(categories).map(([id, cat]) => ({
        value: id,
        label: cat.name,
      })),
    [categories]
  );

  // Generate time options for 30-minute increments
  const timeOptions = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => {
        const timeValue = i * 0.5;
        const hour = Math.floor(timeValue);
        const minutes = timeValue % 1 === 0.5 ? '30' : '00';
        const period = hour < 12 ? 'AM' : 'PM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return {
          value: timeValue,
          label: `${displayHour}:${minutes} ${period}`,
        };
      }),
    []
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const date = initialDate || new Date();
      setTitle('');
      setDescription('');
      setEditorKey((prev) => prev + 1); // Force editor remount
      setIsAllDay(false);
      setStartDate(getDateString(date));
      setEndDate(getDateString(date));
      setStartHour(initialStartHour);
      setEndHour(initialEndHour);

      // Set default calendar to first available (prefer 'work' if exists)
      const calendarIds = Object.keys(calendars);
      if (calendarIds.length > 0) {
        setSelectedCalendarId(calendarIds.includes('work') ? 'work' : calendarIds[0]);
      }

      // Set default category to first available
      const categoryIds = Object.keys(categories);
      if (categoryIds.length > 0) {
        setSelectedCategoryId(categoryIds[0]);
      }
      setAttendees([]);
    }
    // Note: calendars and categories are intentionally NOT in the dependency array
    // to avoid infinite re-render loops. We only need to read their values once
    // when the modal opens, not react to every change.
    // initialDate is also excluded because it's an object that would cause re-renders
    // We only use it once when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialStartHour, initialEndHour]);

  const handleAttendeeAdd = (member: MemberInfo) => {
    if (attendees.some((a) => a.id === member.userId)) return;

    const newAttendee: Attendee = {
      id: member.userId,
      name: member.displayName || member.email,
      email: member.email,
      status: 'pending',
      role: 'required',
      initials: getInitials(member.displayName || member.email),
    };

    setAttendees((prev) => [...prev, newAttendee]);
  };

  const handleAttendeeRemove = (userId: string) => {
    setAttendees((prev) => prev.filter((a) => a.id !== userId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      alert('Please enter an event title');
      return;
    }

    let eventStartTime: Date;
    let eventEndTime: Date;

    if (isAllDay) {
      // For multi-day events, use start date + start time, end date + end time
      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
      const startMinutes = startHour % 1 === 0.5 ? 30 : 0;
      eventStartTime = new Date(startYear, startMonth - 1, startDay);
      eventStartTime.setHours(Math.floor(startHour), startMinutes, 0, 0);

      const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
      const endMinutes = endHour % 1 === 0.5 ? 30 : 0;
      eventEndTime = new Date(endYear, endMonth - 1, endDay);
      eventEndTime.setHours(Math.floor(endHour), endMinutes, 0, 0);
    } else {
      // For single-day events, use the selected date and time
      const [year, month, day] = startDate.split('-').map(Number);

      eventStartTime = new Date(year, month - 1, day);
      const startMinutes = startHour % 1 === 0.5 ? 30 : 0;
      eventStartTime.setHours(Math.floor(startHour), startMinutes, 0, 0);

      eventEndTime = new Date(year, month - 1, day);
      const endMinutes = endHour % 1 === 0.5 ? 30 : 0;
      eventEndTime.setHours(Math.floor(endHour), endMinutes, 0, 0);
    }

    // Create event via API
    const result = await dispatch(createEvent({
      title: title.trim(),
      description,
      startTime: eventStartTime.toISOString(),
      endTime: eventEndTime.toISOString(),
      isAllDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarId: selectedCalendarId,
      categoryId: selectedCategoryId,
      isFocusTime: selectedCategoryId === 'cat-deepwork',
      attendeeIds: attendees.map((a) => a.id),
    }));

    if (createEvent.fulfilled.match(result)) {
      dispatch(selectEvent(result.payload.id));
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-card rounded-lg shadow-xl z-50 w-[640px] max-h-[85vh] overflow-hidden flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Event</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1.5">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter event title..."
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Calendar & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Calendar
              </label>
              <Select
                value={selectedCalendarId}
                onChange={(value) => setSelectedCalendarId(value)}
                options={calendarOptions}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Category
              </label>
              <Select
                value={selectedCategoryId}
                onChange={(value) => setSelectedCategoryId(value)}
                options={categoryOptions}
                className="w-full"
              />
            </div>
          </div>

          {/* Multi-day toggle */}
          <Checkbox
            id="allday"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.target.checked)}
            label="Multi-day event"
          />

          {/* Date and Time selectors */}
          {isAllDay ? (
            <>
              {/* Multi-day: Start Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Start Date
                  </label>
                  <Select
                    value={startDate}
                    onChange={(value) => {
                      setStartDate(value);
                      // Ensure end date is not before start date
                      if (value > endDate) {
                        setEndDate(value);
                      }
                    }}
                    options={dateOptions}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Start Time
                  </label>
                  <Select
                    value={startHour}
                    onChange={(value) => {
                      setStartHour(value);
                      if (value >= endHour) {
                        setEndHour(value + 0.5);
                      }
                    }}
                    options={timeOptions}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Multi-day: End Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    End Date
                  </label>
                  <Select
                    value={endDate}
                    onChange={(value) => setEndDate(value)}
                    options={dateOptions.filter((opt) => opt.value >= startDate)}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    End Time
                  </label>
                  <Select
                    value={endHour}
                    onChange={(value) => setEndHour(value)}
                    options={timeOptions.filter((opt) => opt.value > startHour)}
                    className="w-full"
                  />
                </div>
              </div>
            </>
          ) : (
            /* Single-day: Time selectors only */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Start
                </label>
                <Select
                  value={startHour}
                  onChange={(value) => {
                    setStartHour(value);
                    if (value >= endHour) {
                      setEndHour(value + 0.5);
                    }
                  }}
                  options={timeOptions}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  End
                </label>
                <Select
                  value={endHour}
                  onChange={(value) => setEndHour(value)}
                  options={timeOptions.filter((opt) => opt.value > startHour)}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Description with @ mention support and formatting toolbar */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Description
            </label>
            <MarkdownEditor
              key={editorKey}
              value={description}
              onChange={setDescription}
              placeholder="Add notes, use @ to reference content..."
              minHeight="200px"
              maxHeight="300px"
              showBottomToolbar={true}
            />
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground mb-1.5">Attendees</label>
            <AttendeesSelector
              attendees={attendees}
              onAdd={handleAttendeeAdd}
              onRemove={handleAttendeeRemove}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 text-foreground border border-border rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className={cn(
              'flex-1 px-4 py-2 rounded-md font-medium transition-colors',
              title.trim()
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
            disabled={!title.trim()}
          >
            Create Event
          </button>
        </div>
      </div>
    </>
  );
}
