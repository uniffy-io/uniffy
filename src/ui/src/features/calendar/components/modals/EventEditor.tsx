/**
 * Event Editor Modal
 * Modern design with visibility selector and reorganized layout
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
  MapPin,
  Link as LinkIcon,
  Timer,
  Bell,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEvent } from '@/features/calendar/store/calendarThunks';
import type { CalendarEvent, Attendee } from '@/features/calendar/types';
import { cn } from '@/shared/utils/cn';
import { MarkdownEditor } from '@/components/editor';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { MemberInfo } from '@/gen/common/v1/common_pb';
import { AttendeesSelector } from '@/features/calendar/components/modals/AttendeesSelector';
import { ReminderSelector } from '@/features/calendar/components/modals/ReminderSelector';
import { TimeSelect } from '@/features/calendar/components/modals/TimeSelect';

type EventVisibility = 'private' | 'organization';

/**
 * Extract time value (hours as decimal) from ISO string.
 * Preserves exact minutes (e.g. 9:15 -> 9.25, 14:45 -> 14.75).
 */
function getTimeValue(isoString: string): number {
  const date = new Date(isoString);
  return date.getHours() + date.getMinutes() / 60;
}

/**
 * Extract date string (YYYY-MM-DD) from ISO string
 */
function getDateString(isoString: string): string {
  const date = new Date(isoString);
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
 * Generate date options for the next 60 days and past 30 days
 */
function generateDateOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const today = new Date();

  for (let i = 30; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    options.push({ value: dateString, label: formatDateLabel(dateString) });
  }

  for (let i = 0; i <= 60; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

interface EventEditorProps {
  event: CalendarEvent;
  isOpen: boolean;
  onClose: () => void;
}

export function EventEditor({ event, isOpen, onClose }: EventEditorProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);

  const [formData, setFormData] = useState(event);
  const [visibility, setVisibility] = useState<EventVisibility>(
    (event.visibility as EventVisibility) || 'private'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const categoryOptions = useMemo(
    () =>
      Object.entries(categories).map(([id, cat]) => ({
        value: id,
        label: cat.name,
        color: cat.color,
      })),
    [categories]
  );

  const dateOptions = useMemo(() => generateDateOptions(), []);

  const startDate = useMemo(() => getDateString(formData.startTime), [formData.startTime]);
  const startTime = useMemo(() => getTimeValue(formData.startTime), [formData.startTime]);
  const endDate = useMemo(() => getDateString(formData.endTime), [formData.endTime]);
  const endTime = useMemo(() => getTimeValue(formData.endTime), [formData.endTime]);

  const handleStartDateChange = (newDate: string) => {
    const current = new Date(formData.startTime);
    const [year, month, day] = newDate.split('-').map(Number);
    current.setFullYear(year, month - 1, day);
    handleChange('startTime', current.toISOString());
  };

  const handleStartTimeChange = (newTime: number) => {
    const current = new Date(formData.startTime);
    const hours = Math.floor(newTime);
    const minutes = Math.round((newTime % 1) * 60);
    current.setHours(hours, minutes, 0, 0);
    handleChange('startTime', current.toISOString());

    const endDateTime = new Date(formData.endTime);
    if (current >= endDateTime) {
      const newEnd = new Date(current);
      newEnd.setMinutes(newEnd.getMinutes() + 30);
      handleChange('endTime', newEnd.toISOString());
    }
  };

  const handleEndDateChange = (newDate: string) => {
    const current = new Date(formData.endTime);
    const [year, month, day] = newDate.split('-').map(Number);
    current.setFullYear(year, month - 1, day);
    handleChange('endTime', current.toISOString());
  };

  const handleEndTimeChange = (newTime: number) => {
    const current = new Date(formData.endTime);
    const hours = Math.floor(newTime);
    const minutes = Math.round((newTime % 1) * 60);
    current.setHours(hours, minutes, 0, 0);
    handleChange('endTime', current.toISOString());
  };

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(event);
      setVisibility((event.visibility as EventVisibility) || 'private');
      setIsSubmitting(false);
    }
  }, [event, isOpen]);

  const handleChange = (field: keyof CalendarEvent, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleAttendeeAdd = (member: MemberInfo) => {
    if (formData.attendees.some((a) => a.id === member.userId)) return;

    const newAttendee: Attendee = {
      id: member.userId,
      name: member.displayName || member.email,
      email: member.email,
      status: 'pending',
      role: 'required',
      initials: getInitials(member.displayName || member.email),
    };

    setFormData((prev) => ({
      ...prev,
      attendees: [...prev.attendees, newAttendee],
    }));
  };

  const handleAttendeeRemove = (userId: string) => {
    setFormData((prev) => ({
      ...prev,
      attendees: prev.attendees.filter((a) => a.id !== userId),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    await dispatch(
      updateEvent({
        eventId: formData.id,
        title: formData.title,
        description: formData.description,
        startTime: formData.startTime,
        endTime: formData.endTime,
        isAllDay: formData.isAllDay,
        timezone: formData.timezone,
        location: formData.location,
        meetingUrl: formData.meetingUrl,
        calendarId: formData.calendarId,
        categoryId: formData.categoryId,
        isFocusTime: formData.isFocusTime,
        tags: formData.tags,
        attendeeIds: formData.attendees.map((a) => a.id),
        visibility,
        reminders: formData.reminders,
      })
    );
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
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl animate-in zoom-in-95 fade-in duration-200">
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
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                />
              </div>

              {/* Attendees - Moved up */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Attendees</span>
                </div>
                <AttendeesSelector
                  attendees={formData.attendees}
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
                    onClick={() => handleChange('isAllDay', !formData.isAllDay)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span
                      className={cn(
                        'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                        formData.isAllDay
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground'
                      )}
                    />
                    <span>Multi-day</span>
                  </button>
                </div>

                {formData.isAllDay ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">Start Date</label>
                        <Select
                          value={startDate}
                          onChange={handleStartDateChange}
                          options={dateOptions}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">Start Time</label>
                        <TimeSelect
                          value={startTime}
                          onChange={handleStartTimeChange}
                          className="w-full"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">End Date</label>
                        <Select
                          value={endDate}
                          onChange={handleEndDateChange}
                          options={dateOptions}
                          className="w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1.5">End Time</label>
                        <TimeSelect
                          value={endTime}
                          onChange={handleEndTimeChange}
                          className="w-full"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">Start</label>
                      <TimeSelect
                        value={startTime}
                        onChange={handleStartTimeChange}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">End</label>
                      <TimeSelect
                        value={endTime}
                        onChange={handleEndTimeChange}
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
                      onClick={() => handleChange('categoryId', cat.value)}
                      className={cn(
                        'px-3 py-1.5 text-sm rounded-lg border transition-all',
                        formData.categoryId === cat.value
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

              {/* Location & Meeting URL */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <MapPin size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Location</span>
                  </div>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => handleChange('location', e.target.value)}
                    placeholder="Add location..."
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <LinkIcon size={16} weight="duotone" className="text-muted-foreground" />
                    <span>Meeting URL</span>
                  </div>
                  <input
                    type="url"
                    value={formData.meetingUrl || ''}
                    onChange={(e) => handleChange('meetingUrl', e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>
              </div>

              {/* Focus Time */}
              <button
                type="button"
                onClick={() => handleChange('isFocusTime', !formData.isFocusTime)}
                className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg w-full hover:bg-muted/50 transition-colors"
              >
                <Timer size={20} weight="duotone" className="text-muted-foreground" />
                <span
                  className={cn(
                    'w-3.5 h-3.5 rounded-full border-2 transition-colors',
                    formData.isFocusTime
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  )}
                />
                <span className="text-sm text-foreground">Focus/Deep Work Time</span>
              </button>

              {/* Reminders */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Bell size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Reminders</span>
                </div>
                <ReminderSelector
                  value={formData.reminders}
                  onChange={(reminders) => handleChange('reminders', reminders)}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TextAa size={16} weight="duotone" className="text-muted-foreground" />
                  <span>Description</span>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <MarkdownEditor
                    value={formData.description}
                    onChange={(markdown) => handleChange('description', markdown)}
                    placeholder="Add notes, use @ to reference content..."
                    minHeight="120px"
                    maxHeight="200px"
                    showBottomToolbar={true}
                  />
                </div>
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
                disabled={!formData.title.trim() || isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
