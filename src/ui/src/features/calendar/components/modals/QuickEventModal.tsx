/**
 * Quick Event Creation Modal
 * Modern, clean design with visibility selector and reorganized layout
 */

import { useState, useEffect, useMemo } from 'react';
import {
  X,
  LockSimple,
  Buildings,
  Clock,
  Tag,
  TextAa,
  Users,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '@/features/calendar/store/calendarUiSlice';
import { createEvent } from '@/features/calendar/store/calendarThunks';
import { cn } from '@/shared/utils/cn';
import { MarkdownEditor } from '@/components/editor';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { MemberInfo } from '@/gen/common/v1/common_pb';
import { AttendeesSelector } from '@/features/calendar/components/modals/AttendeesSelector';
import type { Attendee } from '@/features/calendar/types';

type EventVisibility = 'private' | 'organization';

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

  for (let i = 7; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = getDateString(date);
    options.push({ value: dateString, label: formatDateLabel(dateString) });
  }

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

/**
 * Generate time options for 30-minute increments
 */
function generateTimeOptions() {
  return Array.from({ length: 48 }, (_, i) => {
    const timeValue = i * 0.5;
    const hour = Math.floor(timeValue);
    const minutes = timeValue % 1 === 0.5 ? '30' : '00';
    const period = hour < 12 ? 'AM' : 'PM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return {
      value: timeValue,
      label: `${displayHour}:${minutes} ${period}`,
    };
  });
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
  const [editorReady, setEditorReady] = useState(false);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [startDate, setStartDate] = useState(getDateString(initialDate || new Date()));
  const [endDate, setEndDate] = useState(getDateString(initialDate || new Date()));
  const [startHour, setStartHour] = useState(initialStartHour);
  const [endHour, setEndHour] = useState(initialEndHour);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [visibility, setVisibility] = useState<EventVisibility>('private');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const categories = useAppSelector((state) => state.calendar.categories);

  const dateOptions = useMemo(() => generateDateOptions(), []);
  const timeOptions = useMemo(() => generateTimeOptions(), []);

  const categoryOptions = useMemo(
    () =>
      Object.entries(categories).map(([id, cat]) => ({
        value: id,
        label: cat.name,
        color: cat.color,
      })),
    [categories]
  );

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const date = initialDate || new Date();
      setTitle('');
      setDescription('');
      setIsMultiDay(false);
      setStartDate(getDateString(date));
      setEndDate(getDateString(date));
      setStartHour(initialStartHour);
      setEndHour(initialEndHour);
      setVisibility('private');
      setIsSubmitting(false);

      const categoryIds = Object.keys(categories || {});
      if (categoryIds.length > 0) {
        setSelectedCategoryId(categoryIds[0]);
      }
      setAttendees([]);

      setEditorReady(false);
      const timer = setTimeout(() => {
        setEditorKey((prev) => prev + 1);
        setEditorReady(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setEditorReady(false);
    }
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

    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);

    let eventStartTime: Date;
    let eventEndTime: Date;

    if (isMultiDay) {
      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
      const startMinutes = startHour % 1 === 0.5 ? 30 : 0;
      eventStartTime = new Date(startYear, startMonth - 1, startDay);
      eventStartTime.setHours(Math.floor(startHour), startMinutes, 0, 0);

      const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
      const endMinutes = endHour % 1 === 0.5 ? 30 : 0;
      eventEndTime = new Date(endYear, endMonth - 1, endDay);
      eventEndTime.setHours(Math.floor(endHour), endMinutes, 0, 0);
    } else {
      const [year, month, day] = startDate.split('-').map(Number);

      eventStartTime = new Date(year, month - 1, day);
      const startMinutes = startHour % 1 === 0.5 ? 30 : 0;
      eventStartTime.setHours(Math.floor(startHour), startMinutes, 0, 0);

      eventEndTime = new Date(year, month - 1, day);
      const endMinutes = endHour % 1 === 0.5 ? 30 : 0;
      eventEndTime.setHours(Math.floor(endHour), endMinutes, 0, 0);
    }

    const result = await dispatch(
      createEvent({
        title: title.trim(),
        description,
        startTime: eventStartTime.toISOString(),
        endTime: eventEndTime.toISOString(),
        isAllDay: isMultiDay,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        calendarId: '',
        categoryId: selectedCategoryId || undefined,
        isFocusTime: selectedCategoryId === 'cat-deepwork',
        attendeeIds: attendees.map((a) => a.id),
        visibility,
      })
    );

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
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xl animate-in zoom-in-95 fade-in duration-200">
        <div className="bg-background rounded-xl shadow-2xl border border-border overflow-hidden relative">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10"
          >
            <X size={18} weight="bold" />
          </button>

          {/* Form */}
          <form onSubmit={handleSubmit} className="max-h-[calc(85vh-80px)] overflow-y-auto">
            <div className="p-5 pt-12 space-y-5">
              {/* Visibility Selector */}
              <div className="flex gap-2 p-1 bg-muted/50 rounded-lg">
                <button
                  type="button"
                  onClick={() => setVisibility('private')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                    visibility === 'private'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <LockSimple size={16} weight={visibility === 'private' ? 'fill' : 'duotone'} />
                  <span>Personal</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('organization')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all',
                    visibility === 'organization'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <Buildings size={16} weight={visibility === 'organization' ? 'fill' : 'duotone'} />
                  <span>Organization</span>
                </button>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TextAa size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Title</span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What's the event?"
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  autoFocus
                />
              </div>

              {/* Attendees - Moved up */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Attendees</span>
                </div>
                <AttendeesSelector
                  attendees={attendees}
                  onAdd={handleAttendeeAdd}
                  onRemove={handleAttendeeRemove}
                />
              </div>

              {/* Date & Time */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Clock size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Date & Time</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMultiDay(!isMultiDay)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span
                      className={cn(
                        'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                        isMultiDay
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground'
                      )}
                    />
                    <span>Multi-day</span>
                  </button>
                </div>

                {isMultiDay ? (
                  <div className="space-y-3">
                    {/* Start */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">Start Date</label>
                        <Select
                          value={startDate}
                          onChange={(value) => {
                            setStartDate(value);
                            if (value > endDate) {
                              setEndDate(value);
                            }
                          }}
                          options={dateOptions}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">Start Time</label>
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
                    {/* End */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">End Date</label>
                        <Select
                          value={endDate}
                          onChange={setEndDate}
                          options={dateOptions.filter((opt) => opt.value >= startDate)}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">End Time</label>
                        <Select
                          value={endHour}
                          onChange={setEndHour}
                          options={timeOptions.filter((opt) => opt.value > startHour)}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">Start</label>
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
                      <label className="block text-xs text-muted-foreground mb-1.5">End</label>
                      <Select
                        value={endHour}
                        onChange={setEndHour}
                        options={timeOptions.filter((opt) => opt.value > startHour)}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Category */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Tag size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Category</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {categoryOptions.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.value)}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-lg border transition-all',
                        selectedCategoryId === cat.value
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-2"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TextAa size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Description</span>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                {editorReady ? (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <MarkdownEditor
                      key={editorKey}
                      value={description}
                      onChange={setDescription}
                      placeholder="Add notes, use @ to reference content..."
                      minHeight="120px"
                      maxHeight="200px"
                      showBottomToolbar={true}
                    />
                  </div>
                ) : (
                  <div className="min-h-[120px] border border-border rounded-lg bg-muted/30 animate-pulse" />
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/20">
              <Button type="button" variant="outline" size="md" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="md"
                disabled={!title.trim() || isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? 'Creating...' : 'Create Event'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
