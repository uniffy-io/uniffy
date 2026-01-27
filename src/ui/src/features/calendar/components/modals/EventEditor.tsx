/**
 * Event Editor Modal
 * Full form for editing event details
 */

import { useState, useEffect, useMemo } from 'react';
import { X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEvent } from '../../store/calendarThunks';
import type { CalendarEvent } from '../../types';
import { cn } from '@/utils/cn';
import { MarkdownEditor } from '@/components/editor';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { MemberInfo } from '@/gen/common/v1/common_pb';
import { AttendeesSelector } from './AttendeesSelector';
import type { Attendee } from '../../types';

/**
 * Extract time value (hours as decimal) from ISO string
 */
function getTimeValue(isoString: string): number {
  const date = new Date(isoString);
  return date.getHours() + (date.getMinutes() >= 30 ? 0.5 : 0);
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

  // Past 30 days
  for (let i = 30; i >= 1; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    options.push({ value: dateString, label: formatDateLabel(dateString) });
  }

  // Today and next 60 days
  for (let i = 0; i <= 60; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const label = i === 0 ? `Today, ${formatDateLabel(dateString)}` : formatDateLabel(dateString);
    options.push({ value: dateString, label });
  }

  return options;
}

/**
 * Generate time options for 30-minute increments
 */
function generateTimeOptions(): { value: number; label: string }[] {
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
  const calendars = useAppSelector((state) => state.calendar.calendars);
  const categories = useAppSelector((state) => state.calendar.categories);

  const [formData, setFormData] = useState(event);
  const [activeTab, setActiveTab] = useState<'basic' | 'details' | 'attendees'>('basic');

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

  // Date and time options for selectors
  const dateOptions = useMemo(() => generateDateOptions(), []);
  const timeOptions = useMemo(() => generateTimeOptions(), []);

  // Extract current date and time values from formData
  const startDate = useMemo(() => getDateString(formData.startTime), [formData.startTime]);
  const startTime = useMemo(() => getTimeValue(formData.startTime), [formData.startTime]);
  const endDate = useMemo(() => getDateString(formData.endTime), [formData.endTime]);
  const endTime = useMemo(() => getTimeValue(formData.endTime), [formData.endTime]);

  // Handlers for date/time changes
  const handleStartDateChange = (newDate: string) => {
    const current = new Date(formData.startTime);
    const [year, month, day] = newDate.split('-').map(Number);
    current.setFullYear(year, month - 1, day);
    handleChange('startTime', current.toISOString());
  };

  const handleStartTimeChange = (newTime: number) => {
    const current = new Date(formData.startTime);
    const hours = Math.floor(newTime);
    const minutes = newTime % 1 === 0.5 ? 30 : 0;
    current.setHours(hours, minutes, 0, 0);
    handleChange('startTime', current.toISOString());

    // Auto-adjust end time if needed
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
    const minutes = newTime % 1 === 0.5 ? 30 : 0;
    current.setHours(hours, minutes, 0, 0);
    handleChange('endTime', current.toISOString());
  };

  // Reset form when modal opens or event changes - this is a valid pattern for modals
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(event);
      setActiveTab('basic');
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
    await dispatch(updateEvent({
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
      attendeeIds: formData.attendees.map(a => a.id),
    }));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-card rounded-lg shadow-xl z-50 w-[640px] max-h-[85vh] overflow-hidden flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Event</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-border px-6">
          <button
            onClick={() => setActiveTab('basic')}
            className={cn(
              'px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'basic'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Basic
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={cn(
              'px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'details'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('attendees')}
            className={cn(
              'px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === 'attendees'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            Attendees
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-foreground mb-1">
                  Title
                </label>
                <input
                  id="title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Calendar & Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Calendar
                  </label>
                  <Select
                    value={formData.calendarId}
                    onChange={(value) => handleChange('calendarId', value)}
                    options={calendarOptions}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Category
                  </label>
                  <Select
                    value={formData.categoryId}
                    onChange={(value) => handleChange('categoryId', value)}
                    options={categoryOptions}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Multi-day toggle */}
              <Checkbox
                id="allday-basic"
                checked={formData.isAllDay}
                onChange={(e) => handleChange('isAllDay', e.target.checked)}
                label="Multi-day event"
              />

              {/* Date and Time */}
              {formData.isAllDay ? (
                <div className="space-y-3">
                  {/* Multi-day: Start Date & Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Start Date
                      </label>
                      <Select
                        value={startDate}
                        onChange={handleStartDateChange}
                        options={dateOptions}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        Start Time
                      </label>
                      <Select
                        value={startTime}
                        onChange={handleStartTimeChange}
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
                        onChange={handleEndDateChange}
                        options={dateOptions}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">
                        End Time
                      </label>
                      <Select
                        value={endTime}
                        onChange={handleEndTimeChange}
                        options={timeOptions}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Single-day: Time selectors only */
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      Start
                    </label>
                    <Select
                      value={startTime}
                      onChange={handleStartTimeChange}
                      options={timeOptions}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      End
                    </label>
                    <Select
                      value={endTime}
                      onChange={handleEndTimeChange}
                      options={timeOptions}
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
                  value={formData.description}
                  onChange={(markdown) => handleChange('description', markdown)}
                  placeholder="Add notes, use @ to reference content..."
                  minHeight="180px"
                  maxHeight="250px"
                  showBottomToolbar={true}
                />
              </div>
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-4">
              {/* Location */}
              <div>
                <label htmlFor="location" className="block text-sm font-medium text-foreground mb-1">
                  Location
                </label>
                <input
                  id="location"
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder="Add location or video call link..."
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Meeting URL */}
              <div>
                <label htmlFor="meetingUrl" className="block text-sm font-medium text-foreground mb-1">
                  Meeting URL
                </label>
                <input
                  id="meetingUrl"
                  type="url"
                  value={formData.meetingUrl || ''}
                  onChange={(e) => handleChange('meetingUrl', e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Focus Time */}
              <Checkbox
                id="focusTime"
                checked={formData.isFocusTime}
                onChange={(e) => handleChange('isFocusTime', e.target.checked)}
                label="This is focus/deep work time"
              />
            </div>
          )}

          {activeTab === 'attendees' && (
            <div className="h-full">
              <AttendeesSelector
                attendees={formData.attendees}
                onAdd={handleAttendeeAdd}
                onRemove={handleAttendeeRemove}
              />
            </div>
          )}
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
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium"
          >
            Save Changes
          </button>
        </div>
      </div>
    </>
  );
}
