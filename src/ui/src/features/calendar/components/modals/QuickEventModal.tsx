/**
 * Quick Event Creation Modal
 * Opens when user clicks on an empty time slot
 */

import { useState, useEffect, useMemo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '../../store/calendarUiSlice';
import { createEvent } from '../../store/calendarThunks';
import { cn } from '@/utils/cn';
import { MarkdownEditor } from '@/components/editor';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

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
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-card rounded-lg shadow-xl z-50 w-[640px] max-h-[85vh] overflow-hidden flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Event</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
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

          {/* All-day toggle */}
          <Checkbox
            id="allday"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.target.checked)}
            label="All-day event"
          />

          {/* Time selectors */}
          {!isAllDay && (
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
