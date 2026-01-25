/**
 * Quick Event Creation Modal
 * Opens when user clicks on an empty time slot
 */

import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '../../store/calendarUiSlice';
import { createEvent } from '../../store/calendarThunks';
import { cn } from '@/utils/cn';
import { MarkdownEditor } from '@/components/editor';

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
  initialDate = new Date(),
  initialStartHour = 9,
  initialEndHour = 10,
}: QuickEventModalProps) {
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editorKey, setEditorKey] = useState(0);
  const [isAllDay, setIsAllDay] = useState(false);
  const [startHour, setStartHour] = useState(initialStartHour);
  const [endHour, setEndHour] = useState(initialEndHour);
  const [selectedCalendarId, setSelectedCalendarId] = useState('work');
  const [selectedCategoryId, setSelectedCategoryId] = useState('cat-meeting');

  const calendars = useAppSelector((state) => state.calendar.calendars);
  const categories = useAppSelector((state) => state.calendar.categories);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setEditorKey((prev) => prev + 1); // Force editor remount
      setIsAllDay(false);
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
    }
  }, [isOpen, initialStartHour, initialEndHour, calendars, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      alert('Please enter an event title');
      return;
    }

    // Create start and end times (support 30-minute increments)
    const startTime = new Date(initialDate);
    const startMinutes = startHour % 1 === 0.5 ? 30 : 0;
    startTime.setHours(Math.floor(startHour), startMinutes, 0, 0);

    const endTime = new Date(initialDate);
    const endMinutes = endHour % 1 === 0.5 ? 30 : 0;
    endTime.setHours(Math.floor(endHour), endMinutes, 0, 0);

    // Create event via API
    const result = await dispatch(createEvent({
      title: title.trim(),
      description,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      isAllDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarId: selectedCalendarId,
      categoryId: selectedCategoryId,
      isFocusTime: selectedCategoryId === 'cat-deepwork',
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
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-96 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Event</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">
              Event Title
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

          {/* Description with @ mention support and formatting toolbar */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description (Optional)
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

          {/* Calendar & Category */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="calendar" className="block text-sm font-medium text-foreground mb-1">
                Calendar
              </label>
              <select
                id="calendar"
                value={selectedCalendarId}
                onChange={(e) => setSelectedCalendarId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {Object.entries(calendars).map(([id, cal]) => (
                  <option key={id} value={id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="category" className="block text-sm font-medium text-foreground mb-1">
                Category
              </label>
              <select
                id="category"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {Object.entries(categories).map(([id, cat]) => (
                  <option key={id} value={id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* All-day toggle */}
          <div className="flex items-center">
            <input
              id="allday"
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              className="w-4 h-4 border border-border rounded bg-background cursor-pointer"
            />
            <label htmlFor="allday" className="ml-2 text-sm text-foreground cursor-pointer">
              All-day event
            </label>
          </div>

          {/* Time selectors - 30-minute increments */}
          {!isAllDay && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="startHour" className="block text-sm font-medium text-foreground mb-1">
                  Start Time
                </label>
                <select
                  id="startHour"
                  value={startHour}
                  onChange={(e) => {
                    const newStart = parseFloat(e.target.value);
                    setStartHour(newStart);
                    if (newStart >= endHour) {
                      setEndHour(newStart + 0.5);
                    }
                  }}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Array.from({ length: 48 }, (_, i) => {
                    const timeValue = i * 0.5;
                    const hour = Math.floor(timeValue);
                    const minutes = timeValue % 1 === 0.5 ? '30' : '00';
                    const period = hour < 12 ? 'AM' : 'PM';
                    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                    return (
                      <option key={i} value={timeValue}>
                        {displayHour}:{minutes} {period}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label htmlFor="endHour" className="block text-sm font-medium text-foreground mb-1">
                  End Time
                </label>
                <select
                  id="endHour"
                  value={endHour}
                  onChange={(e) => setEndHour(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Array.from({ length: 48 }, (_, i) => {
                    const timeValue = i * 0.5;
                    const hour = Math.floor(timeValue);
                    const minutes = timeValue % 1 === 0.5 ? '30' : '00';
                    const period = hour < 12 ? 'AM' : 'PM';
                    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                    return (
                      <option key={i} value={timeValue} disabled={timeValue <= startHour}>
                        {displayHour}:{minutes} {period}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-foreground border border-border rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
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
        </form>
      </div>
    </>
  );
}
