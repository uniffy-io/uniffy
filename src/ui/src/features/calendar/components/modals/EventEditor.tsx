/**
 * Event Editor Modal
 * Full form for editing event details
 */

import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEvent } from '../../store/calendarThunks';
import type { CalendarEvent } from '../../types';
import { cn } from '@/utils/cn';
import { MarkdownEditor } from '@/components/editor';

/**
 * Convert ISO string to local datetime-local input format
 */
function isoToLocalDatetime(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
    }));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-120 max-h-[90vh] overflow-hidden flex flex-col border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Edit Event</h2>
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

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border px-6">
          <button
            onClick={() => setActiveTab('basic')}
            className={cn(
              'px-4 py-2 font-medium border-b-2 transition-colors',
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
              'px-4 py-2 font-medium border-b-2 transition-colors',
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
              'px-4 py-2 font-medium border-b-2 transition-colors',
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
                  <label htmlFor="calendar" className="block text-sm font-medium text-foreground mb-1">
                    Calendar
                  </label>
                  <select
                    id="calendar"
                    value={formData.calendarId}
                    onChange={(e) => handleChange('calendarId', e.target.value)}
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
                    value={formData.categoryId}
                    onChange={(e) => handleChange('categoryId', e.target.value)}
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

              {/* Description with @ mention support and formatting toolbar */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <MarkdownEditor
                  value={formData.description}
                  onChange={(markdown) => handleChange('description', markdown)}
                  placeholder="Add notes, use @ to reference content..."
                  minHeight="200px"
                  showBottomToolbar={true}
                />
              </div>
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-4">
              {/* All-day toggle */}
              <div className="flex items-center">
                <input
                  id="allday"
                  type="checkbox"
                  checked={formData.isAllDay}
                  onChange={(e) => handleChange('isAllDay', e.target.checked)}
                  className="w-4 h-4 border border-border rounded bg-background cursor-pointer"
                />
                <label htmlFor="allday" className="ml-2 text-sm text-foreground cursor-pointer">
                  All-day event
                </label>
              </div>

              {/* Date and Time */}
              {!formData.isAllDay && (
                <>
                  <div>
                    <label htmlFor="startTime" className="block text-sm font-medium text-foreground mb-1">
                      Start Time
                    </label>
                    <input
                      id="startTime"
                      type="datetime-local"
                      value={isoToLocalDatetime(formData.startTime)}
                      onChange={(e) => {
                        const date = new Date(e.target.value);
                        handleChange('startTime', date.toISOString());
                      }}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label htmlFor="endTime" className="block text-sm font-medium text-foreground mb-1">
                      End Time
                    </label>
                    <input
                      id="endTime"
                      type="datetime-local"
                      value={isoToLocalDatetime(formData.endTime)}
                      onChange={(e) => {
                        const date = new Date(e.target.value);
                        handleChange('endTime', date.toISOString());
                      }}
                      className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </>
              )}

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
              <div className="flex items-center">
                <input
                  id="focusTime"
                  type="checkbox"
                  checked={formData.isFocusTime}
                  onChange={(e) => handleChange('isFocusTime', e.target.checked)}
                  className="w-4 h-4 border border-border rounded bg-background cursor-pointer"
                />
                <label htmlFor="focusTime" className="ml-2 text-sm text-foreground cursor-pointer">
                  This is focus/deep work time
                </label>
              </div>
            </div>
          )}

          {activeTab === 'attendees' && (
            <div className="space-y-4">
              {formData.attendees.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-3">Attendees</h3>
                  <div className="space-y-2">
                    {formData.attendees.map((attendee) => (
                      <div
                        key={attendee.id}
                        className="flex items-center justify-between p-2 rounded border border-border"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                            {attendee.initials}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{attendee.name}</p>
                            <p className="text-xs text-muted-foreground">{attendee.email}</p>
                          </div>
                        </div>
                        <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground capitalize">
                          {attendee.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No attendees added</p>
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                + Add attendees
              </button>
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
